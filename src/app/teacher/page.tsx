'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';

import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

import { useAppStore } from '@/lib/store';

import { PageHeader } from '@/components/page-header';
import { formatDuration } from '@/lib/learning-log';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { CaseData, LearningSession } from '@/lib/types';
import { CASE_TYPE_LABEL, EMPTY_ARBITRATION_META, ARBITRATION_RULES, type CaseType, type ArbitrationMeta } from '@/lib/case-type';
import { Scale, Plus, Eye, Trash2, Upload, Loader2, Users, Clock, Timer, BarChart3, List } from 'lucide-react';

const WORKFLOW_CASE_DESIGN_ID = '7656623831193223210';
const WORKFLOW_DOCUMENTS_ID = '7656793461539356723';

type CaseStatus = 'generating' | 'generated' | 'published' | 'offline';

interface CaseListItem {
  id: string;
  name: string;
  status: CaseStatus;
  createdAt: number;
  updatedAt: number;
  data?: CaseData;
  workflowExecutionId?: string;
}

interface LearningStatsItem {
  id: string;
  caseName: string;
  studentName: string;
  role: string;
  score: number;
  summary: string;
  evaluation: string;
  suggestion: string;
  lastTrainTime: number;
  lastStage: string;
  progress: number;
}

function TeacherPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, hydrated } = useAppStore();
  const [caseList, setCaseList] = useState<CaseListItem[]>([]);
  const [designNeed, setDesignNeed] = useState('');
  const [designing, setDesigning] = useState(false);
  // 案件类型与仲裁元数据（仅 caseType=arbitration 时使用）
  const [showOffline, setShowOffline] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [designCaseType, setDesignCaseType] = useState<CaseType>('arbitration');
  const [arbMeta, setArbMeta] = useState<ArbitrationMeta>(EMPTY_ARBITRATION_META);
  const [arbIssuesText, setArbIssuesText] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CaseListItem | null>(null);
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [learningStats, setLearningStats] = useState<LearningStatsItem[]>([]);
  const [sessions, setSessions] = useState<LearningSession[]>([]);
  const [sessionDetail, setSessionDetail] = useState<LearningSession | null>(null);
  const [sessionDetailLoading, setSessionDetailLoading] = useState(false);
  const [sessionsListOpen, setSessionsListOpen] = useState(false);
  const [overviewListOpen, setOverviewListOpen] = useState(false);
  const [statsTab, setStatsTab] = useState<'sessions' | 'overview'>('sessions');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (searchParams.get('from') === 'home') {
      setLoading(true);
      const timer = setTimeout(() => setLoading(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user || user.role !== 'teacher') {
      router.push('/');
      return;
    }
    if (searchParams.get('from') !== 'home') {
      fetchCases();
      fetchLearningStats();
      fetchSessions();
    }
  }, [user, hydrated, router, searchParams]);

  // Fetch data after loading animation finishes
  useEffect(() => {
    if (!loading && user && user.role === 'teacher' && searchParams.get('from') === 'home') {
      fetchCases();
      fetchLearningStats();
      fetchSessions();
    }
  }, [loading, user, searchParams]);

  const fetchCases = async () => {
    try {
      const res = await fetch('/api/cases');
      const data = await res.json();
      if (data.cases) {
        const mapped: CaseListItem[] = data.cases.map((c: CaseData) => ({
          id: c.id,
          name: c.name,
          status: (c.status as CaseStatus) || 'generated',
          createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
          updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
          data: c,
          workflowExecutionId: c.workflowExecutionId,
        }));
        setCaseList(mapped);
        // 一个案例都没有时，直接展开设计表单
        if (mapped.length === 0) setDesignOpen(true);

        // Recover any pending workflows (case design or legal docs)
        // This runs server-side so it works even after page refresh
        checkPendingWorkflows();

        // For cases still generating, start client-side polling as well
        for (const c of mapped) {
          if (c.status === 'generating' && c.workflowExecutionId) {
            pollCaseDesignWorkflow(c.id, c.workflowExecutionId);
          }
        }

        // 仲裁案例由服务端同步生成（无工作流 execute_id）：教师在生成中途刷新页面会丢失那次请求，
        // 超过 8 分钟（服务端上限 5 分钟 + 余量）仍为 generating 视为失败，释放该行以便删除重试
        const STALE_MS = 8 * 60 * 1000;
        for (const c of mapped) {
          if (c.status === 'generating' && !c.workflowExecutionId && c.data?.caseType === 'arbitration' && Date.now() - c.updatedAt > STALE_MS) {
            fetch('/api/cases', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: c.id, name: '生成失败', status: 'generated' }),
            }).catch(() => {});
            setCaseList((prev) => prev.map((x) => x.id === c.id ? { ...x, name: '生成失败', status: 'generated' as CaseStatus } : x));
          }
        }
      }
    } catch { /* empty */ }
  };

  const checkPendingWorkflows = async () => {
    try {
      const res = await fetch('/api/cases/check-pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const result = await res.json();
      if (result.success && result.recovered?.length > 0) {
        // Some cases were recovered, refresh the list
        const refetched = await fetch('/api/cases');
        const refetchedData = await refetched.json();
        if (refetchedData.cases) {
          setCaseList(refetchedData.cases.map((c: CaseData) => ({
            id: c.id,
            name: c.name,
            status: (c.status as CaseStatus) || 'generated',
            createdAt: c.createdAt ? new Date(c.createdAt).getTime() : Date.now(),
            updatedAt: c.updatedAt ? new Date(c.updatedAt).getTime() : Date.now(),
            data: c,
          })));
        }
      }
    } catch { /* empty */ }
  };

  const fetchLearningStats = async () => {
    try {
      const res = await fetch('/api/learning-records');
      const data = await res.json();
      if (data.records) {
        setLearningStats(data.records);
      }
    } catch { /* empty */ }
  };

  // 学习场次（每次学习一条：从选择案例到结束分析），教师端宏观统计数据源
  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/learning-sessions');
      const data = await res.json();
      if (data.sessions) {
        setSessions(data.sessions);
      }
    } catch { /* empty */ }
  };

  // 查看某次学习的完整详情（当次全部学习记录：环节对话/点评/行为轨迹/文书）
  const openSessionDetail = async (sessionId: string) => {
    setSessionDetailLoading(true);
    try {
      const res = await fetch(`/api/learning-sessions?id=${sessionId}&detail=1`);
      const data = await res.json();
      if (data.sessions && data.sessions[0]) {
        setSessionDetail(data.sessions[0]);
      }
    } catch { /* empty */ } finally {
      setSessionDetailLoading(false);
    }
  };

  const handleDesign = async () => {
    if (!designNeed.trim()) return;
    setDesigning(true);

    // 国际仲裁：不走 Coze 刑事工作流，服务端直接按元数据生成（见 api/cases action=generate_arbitration）
    if (designCaseType === 'arbitration') {
      try {
        const meta: ArbitrationMeta = {
          ...arbMeta,
          issues: arbIssuesText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .map((title, i) => ({ id: `issue-${i + 1}`, title, type: 'merits' as const })),
        };
        const saveRes = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save',
            caseType: 'arbitration',
            meta,
            caseData: {
              name: '生成中...', profile: '', teach: '', case: '', plead: '', record: '', evidence: '', law: '', wrong: '',
              creatorName: user?.nickname || '李璎霖',
              status: 'generating',
              caseType: 'arbitration',
              meta,
            },
          }),
        });
        const saveData = await saveRes.json();
        const caseDbId: string | undefined = saveData?.data?.id;
        if (!caseDbId) { setDesigning(false); return; }

        const placeholder: CaseListItem = {
          id: caseDbId,
          name: '生成中...',
          status: 'generating',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          data: { ...(saveData.data as CaseData) },
        };
        setCaseList((prev) => [placeholder, ...prev]);
        const need = designNeed.trim();
        setDesignNeed('');
        setDesigning(false);

        // 同步等待生成（服务端 maxDuration 300s），完成后用返回数据替换占位行
        const genRes = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate_arbitration', caseId: caseDbId, need, meta }),
        });
        const genData = await genRes.json();
        if (genRes.ok && genData?.data) {
          const c = genData.data as CaseData;
          setCaseList((prev) => prev.map((x) => x.id === caseDbId ? {
            id: c.id, name: c.name, status: (c.status as CaseStatus) || 'generated',
            createdAt: x.createdAt, updatedAt: Date.now(), data: c,
          } : x));
        } else {
          setCaseList((prev) => prev.map((x) => x.id === caseDbId ? { ...x, name: '生成失败', status: 'generated' as CaseStatus } : x));
        }
      } catch {
        /* fallback：失败行保留为「生成失败」，由教师删除后重试 */
      } finally {
        setDesigning(false);
      }
      return;
    }

    try {
      const res = await fetch('/api/workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: WORKFLOW_CASE_DESIGN_ID,
          parameters: { need: designNeed.trim() },
          async: true,
        }),
      });
      const data = await res.json();
      const execId = data?.data?.execute_id || data?.execute_id || data?.executionId;

      if (!execId) {
        setDesigning(false);
        return;
      }

      // Immediately insert a case row in DB so the workflow can be recovered
      // even if the teacher refreshes the page
      const saveRes = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save',
          caseData: {
            id: execId,
            name: '生成中...',
            profile: '',
            teach: '',
            case: '',
            plead: '',
            record: '',
            evidence: '',
            law: '',
            wrong: '',
            creatorName: user?.nickname || '李璎霖',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'generating',
          },
          workflowExecutionId: execId,
        }),
      });
      const saveData = await saveRes.json();
      const caseDbId = saveData?.data?.id || execId;

      const newItem: CaseListItem = {
        id: caseDbId,
        name: '生成中...',
        status: 'generating',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workflowExecutionId: execId,
      };
      setCaseList((prev) => [newItem, ...prev]);
      setDesignNeed('');

      // Start client-side polling for faster feedback (server-side recovery also runs on page load)
      pollCaseDesignWorkflow(caseDbId, execId);
    } catch {
      /* fallback */
    } finally {
      setDesigning(false);
    }
  };

  const pollCaseDesignWorkflow = (caseDbId: string, execId: string) => {
    const poll = async () => {
      try {
        const histRes = await fetch(`/api/workflow/history?executeId=${execId}&workflowId=${WORKFLOW_CASE_DESIGN_ID}`);
        const histData = await histRes.json();
        if (histData.status === 'completed' && histData.data) {
          const output = histData.data;
          const newCaseData: CaseData = {
            id: caseDbId,
            name: output.name || '未命名案例',
            profile: output.profile || '',
            teach: output.teach || '',
            case: output.case || '',
            plead: output.plead || '',
            record: output.record || '',
            evidence: output.evidence || '',
            law: output.law || '',
            wrong: output.wrong || '',
            creatorName: user?.nickname || '李璎霖',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'generated',
          };
          // Update existing case row (not insert)
          await fetch('/api/cases', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: caseDbId,
              name: newCaseData.name,
              profile: newCaseData.profile,
              teach: newCaseData.teach,
              case: newCaseData.case,
              plead: newCaseData.plead,
              record: newCaseData.record,
              evidence: newCaseData.evidence,
              law: newCaseData.law,
              wrong: newCaseData.wrong,
              status: 'generated',
            }),
          });
          setCaseList((prev) => prev.map((c) =>
            c.id === caseDbId ? {
              ...c,
              name: newCaseData.name,
              status: 'generated' as CaseStatus,
              updatedAt: Date.now(),
              data: newCaseData,
            } : c
          ));
        } else if (histData.status === 'failed') {
          await fetch('/api/cases', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: caseDbId, name: '生成失败', status: 'generated' }),
          });
          setCaseList((prev) => prev.map((c) =>
            c.id === caseDbId ? { ...c, name: '生成失败', status: 'generated' as CaseStatus } : c
          ));
        } else {
          setTimeout(poll, 60000);
        }
      } catch {
        setTimeout(poll, 60000);
      }
    };
    setTimeout(poll, 120000);
  };

  const handleViewCase = (item: CaseListItem) => {
    if (item.status === 'generating') {
      setGeneratingMsg(true);
      return;
    }
    router.push(`/teacher/case-detail?id=${item.id}`);
  };

  const handlePublish = async (item: CaseListItem) => {
    if (item.status === 'generating') return;

    if (item.status === 'generated' || item.status === 'offline') {
      try {
        const res = await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'publish',
            caseData: item.data,
            caseId: item.id,
          }),
        });
        const data = await res.json();
        if (data.success) {
          // 仲裁案例跳过刑事文书工作流（会用刑事内容覆盖 indictment/defense/prosecution/person 等列）
          if (item.status === 'generated' && item.data?.caseType !== 'arbitration') {
            try {
              const wfRes = await fetch('/api/workflow/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  workflowId: WORKFLOW_DOCUMENTS_ID,
                  parameters: {
                    name: item.data?.name || '',
                    case: item.data?.case || '',
                    plead: typeof item.data?.plead === 'string' ? item.data.plead : JSON.stringify(item.data?.plead || []),
                    record: typeof item.data?.record === 'string' ? item.data.record : JSON.stringify(item.data?.record || []),
                    evidence: typeof item.data?.evidence === 'string' ? item.data.evidence : JSON.stringify(item.data?.evidence || []),
                    law: typeof item.data?.law === 'string' ? item.data.law : JSON.stringify(item.data?.law || []),
                  },
                  isAsync: true,
                }),
              });
              const wfData = await wfRes.json();
              const executeId = wfData?.data?.execute_id || wfData?.execute_id;
              if (executeId) {
                // Save generate_execute_id to DB so it can be recovered after refresh
                await fetch('/api/cases', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ id: item.id, generateExecuteId: executeId }),
                });
                setCaseList((prev) => prev.map((c) =>
                  c.id === item.id ? { ...c, workflowExecutionId: executeId } : c
                ));
                pollWorkflowResult(item.id, executeId);
              }
            } catch { /* workflow trigger error */ }
          }
          setCaseList((prev) => prev.map((c) =>
            c.id === item.id ? { ...c, status: 'published', updatedAt: Date.now() } : c
          ));
        }
      } catch { /* error */ }
    } else if (item.status === 'published') {
      try {
        await fetch('/api/cases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'offline', caseId: item.id }),
        });
        setCaseList((prev) => prev.map((c) =>
          c.id === item.id ? { ...c, status: 'offline' } : c
        ));
      } catch { /* error */ }
    }
  };

  const pollWorkflowResult = useCallback((caseId: string, executeId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/workflow/history?executeId=${executeId}&workflowId=${WORKFLOW_DOCUMENTS_ID}`);
        const result = await res.json();
        if (result.status === 'completed' && result.data) {
          let docs = result.data.Output || result.data.output || result.data;
          if (typeof docs === 'string') { try { docs = JSON.parse(docs); } catch { /* keep as string */ } }
          await fetch('/api/cases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_documents',
              caseId,
              documents: {
                indictment: docs.indictment || '',
                prosecution: docs.prosecution || '',
                defense: docs.defense || '',
                victim: docs.victim || '',
                plan: docs.plan || '',
                person: docs.person || '',
              },
            }),
          });
          setCaseList((prev) => prev.map((c) =>
            c.id === caseId ? {
              ...c,
              data: {
                ...c.data,
                indictment: docs.indictment || '',
                prosecution: docs.prosecution || '',
                defense: docs.defense || '',
                victim: docs.victim || '',
                plan: docs.plan || '',
                person: docs.person || '',
              } as CaseData,
            } : c
          ));
        } else if (result.status === 'failed') {
          /* stop polling */
        } else {
          setTimeout(poll, 30000);
        }
      } catch {
        setTimeout(poll, 30000);
      }
    };
    setTimeout(poll, 30000);
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await fetch(`/api/cases?id=${deleteTarget.id}`, { method: 'DELETE' });
      setCaseList((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    } catch { /* error */ }
    setDeleteTarget(null);
  };

  const getStatusBadge = (status: CaseStatus) => {
    const map: Record<CaseStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      generating: { label: '正在生成', variant: 'secondary' },
      generated: { label: '待审核', variant: 'outline' },
      published: { label: '已发布', variant: 'default' },
      offline: { label: '已下线', variant: 'destructive' },
    };
    const config = map[status];
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };


  // 案例列表：在用的（生成中/待审核/已发布）在前；已下线的默认折叠，免得 10 个停用的刑事案例淹没 6 个仲裁案例
  const activeCases = caseList.filter(c => c.status !== 'offline');
  const offlineCases = caseList.filter(c => c.status === 'offline');
  const visibleCases = showOffline ? [...activeCases, ...offlineCases] : activeCases;

  // 角色中文映射（学习场次列表展示用）
  const ROLE_LABELS: Record<string, string> = { defender: '辩护人', prosecutor: '公诉人', judge: '审判长' };

  // 按学生聚合的宏观总览：学习总次数、学习总时长（跨全部案例）
  const studentOverview = (() => {
    const map = new Map<string, { studentId: string; studentName: string; orgName: string; totalSessions: number; totalSeconds: number; lastTime: number }>();
    for (const s of sessions) {
      const key = s.studentId;
      const existing = map.get(key);
      if (existing) {
        existing.totalSessions += 1;
        existing.totalSeconds += s.durationSeconds;
        if (s.endedAt > existing.lastTime) existing.lastTime = s.endedAt;
      } else {
        map.set(key, {
          studentId: s.studentId,
          studentName: s.studentName || s.studentId,
          orgName: s.orgName || '',
          totalSessions: 1,
          totalSeconds: s.durationSeconds,
          lastTime: s.endedAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);
  })();

  const getCaseStats = (caseId: string) => {
    const caseData = caseList.find(c => c.id === caseId);
    if (!caseData) return null;
    const caseRecords = learningStats.filter(s => s.caseName === caseData.name);
    const uniqueStudents = new Set(caseRecords.map(r => r.studentName)).size;
    const totalTrainings = caseRecords.length;
    const lastTrainTime = caseRecords.length > 0
      ? Math.max(...caseRecords.map(r => r.lastTrainTime))
      : 0;
    return {
      name: caseData.name,
      updatedAt: caseData.updatedAt,
      traineeCount: uniqueStudents,
      trainCount: totalTrainings,
      lastTrainTime,
    };
  };

  // 学情表：已发布的全部列出；已下线的只在确有训练记录时列出（历史数据仍可查）
  const publishedCases = [
    ...caseList.filter(c => c.status === 'published'),
    ...caseList.filter(c => c.status === 'offline' && (getCaseStats(c.id)?.trainCount ?? 0) > 0),
  ];

  // 未确认是教师身份前不渲染教师界面：守卫跳转发生在 effect 里，渲染本身若不拦，
  // 未登录访问者会先看到一帧完整的教师页外壳再被弹走。
  // 必须放在所有 hook 之后（早返回不能夹在 hook 中间）。
  if (!hydrated || !user || user.role !== 'teacher') return null;

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-background">
        <div className="relative mb-8">
          <div className="w-16 h-16 rounded-full border-[3px] border-primary/20" />
          <div className="absolute inset-0 w-16 h-16 rounded-full border-[3px] border-transparent border-t-primary animate-spin" />
          <Scale className="h-7 w-7 absolute inset-0 m-auto text-primary/60" />
        </div>
        <h2 className="text-lg font-semibold text-foreground mb-1">模拟法庭教学系统</h2>
        <p className="text-sm text-muted-foreground mb-6">正在进入教师管理端...</p>
        <div className="w-48 h-1 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary rounded-full teacher-loading-bar" />
        </div>
        <style jsx>{`
          @keyframes teacher-loading-bar {
            0% { width: 0%; }
            100% { width: 100%; }
          }
          .teacher-loading-bar {
            animation: teacher-loading-bar 3s ease-out forwards;
          }
        `}</style>
      </div>
    );
  }

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      <PageHeader title="教师工作台" subtitle="案例审核与发布 · 学生训练学情" />

      <div className="flex-1 overflow-y-auto lg:overflow-hidden px-3 sm:px-4 py-3 flex flex-col lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-1 gap-4">
        {/* 右列：训练学情（主表）+ 场次/总览页签 */}
        <div className="order-2 flex shrink-0 flex-col gap-4 lg:order-none lg:col-start-2 lg:min-h-0 lg:shrink">
        {/* Right top: Learning stats - case-based training overview */}
        <Card className="flex h-[300px] shrink-0 flex-col gap-2 py-3 lg:h-auto lg:min-h-0 lg:flex-1">
          <CardHeader className="pb-0 shrink-0 px-4">
            <div className="flex items-baseline gap-2 min-w-0">
              <CardTitle className="flex items-center gap-2 font-display text-base shrink-0">
                各案例训练情况
              </CardTitle>
              <CardDescription className="text-xs truncate">点击一行查看该案例的学生表现</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 pb-1 px-4 overflow-hidden">
            <div className="h-full overflow-y-auto overflow-x-auto scroll-thin">
              {publishedCases.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  暂无已发布的训练案例
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-card z-10">
                    <tr className="border-b">
                      <th className="text-left py-1.5 px-3 font-medium text-muted-foreground whitespace-nowrap">案例名</th>
                      <th className="text-right py-1.5 px-3 font-medium text-muted-foreground whitespace-nowrap">训练人数</th>
                      <th className="text-right py-1.5 px-3 font-medium text-muted-foreground whitespace-nowrap">训练次数</th>
                      <th className="text-right py-1.5 px-3 font-medium text-muted-foreground whitespace-nowrap">最后训练</th>
                    </tr>
                  </thead>
                  <tbody>
                    {publishedCases.map((c) => {
                      const stats = getCaseStats(c.id);
                      return (
                        <tr key={c.id} className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => router.push(`/teacher/learning-detail?id=${c.id}`)}
                        >
                          <td className="py-1.5 px-3 font-medium"><div className="max-w-[22em] truncate" title={c.name}>{c.name}</div></td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{stats?.traineeCount ?? 0}</td>
                          <td className="py-1.5 px-3 text-right tabular-nums">{stats?.trainCount ?? 0}</td>
                          <td className="py-1.5 px-3 text-right whitespace-nowrap tabular-nums text-muted-foreground">
                            {stats && stats.lastTrainTime > 0
                              ? new Date(stats.lastTrainTime).toLocaleDateString()
                              : '暂无'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 右下：场次与总览是同一批训练数据的两个视角，合并为页签，一次只展示一张，避免两张表并排被压到只剩 2-3 行 */}
        <div className="flex h-[340px] shrink-0 flex-col gap-2 lg:h-auto lg:min-h-0 lg:flex-1">
          <div role="tablist" aria-label="训练数据视角" className="flex shrink-0 gap-1 rounded-lg bg-muted p-1 text-sm">
            {([['sessions', '学习场次'], ['overview', '学生总览']] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statsTab === key}
                onClick={() => setStatsTab(key)}
                className={`flex-1 rounded-md px-3 py-1.5 font-medium transition-colors ${statsTab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {label}
              </button>
            ))}
          </div>
        {/* Right middle: session list - each training session one row */}
        <Card className={`flex flex-col min-h-0 flex-1 gap-2 py-3 ${statsTab === 'sessions' ? '' : 'hidden'}`}>
            <CardHeader className="pb-0 shrink-0 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="flex items-center gap-2 font-display text-base shrink-0">
                  学习场次统计
                </CardTitle>
                <CardDescription className="text-xs truncate flex-1">每一次学习（选择案例→结束分析）一条记录，点击查看当次全部学习记录</CardDescription>
                <Button variant="outline" size="sm" className="shrink-0 h-7 text-xs" onClick={() => setSessionsListOpen(true)}>
                  <List className="h-3.5 w-3.5 mr-1" />
                  查看详情
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pb-1 px-4 overflow-hidden">
              <div className="h-full overflow-y-auto overflow-x-auto scroll-thin">
                {sessions.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Timer className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    暂无学习场次记录
                  </div>
                ) : (
                  <table className="w-full text-sm min-w-[560px]">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b">
                        <th className="text-left py-0.5 px-2 font-semibold whitespace-nowrap">学生</th>
                        <th className="text-left py-0.5 px-2 font-semibold whitespace-nowrap">案例</th>
                        <th className="text-center py-0.5 px-2 font-semibold whitespace-nowrap">角色</th>
                        <th className="text-center py-0.5 px-2 font-semibold whitespace-nowrap">学习时长</th>
                        <th className="text-center py-0.5 px-2 font-semibold whitespace-nowrap">评价得分</th>
                        <th className="text-left py-0.5 px-2 font-semibold whitespace-nowrap">结束时间</th>
                        <th className="text-center py-0.5 px-2 font-semibold whitespace-nowrap">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s) => (
                        <tr key={s.id} className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => openSessionDetail(s.id)}
                        >
                          <td className="py-0.5 px-2 font-medium whitespace-nowrap">{s.studentName || s.studentId}</td>
                          <td className="py-0.5 px-2 max-w-[18em] truncate" title={s.caseName}>{s.caseName}</td>
                          <td className="py-0.5 px-2 text-center whitespace-nowrap">
                            <Badge variant="outline">{ROLE_LABELS[s.role] || s.role}</Badge>
                          </td>
                          <td className="py-0.5 px-2 text-center whitespace-nowrap">
                            <Clock className="h-3 w-3 inline mr-1 text-muted-foreground" />
                            {s.durationSeconds > 0 ? formatDuration(s.durationSeconds) : '—'}
                          </td>
                          <td className="py-0.5 px-2 text-center">
                            {typeof s.score === 'number' ? (
                              <Badge variant={s.score >= 80 ? 'default' : s.score >= 60 ? 'secondary' : 'destructive'}>{s.score}分</Badge>
                            ) : '—'}
                          </td>
                          <td className="py-0.5 px-2 text-muted-foreground whitespace-nowrap">
                            {s.endedAt ? new Date(s.endedAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-0.5 px-2 text-center">
                            <Button size="sm" variant="outline" className="h-6 text-xs"
                              disabled={sessionDetailLoading}
                              onClick={(e) => { e.stopPropagation(); openSessionDetail(s.id); }}
                            >
                              <Eye className="h-3 w-3 mr-1" />
                              查看
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Right bottom: student overview - total sessions and total duration */}
          <Card className={`flex flex-col min-h-0 flex-1 gap-2 py-3 ${statsTab === 'overview' ? '' : 'hidden'}`}>
            <CardHeader className="pb-0 shrink-0 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="flex items-center gap-2 font-display text-base shrink-0">
                  学生总览统计
                </CardTitle>
                <CardDescription className="text-xs truncate flex-1">按学生汇总全部案例的宏观数据：学习总次数与学习总时长</CardDescription>
                <Button variant="outline" size="sm" className="shrink-0 h-7 text-xs" onClick={() => setOverviewListOpen(true)}>
                  <List className="h-3.5 w-3.5 mr-1" />
                  查看详情
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 pb-1 px-4 overflow-hidden">
              <div className="h-full overflow-y-auto overflow-x-auto scroll-thin">
                {studentOverview.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    暂无学生学习数据
                  </div>
                ) : (
                  <table className="w-full text-sm min-w-[420px]">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b">
                        <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">学生</th>
                        <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">学习总次数</th>
                        <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">学习总时长</th>
                        <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">最近学习</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentOverview.map((s) => (
                        <tr key={s.studentId} className="border-b hover:bg-muted/50">
                          <td className="py-0.5 px-3 font-medium whitespace-nowrap">{s.studentName}</td>
                          <td className="py-0.5 px-3 text-center">
                            <Badge variant="default">{s.totalSessions}次</Badge>
                          </td>
                          <td className="py-0.5 px-3 text-center whitespace-nowrap">
                            <Clock className="h-3 w-3 inline mr-1 text-muted-foreground" />
                            {formatDuration(s.totalSeconds)}
                          </td>
                          <td className="py-0.5 px-3 text-muted-foreground whitespace-nowrap">
                            {s.lastTime ? new Date(s.lastTime).toLocaleString() : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        </div>

        {/* 左列：设计案例 + 案例列表 */}
        <div className="order-1 flex shrink-0 flex-col gap-4 lg:order-none lg:col-start-1 lg:row-start-1 lg:min-h-0 lg:shrink">
        {/* Left top: Case design input */}
        {/* 设计表单默认收起：教师最常用的是下面的案例列表，原来表单常驻占掉左列 2/3，列表只剩一行 */}
        <Card className={`flex shrink-0 flex-col py-3 ${designOpen ? 'gap-3 [@media(max-height:820px)]:gap-2' : 'gap-0'}`}>
            <CardHeader className="pb-0 shrink-0 px-4">
              <div className="flex items-center gap-2 min-w-0">
                <CardTitle className="flex items-center gap-2 font-display text-base shrink-0">
                  设计新案例
                </CardTitle>
                <CardDescription className="text-xs truncate flex-1">描述需求，AI 生成完整案例与卷宗</CardDescription>
                <Button
                  type="button"
                  size="sm"
                  variant={designOpen ? 'ghost' : 'default'}
                  className="h-7 shrink-0 text-xs"
                  onClick={() => setDesignOpen((v) => !v)}
                  aria-expanded={designOpen}
                >
                  {designOpen ? '收起' : <><Plus className="mr-1 h-3.5 w-3.5" />新建</>}
                </Button>
              </div>
            </CardHeader>
            {designOpen && (
            <CardContent className="space-y-3 flex flex-col flex-1 min-h-0 px-4">
              {/* 案件类型切换 */}
              <div className="flex gap-2 shrink-0">
                {(['arbitration', 'criminal'] as CaseType[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={designCaseType === t ? 'default' : 'outline'}
                    className="h-7 text-xs"
                    onClick={() => setDesignCaseType(t)}
                  >
                    {CASE_TYPE_LABEL[t]}
                  </Button>
                ))}
              </div>
              {designCaseType === 'arbitration' && (
                <div className="grid grid-cols-2 gap-2 shrink-0">
                  <select
                    value={arbMeta.rules}
                    onChange={(e) => setArbMeta({ ...arbMeta, rules: e.target.value as ArbitrationMeta['rules'] })}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    aria-label="仲裁规则"
                  >
                    {ARBITRATION_RULES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <Input value={arbMeta.seat} onChange={(e) => setArbMeta({ ...arbMeta, seat: e.target.value })} placeholder="仲裁地，如：北京" className="h-8 text-xs" />
                  <Input value={arbMeta.governingLaw} onChange={(e) => setArbMeta({ ...arbMeta, governingLaw: e.target.value })} placeholder="实体准据法，如：中国法" className="h-8 text-xs" />
                  <Input value={arbMeta.claimAmount} onChange={(e) => setArbMeta({ ...arbMeta, claimAmount: e.target.value })} placeholder="争议金额，如：500万美元" className="h-8 text-xs" />
                  <Textarea
                    value={arbIssuesText}
                    onChange={(e) => setArbIssuesText(e.target.value)}
                    placeholder="争议焦点（每行一个，可留空由 AI 设定）"
                    className="col-span-2 min-h-[48px] text-xs resize-none"
                  />
                </div>
              )}
              <Textarea
                value={designNeed}
                onChange={(e) => setDesignNeed(e.target.value)}
                placeholder={designCaseType === 'arbitration'
                  ? '请输入仲裁案例设计需求，例如：设计一个仲裁协议准据法争议案例，约定合同适用香港法但未约定仲裁地，被申请人提出管辖权异议...'
                  : '请输入案例设计需求，例如：设计一个故意伤害罪的模拟法庭案例，要求包含完整的证据链和辩护空间...'}
                className="h-28 shrink-0 text-sm resize-none [@media(max-height:820px)]:h-16"
              />
              <Button onClick={handleDesign} disabled={!designNeed.trim() || designing} className="w-full shrink-0">
                {designing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    正在提交...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    生成案例
                  </>
                )}
              </Button>
              <p className="shrink-0 text-xs text-muted-foreground [@media(max-height:820px)]:hidden">
                {designCaseType === 'arbitration' ? '仲裁案例由 AI 直接生成，约需 1-3 分钟；法律依据中标【待核验】的条目请教师审核后再发布' : '案例生成约需10分钟'}
              </p>
            </CardContent>
            )}
          </Card>

          {/* Left bottom: Case list - same width as the two right stat tables */}
          <Card className="flex h-[360px] shrink-0 flex-col gap-2 py-3 lg:h-auto lg:min-h-0 lg:flex-1">
            <CardHeader className="pb-0 shrink-0 px-4">
              <div className="flex items-baseline gap-2 min-w-0">
                <CardTitle className="font-display text-base shrink-0">案例</CardTitle>
                <CardDescription className="text-xs truncate">点击案例名查看与审核</CardDescription>
              </div>
            </CardHeader>
            <CardContent className="flex-1 min-h-0 flex flex-col overflow-hidden px-4">
              <div className="flex-1 min-h-0 overflow-y-auto">
                {caseList.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    暂无案例，请先设计案例
                  </div>
                ) : (
                  <>
                    {/* Desktop: table layout */}
                    <div className="hidden lg:block">
                    {/* Table header */}
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground border-b">
                      <span>案例名称（点击查看）</span>
                      <span>状态</span>
                      <span className="text-right">操作</span>
                    </div>
                    {visibleCases.map((item) => {
                      const data = item.data;
                      return (
                        <div
                          key={item.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 px-2 py-2.5 items-center text-sm border-b last:border-b-0 hover:bg-accent/60 transition-colors"
                        >
                          {/* 名称即入口：原来名称列被三个按钮挤到 55px，"BY.O诉…"折成一字一行 */}
                          <button type="button" onClick={() => handleViewCase(item)} className="min-w-0 text-left group" title={item.name}>
                            <p className="font-medium leading-snug line-clamp-2 group-hover:underline">{item.name}</p>
                            <p className="text-xs text-muted-foreground tabular-nums">
                              {CASE_TYPE_LABEL[data?.caseType === 'arbitration' ? 'arbitration' : 'criminal']} · {new Date(item.createdAt).toLocaleDateString()}
                            </p>
                          </button>
                          <div>{getStatusBadge(item.status)}</div>
                          {/* 操作：发布/下线（改变学生可见性）→ 删除（不可逆）。查看由点击名称完成 */}
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant={item.status === 'published' ? 'outline' : 'default'}
                              onClick={() => handlePublish(item)}
                              disabled={item.status === 'generating'}
                              className="h-7 px-2 text-xs"
                            >
                              {item.status === 'generating' ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <>
                                  <Upload className="mr-1 h-3.5 w-3.5" />
                                  {/* 按钮写动作而不是状态：generated 的原标签是「未发布」，点它实际是发布 */}
                                  {item.status === 'published' ? '下线' : '发布'}
                                </>
                              )}
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => setDeleteTarget(item)}
                              aria-label="删除案例"
                              title="删除"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    </div>

                    {/* Mobile: card layout */}
                    <div className="lg:hidden space-y-2">
                      {visibleCases.map((item) => {
                        const data = item.data;
                        return (
                          <div key={item.id} className="border rounded-lg p-3 space-y-2 bg-card/50">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold text-sm line-clamp-2 flex-1 break-all">{item.name}</span>
                              {getStatusBadge(item.status)}
                            </div>
                            <div className="flex items-center justify-between text-xs text-muted-foreground">
                              <span>{CASE_TYPE_LABEL[data?.caseType === 'arbitration' ? 'arbitration' : 'criminal']} · {data?.creatorName || '\u674e\u7484\u9716'}</span>
                              <span className="whitespace-nowrap">
                                <Clock className="h-3 w-3 inline mr-1" />
                                {new Date(item.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => handleViewCase(item)}>
                                <Eye className="h-3 w-3 mr-1" /> 查看
                              </Button>
                              <Button size="sm" variant={item.status === 'published' ? 'outline' : 'default'} className="h-7 text-xs flex-1"
                                onClick={() => handlePublish(item)} disabled={item.status === 'generating'}>
                                {item.status === 'generating' ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Upload className="h-3 w-3 mr-1" />}
                                {item.status === 'generating' ? '生成中' : item.status === 'published' ? '下线' : '发布'}
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDeleteTarget(item)}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {offlineCases.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowOffline(v => !v)}
                        aria-expanded={showOffline}
                        className="mt-2 w-full rounded-sm border border-dashed px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted/40"
                      >
                        {showOffline ? '收起已下线的案例' : `另有 ${offlineCases.length} 个已下线的案例（学生看不到），点击展开`}
                      </button>
                    )}
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Generating message dialog */}
      {generatingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setGeneratingMsg(false)}>
          <div className="bg-card rounded-lg p-6 max-w-md mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-lg mb-2">案例仍在生成中</h3>
            <p className="text-sm text-muted-foreground mb-4">
              该案例正在由工作流生成中，通常需要约10分钟，请稍后再查看。
            </p>
            <div className="flex justify-center py-4">
              <div className="flex items-center gap-1">
                <span className="w-3 h-3 rounded-full bg-primary animate-pulse" />
                <span className="w-3 h-3 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.2s' }} />
                <span className="w-3 h-3 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
            </div>
            <Button variant="outline" className="w-full" onClick={() => setGeneratingMsg(false)}>知道了</Button>
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除案例「{deleteTarget?.name}」吗？此操作不可撤销，所有相关数据将被永久删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 学习场次统计 - 全部列表弹窗 */}
      <Dialog open={sessionsListOpen} onOpenChange={setSessionsListOpen}>
        <DialogContent className="w-[92vw] max-w-[92vw] sm:max-w-[92vw] h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Timer className="h-5 w-5" />
              学习场次统计（全部 {sessions.length} 条）
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto scroll-thin">
            {sessions.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Timer className="h-12 w-12 mx-auto mb-2 opacity-50" />
                暂无学习场次记录
              </div>
            ) : (
              <table className="w-full text-sm min-w-[720px]">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b">
                    <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">学生</th>
                    <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">案例</th>
                    <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">角色</th>
                    <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">本次时长</th>
                    <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">得分</th>
                    <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">结束时间</th>
                    <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-b hover:bg-muted/50 cursor-pointer" onClick={() => openSessionDetail(s.id)}>
                      <td className="py-0.5 px-3 font-medium whitespace-nowrap">{s.studentName || '未知学生'}</td>
                      <td className="py-0.5 px-3 max-w-[18em] truncate" title={s.caseName}>{s.caseName}</td>
                      <td className="py-0.5 px-3 text-center whitespace-nowrap">{ROLE_LABELS[s.role] || s.role}</td>
                      <td className="py-0.5 px-3 text-center whitespace-nowrap">{s.durationSeconds > 0 ? formatDuration(s.durationSeconds) : '—'}</td>
                      <td className="py-0.5 px-3 text-center whitespace-nowrap">{s.score != null ? `${s.score}分` : '—'}</td>
                      <td className="py-0.5 px-3 text-muted-foreground whitespace-nowrap">{new Date(s.endedAt).toLocaleString()}</td>
                      <td className="py-0.5 px-3 text-center">
                        <Button size="sm" variant="outline" className="h-6 text-xs"
                          disabled={sessionDetailLoading}
                          onClick={(e) => { e.stopPropagation(); openSessionDetail(s.id); }}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          查看
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 学生总览统计 - 全部列表弹窗 */}
      <Dialog open={overviewListOpen} onOpenChange={setOverviewListOpen}>
        <DialogContent className="w-[85vw] max-w-[85vw] sm:max-w-[85vw] h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              学生总览统计（全部 {studentOverview.length} 人）
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto scroll-thin">
            {studentOverview.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto mb-2 opacity-50" />
                暂无学生学习数据
              </div>
            ) : (
              <table className="w-full text-sm min-w-[480px]">
                <thead className="sticky top-0 bg-card z-10">
                  <tr className="border-b">
                    <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">学生</th>
                    <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">学习总次数</th>
                    <th className="text-center py-0.5 px-3 font-semibold whitespace-nowrap">学习总时长</th>
                    <th className="text-left py-0.5 px-3 font-semibold whitespace-nowrap">最近学习</th>
                  </tr>
                </thead>
                <tbody>
                  {studentOverview.map((s) => (
                    <tr key={s.studentId} className="border-b hover:bg-muted/50">
                      <td className="py-0.5 px-3 font-medium whitespace-nowrap">{s.studentName || '未知学生'}</td>
                      <td className="py-0.5 px-3 text-center">{s.totalSessions}次</td>
                      <td className="py-0.5 px-3 text-center whitespace-nowrap">{s.totalSeconds > 0 ? formatDuration(s.totalSeconds) : '—'}</td>
                      <td className="py-0.5 px-3 text-muted-foreground whitespace-nowrap">{new Date(s.lastTime).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 学习场次详情：当次全部学习记录（环节对话/点评/行为轨迹/分析报告/文书），即学生端学习记录面板可见内容 */}
      <Dialog open={!!sessionDetail} onOpenChange={(o) => !o && setSessionDetail(null)}>
        <DialogContent className="max-w-3xl sm:max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 flex-wrap">
              <Timer className="h-5 w-5" />
              {sessionDetail?.studentName} 的学习记录
              {sessionDetail && (
                <span className="text-sm font-normal text-muted-foreground">
                  {sessionDetail.caseName} · {ROLE_LABELS[sessionDetail.role] || sessionDetail.role} ·
                  时长 {sessionDetail.durationSeconds > 0 ? formatDuration(sessionDetail.durationSeconds) : '—'} ·
                  {sessionDetail.endedAt ? new Date(sessionDetail.endedAt).toLocaleString() : ''}
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto scroll-thin space-y-3 pr-1">
            {/* DEBUG-BISECT-A: summary + records 卡片（无 conversations） */}
            {sessionDetail?.summary && (
              <div className="rounded-md border bg-primary/5 p-3">
                <div className="text-sm font-semibold mb-1">本次学习评价</div>
                <div className="text-sm whitespace-pre-wrap">{sessionDetail.summary}</div>
                {sessionDetail.evaluation && (
                  <div className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">{sessionDetail.evaluation}</div>
                )}
              </div>
            )}
            {(sessionDetail?.records || []).map((r, idx) => (
              <div key={idx} className="rounded-md border p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline">{r.pageName}</Badge>
                  {typeof r.score === 'number' && <Badge variant="secondary">{r.score}分</Badge>}
                  <span className="text-xs text-muted-foreground ml-auto">{new Date(r.createdAt).toLocaleString()}</span>
                </div>
                {r.summary && <div className="text-sm whitespace-pre-wrap">{r.summary}</div>}
                {r.evaluation && <div className="text-sm text-muted-foreground whitespace-pre-wrap">评价：{r.evaluation}</div>}
                {r.suggestion && <div className="text-sm text-muted-foreground whitespace-pre-wrap">建议：{r.suggestion}</div>}
                {r.conversations && r.conversations.length > 0 && (
                  <div className="text-sm">
                    <div className="font-semibold text-primary mb-1">对话记录（{r.conversations.length}条）</div>
                    <div className="space-y-1.5 max-h-64 overflow-y-auto scroll-thin rounded bg-muted/40 p-2">
                      {r.conversations.map((m, mi) => (
                        <div key={mi} className="text-xs sm:text-sm">
                          <span className="font-semibold">{m.speaker || (m.role === 'user' ? '学生' : 'AI')}：</span>
                          <span className="whitespace-pre-wrap">{m.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {sessionDetail && Object.keys(sessionDetail.documents || {}).length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <h3 className="font-semibold text-sm">完成文书</h3>
                {Object.entries(sessionDetail.documents || {}).map(([name, content]) => (
                  <div key={name} className="rounded-lg border p-3">
                    <div className="font-semibold text-primary mb-1 text-sm">{name}</div>
                    <div className="whitespace-pre-wrap text-xs sm:text-sm text-muted-foreground max-h-64 overflow-y-auto scroll-thin rounded bg-muted/40 p-2">
                      {content}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TeacherPage() {
  return (
    <React.Suspense fallback={null}>
      <TeacherPageContent />
    </React.Suspense>
  );
}
