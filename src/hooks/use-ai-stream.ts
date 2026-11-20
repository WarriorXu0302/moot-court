'use client';

import React, { useState, useRef, useCallback } from 'react';
import { useAppStore } from '@/lib/store';

interface UseAIStreamOptions {
  onMessage?: (chunk: string) => void;
  onComplete?: (fullText: string) => void;
  onError?: (error: string) => void;
}

export function useAIStream() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const ttsEnabled = useAppStore((s) => s.ttsEnabled);

  const streamChat = useCallback(
    async (
      messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      options?: UseAIStreamOptions & { temperature?: number; caching?: boolean }
    ) => {
      setIsStreaming(true);
      setDisplayText('');
      let fullText = '';

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const response = await fetch('/api/llm/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages,
            temperature: options?.temperature ?? 0.7,
            caching: options?.caching ?? true,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6).trim();
              if (data === '[DONE]') {
                options?.onComplete?.(fullText);
                break;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullText += parsed.content;
                  setDisplayText(fullText);
                  options?.onMessage?.(parsed.content);
                }
                if (parsed.error) {
                  options?.onError?.(parsed.error);
                }
              } catch {
                // skip non-JSON lines
              }
            }
          }
        }

        // If TTS is enabled, generate audio
        if (ttsEnabled && fullText) {
          try {
            const ttsResponse = await fetch('/api/tts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                text: fullText,
                uid: 'court-sim-user',
              }),
            });
            const ttsData = await ttsResponse.json();
            if (ttsData.audioUri) {
              // Auto-play audio
              const audio = new Audio(ttsData.audioUri);
              audio.play().catch(() => {});
            }
          } catch {
            // TTS failure is non-critical
          }
        }

        options?.onComplete?.(fullText);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === 'AbortError') {
          options?.onComplete?.(fullText);
        } else {
          const errMsg = error instanceof Error ? error.message : 'Stream error';
          options?.onError?.(errMsg);
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }

      return fullText;
    },
    [ttsEnabled]
  );

  const stopStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { isStreaming, displayText, streamChat, stopStream, setDisplayText };
}
