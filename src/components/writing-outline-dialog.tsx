'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, BookOpen, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { fetchWritingOutline } from '@/lib/writing-outline';
import type { CaseData } from '@/lib/types';

interface WritingOutlineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docType: string;
  caseData: CaseData | null;
}

export function WritingOutlineDialog({ open, onOpenChange, docType, caseData }: WritingOutlineDialogProps) {
  const [outline, setOutline] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  const loadOutline = useCallback(async () => {
    setLoading(true);
    setError('');
    setOutline('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await fetchWritingOutline(
        docType,
        caseData,
        (text) => setOutline(text),
        controller.signal,
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(`获取提纲失败: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [docType, caseData]);

  useEffect(() => {
    if (open && !outline && !loading) {
      loadOutline();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-[640px] sm:max-w-[640px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <SheetTitle>写作提纲与指导</SheetTitle>
          </div>
          <SheetDescription className="text-xs">
            以下提纲和写作方法由AI根据案件资料生成，供参考借鉴
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4">
            {loading && !outline ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">正在生成写作提纲...</p>
                <div className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                  <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                  <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                </div>
              </div>
            ) : error ? (
              <div className="text-center py-8 space-y-3">
                <p className="text-sm text-destructive">{error}</p>
                <Button variant="outline" size="sm" onClick={loadOutline}>重试</Button>
              </div>
            ) : outline ? (
              <div className="markdown-content text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{outline}</ReactMarkdown>
                {loading && <span className="typewriter-cursor" />}
              </div>
            ) : null}
          </div>
        </ScrollArea>

        {outline && !loading && (
          <div className="border-t p-3 shrink-0 flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button size="sm" onClick={loadOutline}>
              重新生成
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
