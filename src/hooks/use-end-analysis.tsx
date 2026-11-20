'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ContinueModal } from '@/components/continue-modal';
import { endTraining } from '@/lib/end-training';
import { useAppStore } from '@/lib/store';
import type { LearningRecordEntry } from '@/lib/types';
import { collectLearningData, formatRecordsForAnalysis, formatDuration } from '@/lib/learning-log';
import { streamSummary, parseSummarySections, SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';

interface UseEndAnalysisParams {
  /** 当前训练所在环节名（用于中途结束分析提示词），如「辩护词撰写」 */
  currentPageName: string;
}

/**
 * 训练中「结束分析」通用 Hook。
 * 适用于训练进行中的任意业务页：点击后基于当前进度（学到哪、分析到哪）
 * 生成训练总结弹窗，确认后保存学习记录并返回案例选择页。
 * 案例选择页不应使用本 Hook（尚未进入训练，无分析对象）。
 */
export function useEndAnalysis({ currentPageName }: UseEndAnalysisParams) {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const selectedCase = useAppStore((s) => s.selectedCase);
  const selectedRole = useAppStore((s) => s.selectedRole);
  const lifecycle = useAppStore((s) => s.lifecycle);

  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [record, setRecord] = useState<LearningRecordEntry>();
  const [streamText, setStreamText] = useState('');
  const triggered = useRef(false);

  const handleEndAnalysis = useCallback(async () => {
    if (!user || !selectedCase) {
      router.push('/student/select');
      return;
    }
    if (triggered.current) return;
    triggered.current = true;

    setShow(true);
    setLoading(true);
    setRecord(undefined);
    setStreamText('');

    // 汇总全部学习记录（已完成点评 + 各环节实时对话 + 行为轨迹 + 已保存文书），遍历各环节分析
    const { records, documents } = collectLearningData();
    const learningContext = formatRecordsForAnalysis(records, documents);
    const systemPrompt = `你是一位模拟法庭教学专家。请根据用户提供的全部学习记录，进行概括、评价和训练建议。

这次训练是学生中途主动结束的（结束时所处环节：${currentPageName}）。请遍历【各环节学习记录】中出现的每一个环节——进行到哪、分析到哪，只分析已进行的环节，不要提及未进行的环节，可以在建议中适当提示后续未完成的流程。对话记录与行为轨迹是学生真实训练过程，务必据此评估其法律思维与实务操作表现。

得分根据已完成环节的表现综合评定；若无任何学习记录则给出基础分。

${SUMMARY_FORMAT_INSTRUCTION}`;

    const userPrompt = `案件资料:
${selectedCase.case || ''}

${learningContext || '（暂无学习记录，学生刚开始训练即结束）'}`;

    try {
      const fullText = await streamSummary({
        systemPrompt,
        userPrompt,
        temperature: 0.5,
        onChunk: (text) => setStreamText(text),
      });
      const data = parseSummarySections(fullText);
      // 本次学习时长：从选择案例进入训练到点击结束分析为一次学习
      const startTime = useAppStore.getState().trainingStartTime;
      const durationSec = startTime ? Math.max(0, Math.round((Date.now() - startTime) / 1000)) : 0;
      const durationPrefix = durationSec > 0 ? `【本次学习时长：${formatDuration(durationSec)}】\n` : '';
      setRecord({
        pageName: '模拟法庭训练分析报告',
        conversations: [],
        summary: `${durationPrefix}${data.summary || '已结束本次训练'}`,
        evaluation: data.evaluation || '',
        suggestion: data.suggestion || '',
        score: data.score,
        createdAt: Date.now(),
      });
    } catch {
      setRecord({
        pageName: '模拟法庭训练分析报告',
        conversations: [],
        summary: '已结束本次训练',
        evaluation: '生成分析时出现错误，请回顾上方学习记录',
        suggestion: '建议稍后重新尝试结束分析，或直接返回选择新的案例',
        createdAt: Date.now(),
      });
    } finally {
      setLoading(false);
      setStreamText('');
    }
  }, [user, selectedCase, currentPageName, router]);

  const handleModalClose = useCallback(() => {
    setShow(false);
    // 分析结果同时计入学习记录（随 endTraining 保存到数据库，教师端可见）
    if (record) {
      try {
        useAppStore.getState().addLearningRecord(record);
      } catch {
        // ignore — endTraining 兜底合并 store 现有记录
      }
    }
    if (user && selectedCase) {
      endTraining(
        user.id,
        selectedCase.id,
        selectedCase.name,
        useAppStore.getState().learningRecords,
        (p) => router.push(p),
        selectedRole || 'defender',
        lifecycle,
      );
    } else {
      router.push('/student/select');
    }
  }, [user, selectedCase, selectedRole, record, lifecycle, router]);

  const modal = (
    <ContinueModal
      open={show}
      onClose={handleModalClose}
      loading={loading}
      record={record}
      streamText={streamText}
      title="训练分析报告"
      buttonText="保存并返回案例选择"
    />
  );

  return { modal, handleEndAnalysis };
}
