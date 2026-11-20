'use client';

/**
 * 教师端案例审核面板（仅教材导入 / AI 生成的仲裁案例显示）。
 *
 * 解决的问题：教材导入的案例里，一部分是原文、一部分是 AI 拟制的模拟材料，还有只给教师看的标准答案。
 * 原先这些信息都存在 meta.reference 里，但教师端界面上完全看不到——老师既不知道哪些内容需要核对，
 * 也看不到标准答案，只能盲点"发布"。
 *
 * 这里把审核需要的三件事放在一个折叠面板里：
 *   1. 出处与原案案号
 *   2. 哪些栏目是 AI 拟制、需要核对（逐项列出，对应页面上的栏目名）
 *   3. 标准答案（裁判要旨 / 法理分析 / 拓展案例）——明确标注"学生不可见"
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, ShieldCheck, Sparkles, BookOpen, EyeOff } from 'lucide-react';
import type { CaseReference } from '@/lib/case-type';

/** aiDrafted 里的字段名 → 教师在页面上看到的栏目名 */
const FIELD_NAME: Record<string, string> = {
  profile: '案件基本介绍',
  teach: '训练价值',
  plead: '卷宗 · 诉讼文书',
  record: '卷宗 · 询问笔录',
  evidence: '卷宗 · 证据材料',
  law: '相关法条',
  wrong: '易错点（程序瑕疵）',
  person: '角色设定',
};

export function CaseReviewPanel({ reference, status }: { reference: CaseReference; status: string }) {
  const [openAnswer, setOpenAnswer] = useState(false);
  const drafted = reference.aiDrafted ?? [];
  const published = status === 'published';

  return (
    <section
      aria-label="审核信息"
      className="shrink-0 rounded-lg border border-amber-300/70 bg-amber-50/70 px-4 py-2.5 text-sm dark:border-amber-500/40 dark:bg-amber-950/20"
    >
      {/* 第一行：发布状态 + 出处；第二行：AI 拟制的栏目（行内标签，不再占右侧一整列） */}
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <p className="min-w-0 text-foreground">
          <span className="font-medium">{published ? '已发布，学生可见' : '尚未发布，学生看不到这个案例'}</span>
          <span className="ml-3 text-xs text-muted-foreground">
            出处：{reference.source}
            {reference.caseNo ? `　原案：${reference.caseNo}` : ''}
          </span>
        </p>
      </div>

      {drafted.length > 0 && (
        <div className="mt-1.5 flex items-start gap-2">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <p className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-medium text-foreground">AI 拟制、发布前请核对：</span>
            {drafted.map((k) => (
              <span key={k} className="rounded border border-amber-300/80 bg-card px-1.5 py-px text-xs text-foreground">
                {FIELD_NAME[k] ?? k}
              </span>
            ))}
            <span className="text-xs text-muted-foreground">（案件基本资料、争议焦点为教材原文）</span>
          </p>
        </div>
      )}

      {(reference.holding || reference.analysis) && (
        <div className="mt-2 border-t border-amber-300/50 pt-1.5">
          <button
            type="button"
            onClick={() => setOpenAnswer((v) => !v)}
            aria-expanded={openAnswer}
            className="flex items-center gap-1.5 font-medium text-foreground hover:underline"
          >
            {openAnswer ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            <BookOpen className="h-4 w-4" />
            标准答案
            <span className="ml-1 inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
              <EyeOff className="h-3 w-3" />
              仅教师可见
            </span>
          </button>

          {openAnswer && (
            <div className="mt-2 max-h-[30vh] space-y-3 overflow-y-auto rounded-md border bg-card p-3 scroll-thin">
              {reference.issues && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-muted-foreground">法律问题</h4>
                  <p className="whitespace-pre-wrap leading-relaxed">{reference.issues}</p>
                </div>
              )}
              {reference.holding && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-muted-foreground">裁判要旨</h4>
                  <p className="whitespace-pre-wrap leading-relaxed">{reference.holding}</p>
                </div>
              )}
              {reference.analysis && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-muted-foreground">法理分析</h4>
                  <p className="whitespace-pre-wrap leading-relaxed">{reference.analysis}</p>
                </div>
              )}
              {reference.extended && reference.extended.length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold text-muted-foreground">拓展案例</h4>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {reference.extended.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
