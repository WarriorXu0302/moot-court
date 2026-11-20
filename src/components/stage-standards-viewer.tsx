'use client';

import { useMemo, useState } from 'react';
import { BookOpenCheck, ChevronDown, Scale } from 'lucide-react';
import {
  parseScoringStandards,
  getStageStandards,
  type ScoringStandards,
  type ScoringStage,
  type ScoringDimension,
} from '@/lib/scoring';

interface StageStandardsViewerProps {
  /** 案例评分标准（cases.judge 序列化 JSON 文本） */
  value?: string | null;
  /** 当前环节标准 key，如 'defense-writing' */
  stageKey: string;
}

/**
 * 学生端考核评分标准查看器（只读折叠面板）：
 * 展示本环节考核要点、评分维度与总标准分档，帮助学生明确训练目标。
 */
export function StageStandardsViewer({ value, stageKey }: StageStandardsViewerProps) {
  const [open, setOpen] = useState(false);

  const { stage, overall } = useMemo(() => {
    const standards: ScoringStandards | null = parseScoringStandards(value ?? null);
    return {
      stage: getStageStandards(standards, stageKey),
      overall: standards?.overall ?? null,
    };
  }, [value, stageKey]);

  if (!stage && !overall) return null;

  return (
    <div className="border rounded-lg bg-card/60 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-muted/50 transition-colors"
      >
        <BookOpenCheck className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-sm font-semibold tracking-wide">考核评分标准</span>
        {stage && (
          <span className="text-xs text-muted-foreground truncate">· {stage.name}</span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 ml-auto text-muted-foreground transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-5 border-t bg-background/40">
          {stage && <StageSection stage={stage} />}
          {overall && <OverallSection overall={overall} />}
        </div>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="w-1 h-4 bg-primary rounded-sm shrink-0" />
      <h4 className="text-sm font-semibold">{children}</h4>
    </div>
  );
}

function StageSection({ stage }: { stage: ScoringStage }) {
  return (
    <section>
      <SectionTitle>本环节考核要点 · {stage.name}</SectionTitle>
      {stage.points.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {stage.points.map((p: string, i: number) => (
            <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
              <span className="shrink-0 mt-0.5 font-mono text-xs text-primary/70">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
      {stage.dimensions.length > 0 && (
        <>
          <p className="mt-3 text-xs font-medium text-muted-foreground">评分维度（权重）</p>
          <div className="mt-1.5 space-y-1.5">
            {stage.dimensions.map((d: ScoringDimension, i: number) => (
              <div key={i} className="flex gap-2 items-start rounded-md border bg-card px-2.5 py-1.5">
                <span className="shrink-0 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary whitespace-nowrap">
                  {d.name} {d.weight}%
                </span>
                <span className="text-xs leading-relaxed text-foreground/85">{d.criteria}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function OverallSection({ overall }: { overall: ScoringStandards['overall'] }) {
  return (
    <section>
      <div className="flex items-center gap-2 mt-3">
        <Scale className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-sm font-semibold">总标准 · 评分分档</h4>
      </div>
      {overall.dimensions.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {overall.dimensions.map((d: ScoringDimension, i: number) => (
            <span
              key={i}
              title={d.criteria}
              className="inline-flex items-center rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            >
              {d.name} {d.weight}%
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 overflow-hidden rounded-md border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-muted/60 border-b">
              <th className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap">分档</th>
              <th className="px-2.5 py-1.5 text-left font-semibold whitespace-nowrap w-24">分数区间</th>
              <th className="px-2.5 py-1.5 text-left font-semibold">标准描述</th>
            </tr>
          </thead>
          <tbody>
            {overall.grading.map((g, i: number) => (
              <tr key={i} className={i < overall.grading.length - 1 ? 'border-b' : ''}>
                <td className="px-2.5 py-1.5 font-medium text-primary whitespace-nowrap">{g.band}</td>
                <td className="px-2.5 py-1.5 text-muted-foreground whitespace-nowrap">{g.range}</td>
                <td className="px-2.5 py-1.5 leading-relaxed text-foreground/85">{g.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
