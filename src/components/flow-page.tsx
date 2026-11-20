'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, X, SkipForward } from 'lucide-react';
import { cn } from '@/lib/utils';
import { interruptTts } from '@/lib/audio';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';

interface FlowRound {
  systemPrompt: string;
  contextData?: string;
}

interface FlowPageProps {
  open?: boolean;
  onClose: () => void;
  title: string;
  /** Single prompt (legacy) or multiple rounds */
  systemPrompt?: string;
  /** Multi-round prompts — each round refreshes the display */
  rounds?: FlowRound[];
  contextData?: string;
  caching?: boolean;
  showCloseButton?: boolean;
  closeButtonText?: string;
  backgroundImage?: string;
  /** Auto-advance delay in ms (default 5000) */
  autoAdvanceDelay?: number;
  /** Skip all flow stages and jump directly to the next major section */
  onSkipAll?: () => void;
}

interface ParsedSSE {
  content?: string;
}

/**
 * Full-screen streaming content page.
 * Supports multi-round mode: each round refreshes content, auto-advances after 5s or manual skip.
 */
export function FlowPage({
  open = true,
  onClose,
  title,
  systemPrompt,
  rounds,
  contextData,
  caching = true,
  showCloseButton = false,
  closeButtonText = '继续',
  backgroundImage,
  autoAdvanceDelay = 5000,
  onSkipAll,
}: FlowPageProps) {
  // Normalize to rounds array
  const effectiveRounds: FlowRound[] = rounds && rounds.length > 0
    ? rounds
    : systemPrompt
      ? [{ systemPrompt, contextData }]
      : [];

  const [currentRound, setCurrentRound] = useState(0);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalRounds = effectiveRounds.length;

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const advanceToNextRound = useCallback(() => {
    clearAutoTimer();
    setCountdown(0);
    if (currentRound < totalRounds - 1) {
      setCurrentRound((r) => r + 1);
    } else {
      setAllDone(true);
    }
  }, [currentRound, totalRounds, clearAutoTimer]);

  const startAutoAdvanceCountdown = useCallback(() => {
    clearAutoTimer();
    setCountdown(Math.ceil(autoAdvanceDelay / 1000));
    let remaining = autoAdvanceDelay;
    autoTimerRef.current = setInterval(() => {
      remaining -= 1000;
      if (remaining <= 0) {
        clearAutoTimer();
        advanceToNextRound();
      } else {
        setCountdown(Math.ceil(remaining / 1000));
      }
    }, 1000);
  }, [autoAdvanceDelay, advanceToNextRound, clearAutoTimer]);

  useEffect(() => {
    if (!open) {
      setContent('');
      setDone(false);
      setLoading(false);
      setAllDone(false);
      setCurrentRound(0);
      setCountdown(0);
      clearAutoTimer();
      return;
    }

    if (allDone) return;

    let mounted = true;
    const roundData = effectiveRounds[currentRound];
    if (!roundData) return;

    const fetchStream = async () => {
      setLoading(true);
      setDone(false);
      setContent('');
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const resp = await fetch('/api/llm/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: roundData.systemPrompt },
              { role: 'user', content: roundData.contextData || contextData || '请根据案件资料输出上述流程。' },
            ],
            caching,
          }),
          signal: controller.signal,
        });

        if (!resp.ok || !resp.body) {
          setLoading(false);
          return;
        }

        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullText = '';
        const streamThrottle = createThrottledStreamSetter(setContent);

        while (mounted) {
          const { done: streamDone, value } = await reader.read();
          if (streamDone) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            try {
              const json: ParsedSSE = JSON.parse(trimmed.slice(5).trim());
              if (json.content && mounted) {
                fullText += json.content;
                streamThrottle.push(fullText);
              }
            } catch {
              // skip malformed chunks
            }
          }
        }

        if (mounted) {
          setDone(true);
          setLoading(false);
          // Start auto-advance countdown if there are more rounds
          if (totalRounds > 1 && currentRound < totalRounds - 1) {
            startAutoAdvanceCountdown();
          } else {
            // Last round done - auto-close after 5 seconds
            setAllDone(true);
            startAutoCloseCountdown();
          }
        }
      } catch {
        if (mounted) {
          setLoading(false);
          setDone(true);
          if (totalRounds > 1 && currentRound < totalRounds - 1) {
            startAutoAdvanceCountdown();
          } else {
            setAllDone(true);
            startAutoCloseCountdown();
          }
        }
      }
    };

    fetchStream();

    return () => {
      mounted = false;
      if (abortRef.current) {
        abortRef.current.abort();
      }
      interruptTts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentRound]);

  // Auto-close countdown (5 seconds after all rounds done)
  const startAutoCloseCountdown = useCallback(() => {
    clearAutoTimer();
    setCountdown(5);
    let remaining = 5000;
    autoTimerRef.current = setInterval(() => {
      remaining -= 1000;
      if (remaining <= 0) {
        clearAutoTimer();
        onClose();
      } else {
        setCountdown(Math.ceil(remaining / 1000));
      }
    }, 1000);
  }, [clearAutoTimer, onClose]);
  useEffect(() => {
    return () => clearAutoTimer();
  }, [clearAutoTimer]);

  // Auto-scroll to bottom as content grows
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [content]);

  if (!open) return null;

  const handleSkipOrAdvance = () => {
    // Stop any ongoing TTS when user skips or advances
    interruptTts();
    if (allDone) {
      onClose();
      return;
    }
    if (loading) {
      // Skip current streaming
      if (abortRef.current) {
        abortRef.current.abort();
      }
      setLoading(false);
      setDone(true);
      if (totalRounds > 1 && currentRound < totalRounds - 1) {
        startAutoAdvanceCountdown();
      } else {
        // Last round — auto-close after 5s, skip button closes immediately
        setAllDone(true);
      }
      return;
    }
    if (done) {
      if (totalRounds > 1 && currentRound < totalRounds - 1) {
        advanceToNextRound();
      } else {
        setAllDone(true);
      }
    }
  };

  const canAdvance = (done || loading) && !allDone;
  const showFinishButton = allDone || (totalRounds === 1 && done);

  // Simple markdown renderer
  const renderMarkdown = (md: string) => {
    const lines = md.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: string[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const flushList = () => {
      if (listItems.length > 0 && listType) {
        const key = `list-${elements.length}`;
        if (listType === 'ul') {
          elements.push(
            <ul key={key} className="list-disc pl-6 my-2 space-y-1">
              {listItems.map((item, i) => <li key={i}>{item}</li>)}
            </ul>
          );
        } else {
          elements.push(
            <ol key={key} className="list-decimal pl-6 my-2 space-y-1">
              {listItems.map((item, i) => <li key={i}>{item}</li>)}
            </ol>
          );
        }
        listItems = [];
        listType = null;
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('### ')) {
        flushList();
        elements.push(<h3 key={i} className="text-base font-bold mt-3 mb-1 text-primary">{line.slice(4)}</h3>);
      } else if (line.startsWith('## ')) {
        flushList();
        elements.push(<h2 key={i} className="text-lg font-bold mt-4 mb-2 text-primary">{line.slice(3)}</h2>);
      } else if (line.startsWith('# ')) {
        flushList();
        elements.push(<h1 key={i} className="text-xl font-bold mt-4 mb-2 text-primary">{line.slice(2)}</h1>);
      } else if (/^\d+\.\s/.test(line)) {
        if (listType !== 'ol') { flushList(); listType = 'ol'; }
        listItems.push(line.replace(/^\d+\.\s/, ''));
      } else if (/^[-*]\s/.test(line)) {
        if (listType !== 'ul') { flushList(); listType = 'ul'; }
        listItems.push(line.replace(/^[-*]\s/, ''));
      } else if (line.trim() === '') {
        flushList();
      } else if (line.startsWith('> ')) {
        flushList();
        elements.push(<blockquote key={i} className="border-l-2 border-primary pl-3 my-2 italic text-muted-foreground">{line.slice(2)}</blockquote>);
      } else if (line.startsWith('**') && line.endsWith('**')) {
        flushList();
        elements.push(<p key={i} className="font-bold my-1">{line.slice(2, -2)}</p>);
      } else {
        flushList();
        const parts = line.split(/(\*\*[^*]+\*\*)/);
        const rendered = parts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return <strong key={j}>{part.slice(2, -2)}</strong>;
          }
          return <span key={j}>{part}</span>;
        });
        elements.push(<p key={i} className="my-1">{rendered}</p>);
      }
    }
    flushList();
    return elements;
  };

  return (
    <div className="fixed inset-0 z-[100] bg-background flow-page-enter">
      {backgroundImage && (
        <div
          className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-10"
          style={{ backgroundImage: `url(${backgroundImage})` }}
          aria-hidden="true"
        />
      )}
      {/* Header bar — minimal, no step titles */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/80 px-6 py-3 backdrop-blur-md">
        <h1 className="text-lg font-bold text-foreground">{title}</h1>
        <div className="flex items-center gap-3">
          {/* Multi-round progress dots */}
          {totalRounds > 1 && (
            <div className="flex items-center gap-1.5 mr-2">
              {Array.from({ length: totalRounds }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-2 rounded-full transition-all duration-300',
                    i === currentRound ? 'w-6 bg-primary' :
                    i < currentRound ? 'w-2 bg-primary/60' :
                    'w-2 bg-muted-foreground/30'
                  )}
                />
              ))}
            </div>
          )}
          {loading && (
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="flex gap-1">
                <span className="ai-thinking-dot inline-block h-2 w-2 rounded-full bg-primary" />
                <span className="ai-thinking-dot inline-block h-2 w-2 rounded-full bg-primary" />
                <span className="ai-thinking-dot inline-block h-2 w-2 rounded-full bg-primary" />
              </span>
              AI正在生成...
            </span>
          )}
          {/* Auto-advance countdown */}
          {done && !allDone && totalRounds > 1 && currentRound < totalRounds - 1 && (
            <span className="text-sm text-muted-foreground">
              {countdown}秒后自动进入下一幕
            </span>
          )}
          {/* Skip All button — jumps directly to the next major phase */}
          {!showFinishButton && !onSkipAll && (
            <Button size="sm" variant="outline" onClick={onClose} className="gap-1 text-muted-foreground">
              全部跳过 <SkipForward className="h-4 w-4" />
            </Button>
          )}
          {showFinishButton ? (
            <Button size="sm" onClick={handleSkipOrAdvance} className="gap-1">
              {showCloseButton ? closeButtonText : '完成'} <ChevronRight className="h-4 w-4" />
            </Button>
          ) : canAdvance ? (
            <Button size="sm" variant="ghost" onClick={handleSkipOrAdvance} className="gap-1 text-muted-foreground">
              {loading ? '跳过' : '下一幕'} <SkipForward className="h-4 w-4" />
            </Button>
          ) : null}
          {onSkipAll && !allDone && (
            <Button size="sm" variant="ghost" onClick={onSkipAll} className="gap-1 text-muted-foreground">
              全部跳过 <SkipForward className="h-4 w-4" />
            </Button>
          )}
          {/* All-done countdown */}
          {allDone && (
            <span className="text-sm text-muted-foreground">
              {countdown}秒后自动关闭
            </span>
          )}
          <Button size="icon" variant="ghost" onClick={onClose} className="h-8 w-8">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Full-screen scrollable content */}
      <div
        ref={scrollRef}
        className="h-[calc(100vh-56px)] overflow-y-auto scroll-thin"
      >
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="markdown-content text-foreground leading-relaxed">
            {content ? renderMarkdown(content) : (
              <div className="flex items-center justify-center py-20 text-muted-foreground">
                <span className="flex gap-1">
                  <span className="ai-thinking-dot inline-block h-3 w-3 rounded-full bg-primary" />
                  <span className="ai-thinking-dot inline-block h-3 w-3 rounded-full bg-primary" />
                  <span className="ai-thinking-dot inline-block h-3 w-3 rounded-full bg-primary" />
                </span>
              </div>
            )}
            {loading && content && (
              <span className="typewriter-cursor text-primary" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
