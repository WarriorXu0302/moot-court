'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@/components/page-header';
import { useSearchParams } from 'next/navigation';
import { Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { parseScoringStandards } from '@/lib/scoring';
import type { GradingBand, ScoringDimension, ScoringStage, ScoringStandards } from '@/lib/scoring';
import type { CaseData } from '@/lib/types';
import { ROLE_LABELS, normalizeCaseType, isAdversarial, type CaseType } from '@/lib/case-type';

const ROLE_GROUPS = ['全部', '案例研习', '辩护人', '公诉人', '审判长'] as const;
const ROLE_LABEL: Record<string, string> = {
  all: '全员', common: '全员', student: '全员',
  defender: '辩护人', prosecution: '公诉人', prosecutor: '公诉人', judge: '审判长',
};
export default function TeacherScoringPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-muted-foreground">加载中...</div>}>
      <TeacherScoringContent />
    </Suspense>
  );
}

function TeacherScoringContent() {
  const params = useSearchParams();
  const caseId = params.get('caseId') || '';

  const [caseName, setCaseName] = useState('');
  const [caseType, setCaseType] = useState<CaseType>('criminal');
  const [draft, setDraft] = useState<ScoringStandards | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [roleTab, setRoleTab] = useState<string>('全部');
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/cases?id=${encodeURIComponent(caseId)}`);
        const result = await res.json();
        const c = result.case as CaseData | undefined;
        if (!alive || !c) return;
        setCaseName(c.name);
        setCaseType(normalizeCaseType(c.caseType));
        const parsed = parseScoringStandards(typeof c.scoringStandards === 'string' ? c.scoringStandards : c.judge);
        if (parsed) setDraft(structuredClone(parsed));
      } catch {
        /* ignore */
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [caseId]);

  const flashToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!caseId || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'generate_scoring', caseId }),
      });
      const result = await res.json();
      if (result.scoringStandards) {
        const parsed = parseScoringStandards(result.scoringStandards);
        if (parsed) {
          setDraft(structuredClone(parsed));
          setDirty(true);
          flashToast('AI 已按本案件资料重新生成，请检查后保存');
        }
      }
    } catch {
      flashToast('生成失败，请重试');
    }
    setGenerating(false);
  }, [caseId, generating, flashToast]);

  const handleSave = useCallback(async () => {
    if (!caseId || !draft || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_scoring', caseId, scoringStandards: draft }),
      });
      if (res.ok) {
        setDirty(false);
        flashToast('评分标准已保存并同步到学生端');
      } else {
        flashToast('保存失败，请重试');
      }
    } catch {
      flashToast('保存失败，请重试');
    }
    setSaving(false);
  }, [caseId, draft, saving, flashToast]);

  /* ---- 总标准维度 ---- */
  const updateDimension = (i: number, patch: Partial<ScoringDimension>) => {
    setDraft((d) => {
      if (!d) return d;
      const dims = d.overall.dimensions.map((dim, idx) => (idx === i ? { ...dim, ...patch } : dim));
      return { ...d, overall: { ...d.overall, dimensions: dims } };
    });
    setDirty(true);
  };
  const removeDimension = (i: number) => {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, overall: { ...d.overall, dimensions: d.overall.dimensions.filter((_, idx) => idx !== i) } };
    });
    setDirty(true);
  };
  const addDimension = () => {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, overall: { ...d.overall, dimensions: [...d.overall.dimensions, { name: '新维度', weight: 10, criteria: '考核要求' }] } };
    });
    setDirty(true);
  };

  /* ---- 评级档 ---- */
  const updateBand = (i: number, patch: Partial<GradingBand>) => {
    setDraft((d) => {
      if (!d) return d;
      const grading = d.overall.grading.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
      return { ...d, overall: { ...d.overall, grading } };
    });
    setDirty(true);
  };

  /* ---- 环节标准 ---- */
  const updateStage = (key: string, patch: Partial<ScoringStage>) => {
    setDraft((d) => {
      if (!d) return d;
      return { ...d, stages: d.stages.map((st) => (st.key === key ? { ...st, ...patch } : st)) };
    });
    setDirty(true);
  };
  const updateStagePoint = (key: string, pi: number, val: string) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        stages: d.stages.map((st) =>
          st.key === key ? { ...st, points: st.points.map((p, idx) => (idx === pi ? val : p)) } : st,
        ),
      };
    });
    setDirty(true);
  };
  const removeStagePoint = (key: string, pi: number) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        stages: d.stages.map((st) => (st.key === key ? { ...st, points: st.points.filter((_, idx) => idx !== pi) } : st)),
      };
    });
    setDirty(true);
  };
  const addStagePoint = (key: string) => {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        stages: d.stages.map((st) => (st.key === key ? { ...st, points: [...st.points, '新考核要点'] } : st)),
      };
    });
    setDirty(true);
  };

  const isArb = isAdversarial(caseType);
  // 仲裁 / 涉外诉讼：Tab 与徽标用该类型的角色名
  const advLabels = isArb ? ROLE_LABELS[caseType] : null;
  const roleGroups: readonly string[] = advLabels ? ['全部', advLabels.prosecutor, advLabels.defender, advLabels.judge] : ROLE_GROUPS;
  const roleLabel: Record<string, string> = advLabels ? { all: '全员', common: '全员', student: '全员', ...advLabels } : ROLE_LABEL;

  const visibleStages = useMemo(() => {
    if (!draft) return [];
    if (roleTab === '全部') return draft.stages;
    // 仲裁：把 Tab 标签映射回内部角色键再过滤；刑事保持原有行为
    const labels = isAdversarial(caseType) ? ROLE_LABELS[caseType] : null;
    const key = labels ? ((Object.entries(labels).find(([, v]) => v === roleTab)?.[0]) ?? roleTab) : roleTab;
    return draft.stages.filter((st) => st.roles.includes(key));
  }, [draft, roleTab, caseType]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PageHeader
        back={caseId ? `/teacher/case-detail?id=${encodeURIComponent(caseId)}` : '/teacher'}
        backLabel="案例"
        title={`评分标准 · ${caseName || '未命名案例'}`}
        subtitle={dirty ? '有未保存的修改' : '保存后学生端同步显示'}
        showLawSearch={false}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generating || saving}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {draft ? 'AI 重新生成' : 'AI 生成'}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={!draft || saving || generating || !dirty}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存
            </Button>
          </>
        }
      />

      {/* 主体：响应式双栏 + 滚动 */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-4 py-5 grid gap-5 xl:grid-cols-12">
          {!draft ? (
            <div className="xl:col-span-12 flex flex-col items-center gap-3 rounded-lg border border-dashed p-10 text-center">
              <p className="font-display text-lg text-foreground">这个案例还没有评分标准</p>
              <p className="max-w-md text-sm text-muted-foreground">AI 会依据案情、争议焦点和各训练环节的考核要点生成一份草稿，生成后可逐项修改再保存。学生在写作和评价环节会看到它。</p>
              <Button onClick={handleGenerate} disabled={generating}>
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {generating ? '正在生成…' : '用 AI 生成评分标准'}
              </Button>
            </div>
          ) : (
            <>
              {/* 左栏：总标准 + 评级 + 解锁规则 */}
              <section className="xl:col-span-5 space-y-5">
                <div className="border rounded-lg bg-card">
                  <div className="px-4 py-3 border-b flex items-center justify-between">
                    <h2 className="font-semibold text-sm flex items-center gap-2">
                      <span className="w-1 h-4 bg-primary rounded-sm" />
                      总标准 · 考核维度
                    </h2>
                    <Button variant="ghost" size="sm" onClick={addDimension}>
                      <Plus className="h-4 w-4 mr-1" />维度
                    </Button>
                  </div>
                  <div className="p-4 space-y-3">
                    {draft.overall.dimensions.map((dim, i) => (
                      <div key={i} className="border rounded-md p-3 bg-background/50 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={dim.name}
                            onChange={(e) => updateDimension(i, { name: e.target.value })}
                            className="h-8 text-sm font-medium flex-1"
                          />
                          <div className="flex items-center gap-1 shrink-0">
                            <Input
                              type="number"
                              value={dim.weight}
                              onChange={(e) => updateDimension(i, { weight: Number(e.target.value) || 0 })}
                              className="h-8 w-16 text-sm text-right"
                            />
                            <span className="text-xs text-muted-foreground">%</span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => removeDimension(i)} className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <Textarea
                          value={dim.criteria}
                          onChange={(e) => updateDimension(i, { criteria: e.target.value })}
                          className="text-xs min-h-16 leading-relaxed"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg bg-card">
                  <div className="px-4 py-3 border-b">
                    <h2 className="font-semibold text-sm flex items-center gap-2">
                      <span className="w-1 h-4 bg-primary rounded-sm" />
                      评级标准
                    </h2>
                  </div>
                  <div className="p-4 space-y-3">
                    {draft.overall.grading.map((band, i) => (
                      <div key={i} className="border rounded-md p-3 bg-background/50 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={band.band}
                            onChange={(e) => updateBand(i, { band: e.target.value })}
                            className="h-8 text-sm font-medium w-24"
                          />
                          <Input
                            value={band.range}
                            onChange={(e) => updateBand(i, { range: e.target.value })}
                            className="h-8 text-sm w-28 text-center"
                          />
                        </div>
                        <Textarea
                          value={band.desc}
                          onChange={(e) => updateBand(i, { desc: e.target.value })}
                          className="text-xs min-h-14 leading-relaxed"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg bg-card">
                  <div className="px-4 py-3 border-b">
                    <h2 className="font-semibold text-sm flex items-center gap-2">
                      <span className="w-1 h-4 bg-primary rounded-sm" />
                      AI 样例解锁规则
                    </h2>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-3">
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">评分达到（分）</span>
                      <Input
                        type="number"
                        value={draft.sampleUnlock.scoreThreshold}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setDraft({ ...draft, sampleUnlock: { ...draft.sampleUnlock, scoreThreshold: v } });
                          setDirty(true);
                        }}
                        className="h-9"
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">或评价满（次）</span>
                      <Input
                        type="number"
                        value={draft.sampleUnlock.evalCountThreshold}
                        onChange={(e) => {
                          const v = Number(e.target.value) || 0;
                          setDraft({ ...draft, sampleUnlock: { ...draft.sampleUnlock, evalCountThreshold: v } });
                          setDirty(true);
                        }}
                        className="h-9"
                      />
                    </label>
                    <p className="col-span-2 text-xs text-muted-foreground leading-relaxed">
                      学生文书评分达到上述分数（基本可以）或累计评价达到上述次数后，解锁「AI 样例」查看按钮。
                    </p>
                  </div>
                </div>
              </section>

              {/* 右栏：各环节标准 */}
              <section className="xl:col-span-7">
                <div className="border rounded-lg bg-card">
                  <div className="px-4 py-3 border-b space-y-2">
                    <h2 className="font-semibold text-sm flex items-center gap-2">
                      <span className="w-1 h-4 bg-primary rounded-sm" />
                      各环节标准
                      <Badge variant="secondary" className="ml-1">{draft.stages.length} 个环节</Badge>
                    </h2>
                    <Tabs value={roleTab} onValueChange={setRoleTab}>
                      <TabsList className="h-8 flex-wrap">
                        {roleGroups.map((r) => (
                          <TabsTrigger key={r} value={r} className="text-xs h-6 px-2.5">
                            {r}
                          </TabsTrigger>
                        ))}
                      </TabsList>
                    </Tabs>
                  </div>
                  <div className="p-4 space-y-4">
                    {visibleStages.length === 0 && (
                      <div className="text-xs text-muted-foreground py-6 text-center">该角色暂无环节标准</div>
                    )}
                    {visibleStages.map((st) => (
                      <div key={st.key} className="border rounded-md p-3.5 bg-background/50 space-y-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Input
                            value={st.name}
                            onChange={(e) => updateStage(st.key, { name: e.target.value })}
                            className="h-8 text-sm font-medium flex-1 min-w-32"
                          />
                          {st.roles.map((r) => (
                            <Badge key={r} variant="outline" className="text-[10px] shrink-0">
                              {roleLabel[r] ?? r}
                            </Badge>
                          ))}
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">考核要点</span>
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => addStagePoint(st.key)}>
                            <Plus className="h-3 w-3 mr-0.5" />要点
                          </Button>
                        </div>
                        <div className="space-y-1.5">
                          {st.points.map((p, pi) => (
                            <div key={pi} className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground font-mono w-5 shrink-0 text-right">
                                {String(pi + 1).padStart(2, '0')}
                              </span>
                              <Input
                                value={p}
                                onChange={(e) => updateStagePoint(st.key, pi, e.target.value)}
                                className="h-7 text-xs flex-1"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => removeStagePoint(st.key, pi)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          ))}
                        </div>
                        {st.dimensions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {st.dimensions.map((dim, di) => (
                              <Badge key={di} variant="secondary" className="text-[10px] font-normal">
                                {dim.name} {dim.weight}%
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </>
          )}
        </div>
      </main>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-foreground text-background text-sm px-4 py-2 rounded-md shadow-lg flex items-center gap-2">
          <RefreshCw className="h-3.5 w-3.5" />
          {toast}
        </div>
      )}
    </div>
  );
}
