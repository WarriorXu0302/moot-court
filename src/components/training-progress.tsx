'use client';

/**
 * 标题栏里的训练进度：「上一步」按钮 + 面包屑（走过的环节可点击返回）+ "第 N / M 步"（点开看完整路线）。
 * 路线定义见 lib/training-steps.ts。不在路线上的页面不显示。
 */

import { Fragment, Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Check, ChevronLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator, BreadcrumbEllipsis,
} from '@/components/ui/breadcrumb';
import { interruptTts } from '@/lib/audio';
import { useAppStore } from '@/lib/store';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getTrainingSteps, findStepIndex } from '@/lib/training-steps';
import type { CaseType } from '@/lib/case-type';
import type { UserRole } from '@/lib/types';

interface Props {
  caseType: CaseType;
  role: UserRole;
}

function ProgressInner({ caseType, role }: Props) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const appendBehavior = useAppStore((st) => st.appendBehavior);
  const steps = getTrainingSteps(caseType, role);
  const current = findStepIndex(steps, pathname, new URLSearchParams(search.toString()));
  if (current < 0) return null;

  // 回到已完成的环节：SPA 跳转保留学习记录与已存文书；该环节页会重新开始（对话不恢复）
  const goTo = (i: number) => {
    if (i >= current) return;
    interruptTts();
    appendBehavior(`返回「${steps[i].label}」环节`);
    router.push(steps[i].path);
  };
  // 面包屑只列"走过的路"：路线长时折叠中段，保留第一步、上一步与当前步
  const crumbIdx = current <= 2 ? steps.slice(0, current + 1).map((_, i) => i) : [0, -1, current - 1, current];

  return (
    <nav aria-label="训练进度" className="flex min-w-0 shrink items-center gap-1">
      {current > 0 && (
        <Button variant="ghost" size="sm" className="h-8 shrink-0 gap-0.5 px-2 text-muted-foreground hover:text-foreground" onClick={() => goTo(current - 1)} title={`返回上一步：${steps[current - 1].label}`}>
          <ChevronLeft className="h-4 w-4" />上一步
        </Button>
      )}
      <Breadcrumb className="hidden min-w-0 xl:block">
        <BreadcrumbList className="flex-nowrap text-xs sm:gap-1.5">
          {crumbIdx.map((i, k) => (
            <Fragment key={i === -1 ? 'ellipsis' : steps[i].path}>
              {k > 0 && <BreadcrumbSeparator />}
              <BreadcrumbItem className="min-w-0">
                {i === -1 ? (
                  <BreadcrumbEllipsis className="size-5" />
                ) : i === current ? (
                  <BreadcrumbPage className="truncate font-semibold">{steps[i].label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <button type="button" onClick={() => goTo(i)} className="truncate">{steps[i].label}</button>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`训练进度：第 ${current + 1} 步，共 ${steps.length} 步，当前为${steps[current].label}。点击查看完整路线`}
        >
          <span className="text-xs tabular-nums text-muted-foreground">
            第 <span className="font-semibold text-foreground">{current + 1}</span> / {steps.length} 步
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-3">
        <p className="mb-2 text-xs text-muted-foreground">本次训练路线</p>
        <ol className="space-y-1.5">
          {steps.map((s, i) => (
            <li key={s.path} className="flex items-center gap-2 text-sm" aria-current={i === current ? 'step' : undefined}>
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums',
                  i < current && 'border-primary/60 bg-primary/60 text-primary-foreground',
                  i === current && 'border-primary bg-primary text-primary-foreground',
                  i > current && 'border-muted-foreground/30 text-muted-foreground',
                )}
              >
                {i < current ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              {i < current ? (
                <button type="button" onClick={() => goTo(i)} className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  {s.label}
                </button>
              ) : (
                <span className={cn(i === current ? 'font-semibold text-foreground' : 'text-foreground/80')}>{s.label}</span>
              )}
              {i === current && <span className="ml-auto text-xs text-primary">进行中</span>}
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">完成本环节后点右上角「继续」进入下一步；点已完成的环节可返回。</p>
      </PopoverContent>
    </Popover>
    </nav>
  );
}

/** useSearchParams 必须在 Suspense 边界内，否则生产构建预渲染报错 */
export function TrainingProgress(props: Props) {
  return (
    <Suspense fallback={null}>
      <ProgressInner {...props} />
    </Suspense>
  );
}
