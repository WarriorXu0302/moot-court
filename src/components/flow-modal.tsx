'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { interruptTts } from '@/lib/audio';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';

interface FlowModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  systemPrompt: string;
  contextData?: string;
  streamingMode?: boolean;
  backgroundImage?: string;
}

export function FlowModal({
  open,
  onClose,
  title,
  systemPrompt,
  contextData = '',
  streamingMode = true,
  backgroundImage,
}: FlowModalProps) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open && streamingMode) {
      streamContent();
    }
    return () => {
      abortRef.current?.abort();
      interruptTts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const streamContent = async () => {
    setContent('');
    setLoading(true);

    try {
      const res = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt },
            ...(contextData ? [{ role: 'user', content: contextData }] : []),
          ],
          temperature: 0.6,
          caching: true,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      const streamThrottle = createThrottledStreamSetter(setContent);

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                streamThrottle.push(fullText);
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setContent(`内容加载失败: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { interruptTts(); onClose(); } }}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden">
        {backgroundImage && (
          <div
            className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-10"
            style={{ backgroundImage: `url(${backgroundImage})` }}
            aria-hidden="true"
          />
        )}
        <DialogHeader className="relative z-10">
          <DialogTitle className="text-xl">{title}</DialogTitle>
        </DialogHeader>

        <ScrollArea className="relative z-10 max-h-[65vh] pr-4">
          {loading && !content ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <div className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-primary ai-thinking-dot" />
                <span className="w-2.5 h-2.5 rounded-full bg-primary ai-thinking-dot" />
                <span className="w-2.5 h-2.5 rounded-full bg-primary ai-thinking-dot" />
              </div>
              <p className="text-sm text-muted-foreground">正在生成流程内容...</p>
            </div>
          ) : (
            <div className="markdown-content text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{content}</ReactMarkdown>
              {loading && <span className="typewriter-cursor" />}
            </div>
          )}
        </ScrollArea>

        <div className="flex justify-end pt-2 border-t">
          <Button onClick={onClose} disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                生成中...
              </>
            ) : (
              '确定'
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
