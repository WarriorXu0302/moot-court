'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppStore } from '@/lib/store';
import { Send, Volume2, VolumeX, Loader2, Mic, MicOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { CopyButton } from '@/components/copy-button';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import type { ChatMessage } from '@/lib/types';
import { speakText, interruptTts } from '@/lib/audio';
import { stripLifecycleForStreaming, parseLifecycleFromAIResponse } from '@/lib/lifecycle-utils';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';

interface AIChatPanelProps {
  title: string;
  systemPrompt: string;
  contextData?: string;
  placeholder?: string;
  onMessagesChange?: (messages: ChatMessage[]) => void;
  initialMessages?: ChatMessage[];
  temperature?: number;
  ttsSpeaker?: string;
}

export function AIChatPanel({
  title,
  systemPrompt,
  contextData,
  placeholder = '输入您的问题...',
  onMessagesChange,
  initialMessages = [],
  temperature = 0.7,
  ttsSpeaker,
}: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const ttsEnabled = useAppStore((s) => s.ttsEnabled);
  const setTtsEnabled = useAppStore((s) => s.setTtsEnabled);
  const voiceMode = useAppStore((s) => s.voiceMode);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  // Notify parent of message changes
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;

    // Interrupt any ongoing TTS when user sends a new message
    interruptTts();

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    // Build message array for LLM
    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...(contextData ? [{ role: 'user' as const, content: contextData }] : []),
      ...messages.map((m) => ({
        role: m.role === 'narrator' ? 'assistant' as const : m.role,
        content: `${m.speaker ? `[${m.speaker}] ` : ''}${m.content}`,
      })),
      { role: 'user' as const, content: input.trim() },
    ];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: llmMessages,
          temperature,
          caching: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      const streamThrottle = createThrottledStreamSetter(setStreamingText);

      while (true) {
        const { done, value } = await reader.read();
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
            } catch {
              // skip
            }
          }
        }
      }

      // Add assistant message (strip LIFECYCLE tag)
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: parseLifecycleFromAIResponse(fullText),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // TTS if enabled (respect global voice/text mode)
      if (ttsEnabled && voiceMode && fullText) {
        speakText(parseLifecycleFromAIResponse(fullText), assistantMsg.speaker || ttsSpeaker, 'court-sim-user');
      }

      setStreamingText('');
    } catch (error: unknown) {
      if (error instanceof Error && error.name !== 'AbortError') {
        const errMsg = error.message;
        const errorMsg: ChatMessage = {
          id: `msg-${Date.now()}-err`,
          role: 'assistant',
          content: `抱歉，发生了错误: ${errMsg}`,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, systemPrompt, contextData, temperature, ttsEnabled, voiceMode, ttsSpeaker, onMessagesChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <h3 className="font-semibold text-sm">{title}</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { setTtsEnabled(!ttsEnabled); interruptTts(); }}
          title={ttsEnabled ? '关闭配音' : '开启配音'}
        >
          {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </Button>
      </div>

      {/* Messages area - fixed height with scroll */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3 min-h-0"
      >
        {messages.length === 0 && !isStreaming && (
          <div className="text-center text-muted-foreground py-8 text-sm">
            开始对话吧...
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}
            >
              {msg.speaker && <div className="font-semibold mb-1">{msg.speaker}</div>}
              <div className="markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
                  {msg.content}
                </ReactMarkdown>
              </div>
              {msg.role !== 'user' && <div className="-mb-1 mt-1 flex"><CopyButton text={msg.content} className="-ml-1.5" /></div>}
            </div>
          </div>
        ))}

        {/* Streaming message with AI thinking animation */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-lg px-3 py-2 bg-muted">
              {streamingText ? (
                <div className="markdown-content text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
                    {stripLifecycleForStreaming(streamingText)}
                  </ReactMarkdown>
                  <span className="typewriter-cursor" />
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                    <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                    <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                  </div>
                  <span>AI正在思考...</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="border-t p-3 shrink-0">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="resize-none text-sm min-h-[60px] max-h-[120px]"
            disabled={isStreaming}
          />
          <Button
            onClick={sendMessage}
            disabled={!input.trim() || isStreaming}
            size="icon"
            className="shrink-0"
          >
            {isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
