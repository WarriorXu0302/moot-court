'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

import { useAppStore } from '@/lib/store';
import type { CaseData, UserRole } from '@/lib/types';
import { PageHeader } from '@/components/page-header';
import { Scale, Gavel, Shield, FileText, ChevronRight, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { parseScoringStandards } from '@/lib/scoring';
import { CASE_TYPE_LABEL, ROLE_LABELS, ROLE_DESC, normalizeCaseType, type CaseType } from '@/lib/case-type';

interface PersonalStats {
  id: string;
  caseName: string;
  role: string;
  score: number;
  lastTrainTime: number;
  lastStage: string;
  progress: number;
  trainCount: number;
}

const ROLE_ICONS: { value: UserRole; icon: React.ReactNode }[] = [
  { value: 'defender', icon: <Shield className="h-5 w-5" /> },
  { value: 'prosecutor', icon: <Gavel className="h-5 w-5" /> },
  { value: 'judge', icon: <Scale className="h-5 w-5" /> },
];

/** 刑事沿用原有「代表国家公诉」文案；其余按案件类型取 ROLE_DESC */
function roleInfoFor(caseType: CaseType): { value: UserRole; label: string; icon: React.ReactNode; desc: string }[] {
  return ROLE_ICONS.map((r) => ({
    value: r.value,
    icon: r.icon,
    label: ROLE_LABELS[caseType][r.value],
    desc: caseType === 'criminal' && r.value === 'prosecutor' ? '代表国家公诉' : ROLE_DESC[caseType][r.value],
  }));
}

export default function SelectCasePage() {
  const router = useRouter();
  const { selectedRole, setSelectedRole, selectedCase, setSelectedCase, user, hydrated } = useAppStore();
  const [cases, setCases] = useState<CaseData[]>([]);
  const [typeFilter, setTypeFilter] = useState<'all' | CaseType>('all');
  // 角色名随当前选中案例类型变化；未选案例时按刑事显示（与原行为一致）
  const activeCaseType: CaseType = normalizeCaseType(selectedCase?.caseType);
  const ROLE_INFO = roleInfoFor(activeCaseType);
  const visibleCases = typeFilter === 'all' ? cases : cases.filter((c) => normalizeCaseType(c.caseType) === typeFilter);
  // 目录里出现两种及以上类型时才显示筛选
  const presentTypes = (['arbitration', 'civil', 'criminal'] as const).filter((t) => cases.some((c) => normalizeCaseType(c.caseType) === t));
  const [loading, setLoading] = useState(true);
  const [personalStats, setPersonalStats] = useState<PersonalStats[]>([]);
  const [statsExpanded, setStatsExpanded] = useState(false);
  const [stdOpen, setStdOpen] = useState(false);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) {
      router.push('/');
      return;
    }
    fetchCases();
    fetchPersonalStats();
  }, [user, hydrated, router]);

  const fetchCases = async () => {
    try {
      const res = await fetch('/api/cases?status=published');
      const data = await res.json();
      if (data.cases) {
        setCases(data.cases);
      }
    } catch {
      // If no cases, create a demo case
    } finally {
      setLoading(false);
    }
  };

  const fetchPersonalStats = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/learning-records?student_id=${user.id}`);
      const data = await res.json();
      if (data.records) {
        // Group by case_id to count training sessions
        const caseMap = new Map<string, PersonalStats>();
        for (const r of data.records) {
          const existing = caseMap.get(r.caseName);
          if (existing) {
            existing.trainCount += 1;
            if (r.lastTrainTime > existing.lastTrainTime) {
              existing.lastTrainTime = r.lastTrainTime;
              existing.lastStage = r.lastStage;
              existing.progress = r.progress;
              existing.score = r.score;
            }
          } else {
            caseMap.set(r.caseName, {
              id: r.id,
              caseName: r.caseName,
              role: r.role,
              score: r.score,
              lastTrainTime: r.lastTrainTime,
              lastStage: r.lastStage,
              progress: r.progress,
              trainCount: 1,
            });
          }
        }
        setPersonalStats(Array.from(caseMap.values()).sort((a, b) => b.lastTrainTime - a.lastTrainTime));
      }
    } catch {
      // ignore
    }
  };

  const handleSelectCase = (c: CaseData) => {
    setSelectedCase(c);
  };

  const handleEnter = () => {
    if (!selectedRole) return;
    if (!selectedCase) return;
    // 记录本次学习开始时间：从选择案例进入训练起算，到结束分析为一次学习
    useAppStore.getState().setTrainingStartTime(Date.now());
    router.push('/student/case-detail');
  };

  const std = selectedCase ? parseScoringStandards(selectedCase.scoringStandards) : null;
  const selectedRoleInfo = ROLE_INFO.find((r) => r.value === selectedRole);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <PageHeader title="选择训练案例" subtitle="先选案例，再选你在本案中的角色" />

      {/* 两栏各自滚动：左=案例目录，右=案例卷宗封面 + 角色 + 进入 */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex shrink-0 flex-col border-b bg-card lg:w-[380px] lg:border-b-0 lg:border-r xl:w-[420px]">
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
            <h2 className="font-display text-base font-semibold">案例目录</h2>
            {presentTypes.length > 1 && (
              <div className="flex gap-1">
                {(['all', ...presentTypes] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeFilter(t)}
                    aria-pressed={typeFilter === t}
                    className={`rounded-sm px-2 py-0.5 text-xs ${typeFilter === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
                  >
                    {t === 'all' ? '全部' : CASE_TYPE_LABEL[t]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="max-h-64 overflow-y-auto px-2 pb-3 scroll-thin lg:max-h-none lg:flex-1">
            {loading ? (
              <div className="space-y-2 p-2" aria-busy="true">
                {[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />)}
              </div>
            ) : visibleCases.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                <FileText className="mx-auto mb-2 h-6 w-6 opacity-50" />
                老师还没有发布案例。发布后会出现在这里。
              </div>
            ) : (
              <ol className="space-y-1">
                {visibleCases.map((c, i) => {
                  const active = selectedCase?.id === c.id;
                  const done = personalStats.find((x) => x.caseName === c.name);
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectCase(c)}
                        aria-current={active ? 'true' : undefined}
                        className={`group flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors ${active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
                      >
                        <span className={`font-display text-sm tabular-nums ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="line-clamp-2 text-sm font-medium leading-snug">{c.name}</span>
                          <span className={`mt-0.5 block text-xs ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                            {CASE_TYPE_LABEL[normalizeCaseType(c.caseType)]}
                            {done ? ` · 已训练 ${done.trainCount} 次` : ''}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {/* 我的训练记录：放在目录底部，默认收起 */}
          <div className="border-t">
            <button
              type="button"
              onClick={() => setStatsExpanded(!statsExpanded)}
              aria-expanded={statsExpanded}
              className="flex w-full items-center justify-between px-4 py-2.5 text-sm hover:bg-accent"
            >
              <span className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                我的训练记录
                <span className="text-xs text-muted-foreground">{personalStats.length} 个案例</span>
              </span>
              {statsExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {statsExpanded && (
              <div className="max-h-56 overflow-y-auto border-t scroll-thin">
                {personalStats.length === 0 ? (
                  <p className="px-4 py-6 text-center text-xs text-muted-foreground">还没有训练记录。完成一次训练后会出现在这里。</p>
                ) : (
                  <ul className="divide-y">
                    {personalStats.map((st) => (
                      <li key={st.id}>
                        <button
                          type="button"
                          onClick={() => router.push(`/student/learning-detail?caseName=${encodeURIComponent(st.caseName)}`)}
                          className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-accent"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm">{st.caseName}</span>
                            <span className="block text-xs text-muted-foreground">
                              {st.lastStage || '—'} · {st.lastTrainTime > 0 ? new Date(st.lastTrainTime).toLocaleDateString() : '—'}
                            </span>
                          </span>
                          <span className={`font-display text-base tabular-nums ${st.score >= 80 ? 'text-primary' : st.score > 0 && st.score < 60 ? 'text-destructive' : 'text-foreground'}`}>
                            {st.score > 0 ? st.score : '—'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          {!selectedCase ? (
            <div className="hidden h-full min-h-[320px] flex-col items-center justify-center gap-2 px-6 text-center lg:flex">
              <p className="font-display text-xl text-foreground">在案例目录里选一个案例</p>
              <p className="max-w-sm text-sm text-muted-foreground">每个案例都来自真实裁判。你会先研读案情，再以当事人代理人、审判长或首席仲裁员的身份走完整个程序。</p>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl px-5 py-8 lg:px-10">
              {/* 卷宗封面 */}
              <p className="text-sm text-muted-foreground">{CASE_TYPE_LABEL[activeCaseType]}</p>
              <h2 className="mt-1 font-display text-2xl font-semibold leading-snug text-foreground lg:text-[1.75rem]">{selectedCase.name}</h2>

              <section className="mt-6 space-y-5 border-t pt-6">
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">案件概要</h3>
                  <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-foreground/85">{selectedCase.profile}</p>
                </div>
                <div>
                  <h3 className="mb-1.5 text-sm font-semibold text-foreground">你会练到什么</h3>
                  <p className="whitespace-pre-wrap text-[0.95rem] leading-relaxed text-foreground/85">{selectedCase.teach}</p>
                </div>
              </section>

              {/* 角色：名称随案件类型变化 */}
              <section className="mt-8">
                <h3 className="mb-3 text-sm font-semibold text-foreground">选择你的角色</h3>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="选择角色">
                  {ROLE_INFO.map((r) => {
                    const active = selectedRole === r.value;
                    return (
                      <button
                        key={r.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setSelectedRole(r.value)}
                        className={`flex flex-col items-start gap-1.5 rounded-md border p-3 text-left transition-colors ${active ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:border-foreground/30 hover:bg-accent'}`}
                      >
                        <span className={active ? 'text-primary' : 'text-muted-foreground'}>{r.icon}</span>
                        <span className="text-sm font-semibold">{r.label}</span>
                        <span className="text-xs leading-snug text-muted-foreground">{r.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <div className="sticky bottom-0 -mx-5 mt-6 border-t bg-background/95 px-5 py-4 backdrop-blur lg:-mx-10 lg:px-10">
                <Button onClick={handleEnter} disabled={!selectedRole} size="lg" className="w-full sm:w-auto">
                  {selectedRoleInfo ? `以${selectedRoleInfo.label}身份开始训练` : '先选择一个角色'}
                  {selectedRoleInfo && <ChevronRight className="h-4 w-4" />}
                </Button>
              </div>

              {std && (
                <div className="mt-2 rounded-md border">
                  {/* 不用原生 details/summary：沙箱 Chromium 渲染会崩溃（见 AGENTS.md） */}
                  <button
                    type="button"
                    onClick={() => setStdOpen((v) => !v)}
                    aria-expanded={stdOpen}
                    className="flex w-full items-center justify-between px-4 py-3 text-sm font-semibold"
                  >
                    评分标准
                    <ChevronDown className={`h-4 w-4 transition-transform ${stdOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {stdOpen && (
                  <div className="space-y-4 border-t px-4 py-3 text-sm">
                    <div className="space-y-1.5">
                      {std.overall.dimensions.map((d) => (
                        <div key={d.name} className="flex gap-3">
                          <span className="w-28 shrink-0 font-medium">{d.name}<span className="ml-1 text-xs text-muted-foreground tabular-nums">{d.weight}%</span></span>
                          <span className="text-muted-foreground">{d.criteria}</span>
                        </div>
                      ))}
                    </div>
                    <div className="grid gap-1.5 border-t pt-3 sm:grid-cols-2">
                      {std.overall.grading.map((g) => (
                        <div key={g.band} className="text-xs"><span className="font-medium">{g.band}（{g.range}）</span><span className="text-muted-foreground"> {g.desc}</span></div>
                      ))}
                    </div>
                  </div>
                  )}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
