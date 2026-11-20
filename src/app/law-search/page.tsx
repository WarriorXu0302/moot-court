'use client';

import { Suspense, useEffect, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Loader2, BookOpen, Landmark, FileSearch, AlertCircle, RefreshCw } from 'lucide-react';
import { useLawSearch, LawResultColumns, LawDetailView, QUICK_KEYWORDS } from '@/components/law-search';

// useSearchParams() 需在静态预渲染时由 Suspense 边界包裹，否则生产构建报
// missing-suspense-with-csr-bailout
export default function LawSearchPage() {
  return (
    <Suspense>
      <LawSearchPageInner />
    </Suspense>
  );
}

function LawSearchPageInner() {
  const searchParams = useSearchParams();
  const { status, query, setQuery, result, errorText, elapsed, handleSearch } = useLawSearch();
  const [activeLaw, setActiveLaw] = useState<number | null>(null);

  // 支持带初始关键词进入：/law-search?q=xxx
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) {
      setQuery(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="h-screen bg-background flex flex-col overflow-hidden">
      <PageHeader
        back="back"
        title="法条检索"
        subtitle="法律条文 · 立法与司法解释 · 规范性文件 · 指导性案例"
        showLawSearch={false}
      />
      <div className="shrink-0 border-b bg-card">
        {/* 搜索栏 */}
        <div className="w-full px-4 sm:px-6 lg:px-10 py-3">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
                placeholder="输入法律概念、罪名或条文关键词"
                className="pl-9"
                disabled={status === 'loading'}
              />
            </div>
            <Button onClick={handleSearch} disabled={status === 'loading' || !query.trim()} className="gap-1.5">
              {status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              检索
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 w-full px-4 sm:px-6 lg:px-10 py-5 flex flex-col">
        {/* 状态视图 */}
        {status === 'idle' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-primary/20 bg-primary/5">
              <Landmark className="h-7 w-7 text-primary/70" />
            </div>
            <div>
              <p className="font-display text-lg text-foreground">检索法律条文与权威解释</p>
              <p className="mt-1 text-xs text-muted-foreground">
                输入关键词后点「检索」，约 30–60 秒返回法条与权威解释
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {QUICK_KEYWORDS.map((k) => (
                <Button
                  key={k}
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-full px-3 text-xs"
                  onClick={() => { setQuery(k); }}
                >
                  {k}
                </Button>
              ))}
            </div>
          </div>
        )}

        {status === 'loading' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary/70" />
            <p className="text-sm font-medium">正在检索「{query}」…</p>
            <p className="text-xs text-muted-foreground">已耗时 {elapsed} 秒，法条工作流通常需要 30~60 秒</p>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <AlertCircle className="h-8 w-8 text-destructive/70" />
            <p className="text-sm font-medium">{errorText || '检索失败'}</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleSearch}>
              <RefreshCw className="h-3.5 w-3.5" />
              重试
            </Button>
          </div>
        )}

        {/* 结果视图：卡片占满剩余高度，栏内各自滚动（两层滚动） */}
        {status === 'done' && result && (
          activeLaw !== null && result.law[activeLaw] !== undefined ? (
            <div className="flex-1 min-h-0 rounded-lg border bg-card p-5 lg:p-6 shadow-sm flex flex-col overflow-hidden">
              <LawDetailView text={result.law[activeLaw]} onBack={() => setActiveLaw(null)} />
            </div>
          ) : (
            <div className="flex-1 min-h-0 rounded-lg border bg-card p-5 lg:p-6 shadow-sm flex flex-col overflow-hidden">
              <LawResultColumns
                law={result.law}
                explain={result.explain}
                onOpenLaw={(i) => setActiveLaw(i)}
              />
            </div>
          )
        )}

        {status === 'done' && !result && (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
            <FileSearch className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">未检索到内容，换个关键词试试</p>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setQuery(''); }}>
              <BookOpen className="h-3.5 w-3.5" />
              重新输入
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
