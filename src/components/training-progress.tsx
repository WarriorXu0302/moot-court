'use client';

/**
 * 标题栏里的训练进度：分段条 + "第 N / M 步"，点开看完整路线（已完成 / 当前 / 未开始）。
 * 路线定义见 lib/training-steps.ts。不在路线上的页面不显示。
 */

import { Suspense } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Check } from 'lucide-react';
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
  const steps = getTrainingSteps(caseType, role);
  const current = findStepIndex(steps, pathname, new URLSearchParams(search.toString()));
  if (current < 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex shrink-0 items-center gap-2 rounded-md px-2 py-1 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`训练进度：第 ${current + 1} 步，共 ${steps.length} 步，当前为${steps[current].label}。点击查看完整路线`}
        >
          <span className="hidden items-center gap-1 sm:flex" aria-hidden>
            {steps.map((s, i) => (
              <span
                key={s.path}
                className={cn(
                  'h-1.5 rounded-full transition-colors',
                  i === current ? 'w-5 bg-primary' : 'w-2.5',
                  i < current && 'bg-primary/60',
                  i > current && 'bg-muted-foreground/25',
                )}
              />
            ))}
          </span>
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
              <span className={cn(i === current ? 'font-semibold text-foreground' : i < current ? 'text-muted-foreground' : 'text-foreground/80')}>
                {s.label}
              </span>
              {i === current && <span className="ml-auto text-xs text-primary">进行中</span>}
            </li>
          ))}
        </ol>
        <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">完成本环节后点右上角「继续」进入下一步。</p>
      </PopoverContent>
    </Popover>
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
