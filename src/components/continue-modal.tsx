'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { Loader2 } from 'lucide-react';
import { interruptTts } from '@/lib/audio';
import { stripLifecycleTag } from '@/lib/lifecycle-utils';
import { parseSummarySections } from '@/lib/summary-stream';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';

interface ContinueModalProps {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  record?: LearningRecordEntry;
  conversations?: ChatMessage[];
  /** 流式生成中的累积文本（loading 时传入则按区块增量渲染，版面结构固定不跳动） */
  streamText?: string;
  /** 弹窗标题，默认「学习过程总结」 */
  title?: string;
  /** 确认按钮文案，默认「继续」 */
  buttonText?: string;
}

/** 流式增量渲染视图：区块标题与容器始终固定，内容在各自框内增长 */
function StreamingSections({ text }: { text: string }) {
  const sections = parseSummarySections(text);
  const blocks: Array<{ key: 'summary' | 'evaluation' | 'suggestion'; title: string; content: string }> = [
    { key: 'summary', title: '学习过程概括', content: sections.summary },
    { key: 'evaluation', title: '评价', content: sections.evaluation },
    { key: 'suggestion', title: '训练建议', content: sections.suggestion },
  ];
  // 最后一个有内容的区块为当前生成中的活跃区块（显示光标）
  const activeIdx = (() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].content) return i;
    }
    return 0;
  })();

  return (
    <div className="space-y-4">
      {/* 得分占位（与完成态同构，避免版面跳动） */}
      <ScoreLine score={sections.score} />

      {blocks.map((block, i) => (
        <div key={block.key}>
          <h3 className="mb-1.5 font-display text-base font-semibold text-foreground">{block.title}</h3>
          <div className="min-h-[3rem] border-l-2 border-border pl-4">
            {block.content ? (
              <div className="markdown-content text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{block.content}</ReactMarkdown>
                {i === activeIdx && sections.score === undefined && (
                  <span className="inline-block w-2 h-4 bg-primary/70 align-text-bottom animate-pulse" />
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/60">
                {i <= activeIdx ? '生成中…' : '待生成'}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 把 markdown 转成一行纯文本预览（标题符、加粗、列表符、链接、多余空白），超长截断 */
function previewText(md: string, max = 220): string {
  const t = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|\s)[*_]([^*_\n]+)[*_]/g, '$1$2')
    .replace(/^\s*(?:[-*+]|\d+[.)、])\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

/** 得分：大号数字 + 等级文字。原先是图标+小框，分数不醒目，也没有说明分数意味着什么 */
function ScoreLine({ score }: { score: number | undefined }) {
  const band = score === undefined ? '' : score >= 85 ? '优秀' : score >= 75 ? '良好' : score >= 60 ? '合格' : '需加强';
  return (
    <div className="flex items-end gap-4 border-b pb-4">
      <div className="flex items-baseline gap-1">
        <span className={`font-display text-5xl font-semibold leading-none tabular-nums ${score === undefined ? 'text-muted-foreground/40' : score >= 60 ? 'text-foreground' : 'text-destructive'}`}>
          {score ?? '··'}
        </span>
        <span className="text-sm text-muted-foreground">/ 100</span>
      </div>
      <div className="pb-1 text-sm">
        {score === undefined ? <span className="text-muted-foreground">评定中…</span> : (
          <span className={`rounded-sm px-1.5 py-0.5 text-xs ${score >= 75 ? 'bg-primary text-primary-foreground' : score >= 60 ? 'bg-secondary text-secondary-foreground' : 'bg-seal text-seal-foreground'}`}>{band}</span>
        )}
      </div>
    </div>
  );
}

export function ContinueModal({
  open,
  onClose,
  loading,
  record,
  conversations = [],
  streamText,
  title = '学习过程总结',
  buttonText = '继续',
}: ContinueModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !loading) { interruptTts(); onClose(); } }}>
      <DialogContent className="max-h-[85vh] max-w-3xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{title}</DialogTitle>
          <DialogDescription>
            AI 按本环节评分标准给出的得分、评价与建议
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          {loading && streamText ? (
            <StreamingSections text={streamText} />
          ) : loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">AI 正在分析本环节的表现…</p>
              <div className="flex items-center gap-1 mt-2">
                <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
              </div>
            </div>
          ) : record ? (
            <div className="space-y-4">
              {record.score !== undefined && record.score > 0 && <ScoreLine score={record.score} />}
              {/* Conversations */}
              <div>
                <h3 className="mb-1.5 font-display text-base font-semibold text-foreground">本环节对话</h3>
                <div className="max-h-48 space-y-2 overflow-y-auto border-l-2 border-border pl-4 scroll-thin">
                  {conversations.length === 0 ? (
                    <p className="text-sm text-muted-foreground">无对话记录</p>
                  ) : (
                    conversations.map((msg) => (
                      <div key={msg.id} className="text-sm">
                        <span className="font-semibold text-foreground">
                          {msg.speaker || (msg.role === 'user' ? '我' : 'AI')}:
                        </span>{' '}
                        {/* 对话回顾只看要点：去掉 markdown 标记（原先 ## 和 ** 原样显示），并截断过长的 AI 长文 */}
                        <span className="text-muted-foreground">{previewText(stripLifecycleTag(msg.content))}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Summary */}
              <div>
                <h3 className="mb-1.5 font-display text-base font-semibold text-foreground">学习过程概括</h3>
                <div className="border-l-2 border-border pl-4">
                  <div className="markdown-content text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
                      {stripLifecycleTag(record.summary)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>

              {/* Evaluation */}
              <div>
                <h3 className="mb-1.5 font-display text-base font-semibold text-foreground">评价</h3>
                <div className="border-l-2 border-border pl-4">
                  <div className="markdown-content text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
                      {stripLifecycleTag(record.evaluation)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>

              {/* Suggestion */}
              <div>
                <h3 className="mb-1.5 font-display text-base font-semibold text-foreground">训练建议</h3>
                <div className="border-l-2 border-border pl-4">
                  <div className="markdown-content text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
                      {stripLifecycleTag(record.suggestion)}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">暂无数据</p>
          )}
        </ScrollArea>

        <div className="flex justify-end pt-4 border-t">
          <Button onClick={onClose} disabled={loading}>
            {buttonText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
