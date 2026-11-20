'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { Eye, EyeOff, Lock, Loader2 } from 'lucide-react';
import { isSampleUnlocked, type DocEvalProgress } from '@/lib/scoring';

interface SampleViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 文书类型：defense/indictment/prosecution/plan */
  docType: string;
  /** 文书标题，如"辩护词" */
  docTitle: string;
  /** AI样例内容（教师端生成或随系统推进生成） */
  sampleText: string;
  /** 本文书评价进度（evalCount/bestScore） */
  progress: DocEvalProgress | undefined;
  /** 解锁所需规则 */
  thresholdScore: number;
  thresholdCount: number;
}

/**
 * AI样例查看弹窗：学生文书达到"基本可以"（评分达标）或评价满3次后解锁查看。
 */
export function SampleViewerDialog({
  open,
  onOpenChange,
  docTitle,
  sampleText,
  progress,
  thresholdScore,
  thresholdCount,
}: SampleViewerDialogProps) {
  const [revealed, setRevealed] = useState(false);
  const unlocked = isSampleUnlocked(progress, { scoreThreshold: thresholdScore, evalCountThreshold: thresholdCount });

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setRevealed(false); onOpenChange(o); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {docTitle}AI样例
            {unlocked ? (
              <Badge variant="secondary" className="font-normal">已解锁</Badge>
            ) : (
              <Badge variant="outline" className="font-normal gap-1">
                <Lock className="h-3 w-3" />未解锁
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {unlocked
              ? `您的${docTitle}评分达到"基本可以"（${thresholdScore}分）或已评价${thresholdCount}次，可查看AI样例作为参考。`
              : `撰写${docTitle}并评价：评分达到"基本可以"（${thresholdScore}分以上）或评价满${thresholdCount}次后，可解锁查看AI样例。当前已评价 ${progress?.evalCount ?? 0} 次，最好成绩 ${progress?.bestScore ?? 0} 分。`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0">
          {unlocked && revealed ? (
            <ScrollArea className="h-[55vh] pr-3">
              <div className="markdown-content text-sm rounded-md border bg-muted/30 p-4">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{sampleText}</ReactMarkdown>
              </div>
            </ScrollArea>
          ) : unlocked ? (
            <div className="h-[55vh] flex flex-col items-center justify-center gap-4 border rounded-md bg-muted/20">
              <EyeOff className="h-10 w-10 text-muted-foreground/60" />
              <Button onClick={() => setRevealed(true)}>
                <Eye className="h-4 w-4 mr-1" />
                查看样例
              </Button>
            </div>
          ) : (
            <div className="h-[55vh] flex flex-col items-center justify-center gap-3 border rounded-md bg-muted/20">
              <Lock className="h-10 w-10 text-muted-foreground/60" />
              <p className="text-sm text-muted-foreground">尚未解锁</p>
            </div>
          )}
        </div>

        {!sampleText && unlocked ? (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />本案例暂无AI样例
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
