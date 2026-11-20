'use client';

/**
 * 仲裁闭庭与训练分析页。
 *
 * 刑事路线的 final-statement 页依赖 Coze 判决书工作流；仲裁没有对应工作流，
 * 本页直接汇总全部学习记录生成训练分析报告，再走 endTraining 保存学习场次。
 */

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { Button } from '@/components/ui/button';

import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { useAppStore } from '@/lib/store';
import { getRoleLabel } from '@/lib/case-type';
import { endTraining } from '@/lib/end-training';
import { collectLearningData, formatRecordsForAnalysis, formatDuration } from '@/lib/learning-log';
import { streamSummary, parseSummarySections, SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { advanceArbitrationLifecycle } from '@/lib/arbitration-study';
import { getForumProfile, adversarialType } from '@/lib/forum-profile';
import type { LearningRecordEntry, UserRole } from '@/lib/types';

// 稳定空数组：禁止内联字面量传入 useStageDialogueLogger（会引发无限 setState 循环白屏）
const EMPTY_MESSAGES: never[] = [];

export default function ArbitrationClosingPage() {
  const router = useRouter();
  useStageDialogueLogger('闭庭', EMPTY_MESSAGES);

  const { selectedCase, user, hydrated, selectedRole, addLearningRecord } = useAppStore();
  const role: UserRole = selectedRole ?? 'defender';
  const caseType = adversarialType(selectedCase?.caseType);
  const profile = getForumProfile(caseType);
  const c = profile.closing;
  const roleLabel = getRoleLabel(caseType, role);

  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stream, setStream] = useState('');
  const [record, setRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const triggered = useRef(false);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); }
  }, [selectedCase, user, hydrated, router]);

  const handleFinish = async () => {
    if (triggered.current || !selectedCase) return;
    triggered.current = true;
    advanceArbitrationLifecycle('closing');
    addLearningRecord({
      pageName: c.pageRecord,
      conversations: [],
      summary: role === 'judge' ? c.judgeSummary : c.partySummary,
      evaluation: '训练已完成全部流程',
      suggestion: '建议回顾全部学习记录，总结经验',
      createdAt: Date.now(),
    });

    setShow(true);
    setLoading(true);
    setStream('');

    const { records, documents } = collectLearningData();
    const learningContext = formatRecordsForAnalysis(records, documents);
    const systemPrompt = `你是一位${profile.professor}。请根据用户提供的全部学习记录，进行概括、评价和训练建议。

本次${profile.trainingName}已完整走完全部流程，学生扮演的角色是${roleLabel}。请遍历【各环节学习记录】中出现的每一个环节，结合对话记录、法律文书与行为轨迹，综合评估学生的实务能力：${c.analysisFocus}。

得分根据学生在整个训练中的表现综合评定。

${SUMMARY_FORMAT_INSTRUCTION}`;
    const userPrompt = `案件资料:\n${selectedCase.case || ''}\n\n${learningContext || '（暂无学习记录）'}`;

    try {
      const fullText = await streamSummary({ systemPrompt, userPrompt, temperature: 0.5, onChunk: (t) => setStream(t) });
      const data = parseSummarySections(fullText);
      const startTime = useAppStore.getState().trainingStartTime;
      const sec = startTime ? Math.max(0, Math.round((Date.now() - startTime) / 1000)) : 0;
      const prefix = sec > 0 ? `【本次学习时长：${formatDuration(sec)}】\n` : '';
      const finalRecord: LearningRecordEntry = {
        pageName: '模拟法庭训练分析报告',
        conversations: [],
        summary: `${prefix}${data.summary || '分析生成完成'}`,
        evaluation: data.evaluation || '',
        suggestion: data.suggestion || '',
        score: data.score,
        createdAt: Date.now(),
      };
      setRecord(finalRecord);
      addLearningRecord(finalRecord);
    } catch {
      setRecord({ pageName: '模拟法庭训练分析报告', conversations: [], summary: '已完成全部训练流程', evaluation: '生成评价时出错', suggestion: '请回顾学习记录', createdAt: Date.now() });
    } finally {
      setLoading(false);
      setStream('');
    }
  };

  const doEnd = () => {
    setShow(false);
    if (user && selectedCase) {
      endTraining(user.id, selectedCase.id, selectedCase.name, useAppStore.getState().learningRecords, (p) => router.push(p), role, useAppStore.getState().lifecycle);
    } else {
      router.push('/student/select');
    }
  };

  if (!selectedCase) {
    return <div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar pageName="闭庭" showHome onHome={() => router.push('/')} isStudent />
      <LifecycleBar />
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        {/* 闭庭：一张"结案页"——印章是全流程唯一一次出现的完成标记 */}
        <div className="relative w-full max-w-xl rounded-sm border bg-card px-10 py-12 text-center shadow-sm">
          <div
            className="absolute right-8 top-8 grid h-16 w-16 rotate-6 place-items-center rounded-[3px] border-2 border-seal font-display text-sm font-semibold leading-tight text-seal opacity-90"
            aria-hidden
          >
            闭庭
          </div>
          <p className="text-sm text-muted-foreground">{selectedCase.name}</p>
          <h2 className="mt-3 font-display text-2xl font-semibold tracking-[0.2em] text-foreground">{c.title}</h2>
          <p className="docket-text mx-auto mt-6 max-w-md text-center">
            {role === 'judge' ? c.judgeLine : c.partyLine}
          </p>
          <div className="mx-auto mt-8 max-w-sm border-t pt-6">
            <p className="mb-4 text-sm text-muted-foreground">系统会汇总你在每个环节的发言、文书和评价，生成一份训练分析。</p>
            <Button onClick={handleFinish} disabled={loading || show} size="lg" className="w-full">
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" />正在生成分析…</> : '生成训练分析'}
            </Button>
          </div>
        </div>
      </div>
      <ContinueModal open={show} onClose={doEnd} loading={loading} streamText={stream} record={record} title={c.reportTitle} buttonText="结束训练" />
    </div>
  );
}
