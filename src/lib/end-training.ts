'use client';

import type { LearningRecordEntry, UserRole, CaseLifecycle } from './types';
import { collectRecordsForSave, formatDuration } from './learning-log';
import { useAppStore } from './store';

/** 分析报告条目名（学生端「学习分析」记录） */
export const ANALYSIS_RECORD_NAME = '模拟法庭训练分析报告';

/**
 * Save learning records to database and navigate to student select page.
 * Used by the "结束分析" button on all student pages.
 * Gracefully interrupts any ongoing TTS playback before navigating.
 *
 * 保存的记录 = 已完成环节点评 + 各环节实时对话记录 + 训练行为轨迹（mergeStageRecords 合并），
 * 确保中途结束训练时对话与行为不丢失。
 */
export async function endTraining(
  userId: string,
  caseId: string,
  caseName: string,
  records: LearningRecordEntry[],
  navigate: (path: string) => void,
  role: UserRole = 'defender',
  lifecycle?: CaseLifecycle | null,
) {
  // Gracefully stop any ongoing TTS — the stage is over
  try {
    const { interruptTts } = await import('./audio');
    interruptTts();
  } catch {
    // audio module unavailable — continue
  }

  // 合并调用方传入的记录与 store 中的实时对话/行为轨迹（去重：同环节取对话更完整者）
  let fullRecords: LearningRecordEntry[] = records;
  try {
    const collected = collectRecordsForSave();
    const seen = new Set<string>();
    fullRecords = [];
    for (const r of [...records, ...collected]) {
      if (r.pageName === '训练行为轨迹') {
        // 行为轨迹只保留一份（取条数多的）
        const existing = fullRecords.find((x) => x.pageName === '训练行为轨迹');
        if (!existing || existing.conversations.length < r.conversations.length) {
          if (existing) fullRecords = fullRecords.filter((x) => x.pageName !== '训练行为轨迹');
          fullRecords.push(r);
        }
        continue;
      }
      const key = r.pageName;
      if (seen.has(key)) {
        // 同环节：优先保留有点评的版本，对话取更完整者
        const existing = fullRecords.find((x) => x.pageName === key) as LearningRecordEntry;
        if (r.conversations.length > existing.conversations.length) existing.conversations = r.conversations;
        if (existing.summary.startsWith('本环节对话记录') && !r.summary.startsWith('本环节对话记录')) {
          fullRecords = fullRecords.map((x) => (x.pageName === key ? r : x));
        }
        continue;
      }
      seen.add(key);
      fullRecords.push(r);
    }
    fullRecords.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    fullRecords = records;
  }

  // 本次学习时长：从选择案例进入训练到结束分析为一次学习
  const store = useAppStore.getState();
  const trainingStartTime = store.trainingStartTime;
  const endedAt = Date.now();
  const durationSeconds = trainingStartTime ? Math.max(0, Math.round((endedAt - trainingStartTime) / 1000)) : 0;

  // 学生端学习分析（分析报告）附上本次学习时长，面板/弹窗/教师端均可见
  if (durationSeconds > 0) {
    const analysis = fullRecords.find((r) => r.pageName === ANALYSIS_RECORD_NAME);
    if (analysis && !analysis.summary.startsWith('【本次学习时长')) {
      analysis.summary = `【本次学习时长：${formatDuration(durationSeconds)}】\n${analysis.summary}`;
    }
  }

  try {
    // Calculate overall score from records that have scores
    const scoredRecords = fullRecords.filter((r) => typeof r.score === 'number' && r.score >= 0 && r.score <= 100);
    const overallScore = scoredRecords.length > 0
      ? Math.round(scoredRecords.reduce((sum, r) => sum + (r.score as number), 0) / scoredRecords.length)
      : undefined;

    await fetch('/api/learning-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save',
        studentId: userId,
        caseId,
        caseName,
        role,
        records: fullRecords,
        stage: 'completed',
        progress: 100,
        lifecycle: lifecycle || null,
        overallScore,
      }),
    });
  } catch {
    // ignore errors — still navigate
  }

  // 写入单次学习场次（教师端宏观统计：按学习次数/按学生两个列表的数据源）
  try {
    const analysis = fullRecords.find((r) => r.pageName === ANALYSIS_RECORD_NAME);
    await fetch('/api/learning-sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        studentId: userId,
        studentName: store.user?.nickname || '',
        fid: store.user?.fid || '',
        orgName: '',
        caseId,
        caseName,
        role,
        startedAt: trainingStartTime || null,
        endedAt,
        durationSeconds,
        progress: 100,
        lastStage: 'completed',
        score: typeof analysis?.score === 'number' ? analysis.score : null,
        summary: analysis?.summary || '',
        evaluation: analysis?.evaluation || '',
        suggestion: analysis?.suggestion || '',
        records: fullRecords,
        documents: store.documents || {},
        lifecycle: lifecycle || null,
      }),
    });
  } catch {
    // session 写入失败不阻塞主流程
  }

  // 本次学习结束，清除开始时间
  store.setTrainingStartTime(null);
  navigate('/student/select');
}
