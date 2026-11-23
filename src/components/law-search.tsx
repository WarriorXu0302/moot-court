'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Scale, Search, Loader2, BookOpen, Landmark, FileSearch, RefreshCw,
  ArrowLeft, ArrowRight, ChevronRight, ChevronDown, Folder, FolderOpen, FileText, Star,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { ReactNode } from 'react';
import {
  parseLawItem, parseExplainEntry, splitLegalBlocks, previewText, splitLawBody,
  type ExplainItem, type LegalBlock,
} from '@/lib/law-format';

/** 无结果提示。检索工作流（Coze）的法条库目前以刑事法为主，国际私法、涉外民事诉讼与仲裁法尚未收录（2026-11 实测：
 * 「涉外民事关系法律适用法」「最密切联系」均无结果，「故意杀人」能检出刑法第 232 条），页面据此给出官方数据库入口。 */
export const NO_RESULT_TEXT = '未检索到相关法条与解释';
const WORKFLOW_ID = '7674184725792489498';

export const QUICK_KEYWORDS = ['正当防卫', '故意伤害罪', '盗窃罪', '绑架罪', '诈骗罪'];
const POLL_INTERVAL_MS = 3000;

export interface LawWorkflowData {
  law: string[];
  explain: ExplainItem[];
}

/** 工作流出参兜底解析：数组或JSON字符串 → string[] */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      return [value];
    }
  }
  return [];
}

/** 工作流出参兜底解析：数组或JSON字符串 → {point, content}[] */
function asExplainArray(value: unknown): ExplainItem[] {
  let raw: unknown = value;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
    .map((x) => ({
      point: String(x.point ?? '').trim(),
      content: String(x.content ?? '').trim(),
    }))
    .filter((x) => x.point.length > 0 || x.content.length > 0);
}

/* ============ 检索逻辑 Hook（整页复用） ============ */

export type LawSearchStatus = 'idle' | 'loading' | 'done' | 'error';

export function useLawSearch() {
  const [status, setStatus] = useState<LawSearchStatus>('idle');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<LawWorkflowData | null>(null);
  const [errorText, setErrorText] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const executeIdRef = useRef<string>('');
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    if (tickTimerRef.current) { clearInterval(tickTimerRef.current); tickTimerRef.current = null; }
  }, []);

  useEffect(() => () => clearTimers(), [clearTimers]);

  const startPolling = useCallback((executeId: string) => {
    const startedAt = Date.now();
    setElapsed(0);
    tickTimerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    const poll = async () => {
      try {
        const res = await fetch(`/api/workflow/history?executeId=${encodeURIComponent(executeId)}&workflowId=${WORKFLOW_ID}`, { cache: 'no-store' });
        const j = (await res.json()) as Record<string, unknown>;
        const st = String(j.status ?? '');
        if (st === 'completed') {
          clearTimers();
          const data = (j.data ?? null) as LawWorkflowData | null;
          const law = asStringArray(data?.law);
          const explain = asExplainArray(data?.explain);
          if (law.length === 0 && explain.length === 0) {
            setStatus('error'); setErrorText(NO_RESULT_TEXT);
          } else {
            setResult({ law, explain }); setStatus('done');
          }
        } else if (st === 'failed' || st === 'error' || st === 'stopped') {
          clearTimers(); setStatus('error'); setErrorText('检索工作流执行失败，请稍后重试');
        } else {
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };
    poll();
  }, [clearTimers]);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || status === 'loading') return;
    clearTimers();
    setStatus('loading'); setResult(null); setErrorText(''); setElapsed(0);
    try {
      const res = await fetch('/api/workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId: WORKFLOW_ID, isAsync: true, parameters: { input: q } }),
      });
      const j = (await res.json()) as Record<string, unknown>;
      const eid = String(j.execute_id ?? j.executeId ?? '');
      if (!eid) throw new Error('no execute id');
      executeIdRef.current = eid;
      startPolling(eid);
    } catch {
      setStatus('error'); setErrorText('检索请求发起失败，请检查网络后重试');
    }
  }, [query, status, clearTimers, startPolling]);

  return { status, query, setQuery, result, errorText, elapsed, handleSearch };
}

/* ============ 法条检索入口按钮：跳转整页（不再弹窗） ============ */

export function LawSearchButton({ className }: { className?: string }) {
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('gap-1.5 shrink-0 text-muted-foreground hover:text-foreground', className)}
      onClick={() => router.push('/law-search')}
    >
      <Scale className="h-4 w-4" />
      <span className="hidden xl:inline">法条检索</span>
    </Button>
  );
}

/** 栏标题：主色竖条 + 标题 + 数量Badge + 延伸细线 */
function ResultColumnHeader({ title, count, unit }: { title: string; count: number; unit: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="w-1 h-4.5 bg-primary rounded-full shrink-0" />
      <h3 className="text-base font-bold text-foreground tracking-wide shrink-0">{title}</h3>
      <Badge variant="secondary" className="text-[11px] h-5.5 shrink-0">{count} {unit}</Badge>
      <span className="flex-1 h-px bg-border/70" />
    </div>
  );
}

/** 栏内优雅空态 */
function ResultColumnEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground/60 min-h-[120px]">
      <BookOpen className="h-5 w-5" />
      <p className="text-xs tracking-wide">该分类暂无收录</p>
    </div>
  );
}

/** 结构化正文块渲染：一、=h1 加粗；（二）/1.=h2 缩进条目；★=星标行；其余=普通段落 */
export function LegalBlockView({ blocks }: { blocks: LegalBlock[] }) {
  return (
    <div className="space-y-1.5 text-lg leading-9 text-foreground/90">
      {blocks.map((b, i) => {
        if (b.kind === 'h1') {
          return (
            <p key={i} className="text-xl font-bold text-foreground leading-9 pt-2">
              {b.text}
            </p>
          );
        }
        if (b.kind === 'h2') {
          return (
            <p key={i} className="text-lg font-medium text-foreground/95 leading-9 pl-3.5 border-l-2 border-primary/35">
              {b.text}
            </p>
          );
        }
        if (b.kind === 'star') {
          return (
            <p key={i} className="flex gap-2 text-lg leading-9 text-foreground/90 bg-primary/5 rounded px-2.5 py-1.5">
              <Star className="h-4.5 w-4.5 mt-2.5 shrink-0 fill-primary/70 text-primary/70" />
              <span className="text-justify">{b.text}</span>
            </p>
          );
        }
        return (
          <p key={i} className="text-lg leading-9 text-foreground/85 text-justify">
            {b.text}
          </p>
        );
      })}
    </div>
  );
}

/* ============ 正文直出视图 ============ */

/** 数据库侧已完成原文排版优化：含 Markdown 标记则按 Markdown 渲染，否则本地符号解析兜底 */
const HAS_MARKDOWN_RE = /^#{1,6}\s/m;
const HAS_QUOTE_RE = /^>\s/m;
const HAS_BOLD_RE = /\*\*[^*\n]+\*\*/;

export function LawContentView({ rawText, fallback }: {
  rawText: string;
  fallback: ReactNode;
}) {
  const isMarkdown = HAS_MARKDOWN_RE.test(rawText) || HAS_QUOTE_RE.test(rawText) || HAS_BOLD_RE.test(rawText);
  if (isMarkdown) {
    return (
      <div className="law-ai-md text-lg leading-9 text-foreground/90">
        <ReactMarkdown>{rawText}</ReactMarkdown>
      </div>
    );
  }
  return <>{fallback}</>;
}

/**
 * 法条详情页（跳转设计）：从结果列表点击进入，返回按钮回到检索结果。
 */
export function LawDetailView({ text, onBack }: { text: string; onBack: () => void }) {
  const { article, charge, body } = parseLawItem(text);
  const sentences = splitLawBody(body);

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto pr-1 animate-in fade-in-0 duration-200">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        返回检索结果
      </button>

      <div className="rounded-md border border-border/70 bg-card shadow-sm overflow-hidden">
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5 px-5 py-3.5 bg-muted/50 border-b border-border/60">
          <Landmark className="h-5 w-5 text-primary shrink-0" />
          {article && <span className="text-2xl font-bold text-primary tracking-wide">{article}</span>}
          {charge && (
            <span className="text-sm px-2.5 py-1 rounded bg-primary/10 text-primary font-medium border border-primary/20">
              {charge}
            </span>
          )}
          <span className="flex-1 h-px bg-border/50" />
          <span className="text-xs text-muted-foreground/70 tracking-wide shrink-0">刑法条文</span>
        </div>
        <div className="px-5 py-5">
          <LawContentView
            rawText={text}
            fallback={
              <div className="space-y-3 text-lg leading-9 text-foreground/90">
                {sentences.map((s, i) => (
                  <p key={i} className="leading-9 text-justify">
                    {s}
                  </p>
                ))}
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}

/**
 * 解释目录树（与卷宗同理的两层折叠）：
 * 一级 = 〔N〕 关联法条分组（Folder），二级 = 分类节点（FileText），点击二级展开格式化正文。
 */
export function ExplainDirectory({ explain, defaultOpenKey }: { explain: ExplainItem[]; defaultOpenKey?: string }) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());
  const [openKey, setOpenKey] = useState<string | null>(defaultOpenKey ?? null);

  const toggleGroup = (idx: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const entries = explain.map((item) => parseExplainEntry(item.point, item.content));

  return (
    <div className="space-y-1">
      {entries.map((entry, gi) => {
        const collapsed = collapsedGroups.has(gi);
        return (
          <div key={gi} className="rounded-md border border-border/60 bg-card shadow-sm overflow-hidden">
            {/* 一级：〔N〕 分组目录 */}
            <button
              type="button"
              onClick={() => toggleGroup(gi)}
              className="flex items-center gap-2 w-full px-3.5 py-2.5 bg-muted/40 hover:bg-muted/70 transition-colors text-left"
            >
              {collapsed
                ? <ChevronRight className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
                : <ChevronDown className="h-4.5 w-4.5 shrink-0 text-muted-foreground" />}
              {collapsed
                ? <Folder className="h-4.5 w-4.5 shrink-0 text-primary" />
                : <FolderOpen className="h-4.5 w-4.5 shrink-0 text-primary" />}
              {entry.ordinal && (
                <span className="font-mono text-sm font-semibold text-primary/90 shrink-0">{entry.ordinal}</span>
              )}
              <span className="text-base font-semibold text-foreground truncate">
                {entry.point || '相关解释'}
              </span>
              <Badge variant="secondary" className="ml-auto text-[11px] h-5.5 shrink-0">
                {entry.sections.length} 项
              </Badge>
            </button>

            {/* 二级：分类节点，可展开格式化正文 */}
            {!collapsed && (
              <div className="px-2.5 py-2 space-y-1">
                {entry.sections.map((sec, si) => {
                  const key = `${gi}-${si}`;
                  const isOpen = openKey === key;
                  return (
                    <div key={key}>
                      <button
                        type="button"
                        onClick={() => setOpenKey(isOpen ? null : key)}
                        className="flex items-center gap-2 w-full px-2.5 py-2 rounded hover:bg-accent transition-colors text-left"
                      >
                        {isOpen
                          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground/85">{sec.category}</span>
                        <span className="text-xs text-muted-foreground/60 truncate">
                          {previewText(sec.body, 26)}
                        </span>
                      </button>

                      {isOpen && (
                        <div className="ml-5 mt-1.5 mb-2.5 px-4 py-3.5 bg-muted/25 rounded border-l-2 border-primary/30">
                          <LawContentView
                            rawText={sec.body}
                            fallback={<LegalBlockView blocks={splitLegalBlocks(sec.body)} />}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * 检索结果左右双栏展示：左栏法条 law（紧凑列表，点击跳转详情），右栏解释 explain（两层折叠目录）。
 * 两层滚动：外层页面高度固定（标题/搜索栏钉住），桌面端左右两栏各自独立滚动，目录展开不拉长页面；窄屏上下堆叠后整块滚动。
 */
export function LawResultColumns({
  law, explain, onOpenLaw,
}: { law: string[]; explain: ExplainItem[]; onOpenLaw?: (idx: number) => void }) {
  return (
    <div className="h-full min-h-0 grid grid-cols-1 md:grid-cols-2 lg:gap-x-8 max-md:overflow-y-auto max-md:min-h-0">
      {/* 左栏：法条（跳转列表） */}
      <section className="min-w-0 max-md:pb-6 md:min-h-0 md:flex md:flex-col">
        <ResultColumnHeader title="法条" count={law.length} unit="条" />
        <div className="space-y-2.5 md:flex-1 md:min-h-0 md:overflow-y-auto md:pr-1.5">
          {law.length > 0 ? (
            law.map((text, idx) => {
              const { article, charge, body } = parseLawItem(text);
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => onOpenLaw?.(idx)}
                  className="group relative flex flex-col items-stretch w-full text-left rounded-md border border-border/70 bg-card pl-4 pr-3 py-3 shadow-sm overflow-hidden transition-all hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                >
                  <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-primary/60 transition-colors group-hover:bg-primary" />
                  <span className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1.5">
                    {article && (
                      <span className="text-lg font-bold text-primary tracking-wide">{article}</span>
                    )}
                    {charge && (
                      <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary font-medium border border-primary/20">
                        {charge}
                      </span>
                    )}
                    <ArrowRight className="h-4 w-4 ml-auto text-muted-foreground/50 transition-all group-hover:translate-x-0.5 group-hover:text-primary shrink-0" />
                  </span>
                  <span className="text-sm leading-7 text-foreground/75 text-justify line-clamp-2">
                    {previewText(body, 96)}
                  </span>
                </button>
              );
            })
          ) : (
            <ResultColumnEmpty />
          )}
        </div>
      </section>

      {/* 右栏：立法解释 · 司法解释 · 规范性文件 · 指导性案例（两层折叠目录） */}
      <section className="min-w-0 mt-6 md:mt-0 md:border-l md:border-border/60 md:pl-6 lg:pl-8 md:min-h-0 md:flex md:flex-col">
        <ResultColumnHeader
          title="立法解释 · 司法解释 · 规范性文件 · 指导性案例"
          count={explain.length}
          unit="组"
        />
        <div className="md:flex-1 md:min-h-0 md:overflow-y-auto md:pr-1.5">
          {explain.length > 0 ? (
            <ExplainDirectory explain={explain} />
          ) : (
            <ResultColumnEmpty />
          )}
        </div>
      </section>
    </div>
  );
}
