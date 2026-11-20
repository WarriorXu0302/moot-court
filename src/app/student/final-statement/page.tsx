'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { FlowPage } from '@/components/flow-page';
import { ContinueModal } from '@/components/continue-modal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import { Loader2, FileText, ChevronRight, Gavel } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import type { LearningRecordEntry } from '@/lib/types';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { parseLifecycleFromAIResponse, advanceLifecycleForPage } from '@/lib/lifecycle-utils';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { endTraining } from '@/lib/end-training';
import { collectLearningData, formatRecordsForAnalysis, formatDuration } from '@/lib/learning-log';
import { streamSummary, parseSummarySections, SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';

const WORKFLOW_JUDGMENT_ID = '7657514573813612550';

// 稳定空数组：禁止内联字面量传入 useStageDialogueLogger（会引发无限 setState 循环白屏）
const EMPTY_MESSAGES: never[] = [];

type Phase = 'idle' | 'final-statement' | 'generating-judgment' | 'verdict' | 'done';

export default function FinalStatementPage() {
  const router = useRouter();
  const { selectedCase, user, hydrated, learningRecords, addLearningRecord, setDocument, selectedRole } = useAppStore();
  // 进入「最后陈述」环节计入行为轨迹
  useStageDialogueLogger('最后陈述', EMPTY_MESSAGES);
  const [phase, setPhase] = useState<Phase>('final-statement');
  const [judgment, setJudgment] = useState('');
  const [judgmentError, setJudgmentError] = useState('');
  const [pollCount, setPollCount] = useState(0);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  const [showEndAnalysis, setShowEndAnalysis] = useState(false);
  const [endAnalysisLoading, setEndAnalysisLoading] = useState(false);
  const [endAnalysisRecord, setEndAnalysisRecord] = useState<LearningRecordEntry | undefined>();
  const [endAnalysisStream, setEndAnalysisStream] = useState('');
  const endAnalysisTriggered = useRef(false);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
  }, [selectedCase, user, hydrated, router]);

  // Build learning records content for workflow input
  const buildContentString = () => {
    return learningRecords.map(r =>
      `## ${r.pageName}\n### 概括: ${r.summary}\n### 评价: ${r.evaluation}\n### 建议: ${r.suggestion}\n### 对话:\n${r.conversations.map(c => `${c.speaker || c.role}: ${c.content}`).join('\n')}`
    ).join('\n\n');
  };

  // Serialize array fields for workflow input
  const serializeField = (field: unknown): string => {
    if (!field) return '[]';
    if (typeof field === 'string') return field;
    return JSON.stringify(field);
  };

  // Trigger judgment workflow and poll for result
  const triggerJudgmentWorkflow = async () => {
    setPhase('generating-judgment');
    setPollCount(0);

    const contentStr = buildContentString();
    const pleadStr = serializeField(selectedCase?.plead);
    const recordStr = serializeField(selectedCase?.record);
    const evidenceStr = serializeField(selectedCase?.evidence);

    try {
      // Start async workflow
      const startRes = await fetch('/api/workflow/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workflowId: WORKFLOW_JUDGMENT_ID,
          isAsync: true,
          parameters: {
            name: selectedCase?.name || '',
            case: selectedCase?.case || '',
            plead: pleadStr,
            record: recordStr,
            evidence: evidenceStr,
            content: contentStr,
          },
        }),
      });
      const startData = await startRes.json();

      // If synchronous result returned immediately
      if (startData.data && !startData.execute_id) {
        const outputs = typeof startData.data === 'string' ? JSON.parse(startData.data) : startData.data;
        const judgeText = outputs.judge || outputs.judgment || outputs.result || (typeof outputs === 'string' ? outputs : JSON.stringify(outputs));
        setJudgment(judgeText);
        setPhase('verdict');
        return;
      }

      // If async, poll for result
      const executeId = startData.execute_id || startData.executeId;
      if (executeId) {
        startPolling(executeId);
      } else {
        throw new Error('No execute_id returned');
      }
    } catch (err) {
      setJudgmentError(err instanceof Error ? err.message : '工作流调用失败');
      // Use fallback judgment text
      setJudgment(`第一审刑事判决书\n\n（工作流正在异步生成中，以下为临时占位内容）\n\n案件名称：${selectedCase?.name || ''}\n\n根据案件基本资料和庭审记录，合议庭经评议作出如下判决：\n\n（完整判决书内容将在工作流完成后生成）`);
      setPhase('verdict');
    }
  };

  const startPolling = (executeId: string) => {
    let attempts = 0;
    const maxAttempts = 120; // 10 minutes max (5s * 120 = 600s)
    
    const poll = async () => {
      attempts++;
      setPollCount(attempts);
      
      try {
        const res = await fetch(`/api/workflow/history?executeId=${executeId}&workflowId=7657514573813612550`);
        const data = await res.json();
        
        if (data.status === 'completed') {
          const raw = data.data || {};
          const outputs = raw.Output || raw.output || raw;
          const parsed = typeof outputs === 'string' ? JSON.parse(outputs) : outputs;
          const judgeText = parsed.judge || parsed.judgment || parsed.result || (typeof parsed === 'string' ? parsed : JSON.stringify(parsed));
          setJudgment(judgeText);
          setPhase('verdict');
          return;
        }
        
        if (data.status === 'failed') {
          throw new Error('Workflow failed');
        }
        
        if (attempts < maxAttempts) {
          pollingRef.current = setTimeout(poll, 5000);
        } else {
          throw new Error('Workflow timeout');
        }
      } catch (err) {
        setJudgmentError(err instanceof Error ? err.message : '轮询失败');
        setJudgment(`第一审刑事判决书\n\n（工作流执行超时，以下为占位内容）\n\n案件名称：${selectedCase?.name || ''}`);
        setPhase('verdict');
      }
    };
    
    poll();
  };

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, []);

  const handleFinalStatementDone = () => {
    triggerJudgmentWorkflow();
  };

  const handleVerdictDone = () => {
    // Auto-trigger end training and learning analysis
    triggerEndAnalysis();
  };

  const triggerEndAnalysis = async () => {
    // Prevent duplicate calls
    if (endAnalysisTriggered.current) return;
    endAnalysisTriggered.current = true;
    // Save judgment to documents first
    if (judgment) {
      setDocument('judge', judgment);
    }
    addLearningRecord({
      pageName: '被告人最后陈述与宣判',
      conversations: [],
      summary: '已完成被告人最后陈述、宣判和宣布闭庭流程',
      evaluation: '训练已完成全部流程',
      suggestion: '建议回顾全部学习记录，总结经验',
      createdAt: Date.now(),
    });

    // Show analysis modal with loading
    setShowEndAnalysis(true);
    setEndAnalysisLoading(true);
    setEndAnalysisStream('');

    // 汇总全部学习记录（已完成点评 + 各环节实时对话 + 行为轨迹 + 已保存文书），遍历各环节分析
    const { records: allRecords, documents } = collectLearningData();
    const learningContext = formatRecordsForAnalysis(allRecords, documents);
    const systemPrompt = `你是一位模拟法庭教学专家。请根据用户提供的全部学习记录，进行概括、评价和训练建议。

本次训练已完整走完全部流程（最后陈述、宣判、闭庭）。请遍历【各环节学习记录】中出现的每一个环节，结合对话记录、法律文书与行为轨迹综合评估学生的法律思维与实务操作表现。

得分根据学生在整个模拟法庭训练中的表现综合评定。

${SUMMARY_FORMAT_INSTRUCTION}`;

    const userPrompt = `案件资料:
${selectedCase?.case || ''}

${learningContext || '（暂无学习记录）'}`;

    try {
      const fullText = await streamSummary({
        systemPrompt,
        userPrompt,
          temperature: 0.5,
        onChunk: (text) => setEndAnalysisStream(text),
      });
      const data = parseSummarySections(fullText);
      const score = data.score;
      // 本次学习时长：从选择案例进入训练到结束分析为一次学习
      const startTime = useAppStore.getState().trainingStartTime;
      const durationSec = startTime ? Math.max(0, Math.round((Date.now() - startTime) / 1000)) : 0;
      const durationPrefix = durationSec > 0 ? `【本次学习时长：${formatDuration(durationSec)}】\n` : '';
      const finalRecord: LearningRecordEntry = {
        pageName: '模拟法庭训练分析报告',
        conversations: [],
        summary: `${durationPrefix}${data.summary || '分析生成完成'}`,
        evaluation: data.evaluation || '',
        suggestion: data.suggestion || '',
        score,
        createdAt: Date.now(),
      };
      setEndAnalysisRecord(finalRecord);
      // 总结记录同时计入学习记录（随 endTraining 保存到数据库）
      addLearningRecord(finalRecord);
    } catch {
      setEndAnalysisRecord({
        pageName: '模拟法庭训练分析报告',
        conversations: [],
        summary: '已完成全部模拟法庭流程',
        evaluation: '生成评价时出错',
        suggestion: '请回顾学习记录',
        createdAt: Date.now(),
      });
    } finally {
      setEndAnalysisLoading(false);
      setEndAnalysisStream('');
    }
  };

  const doEndTraining = () => {
    setShowEndAnalysis(false);
    // 保存学习记录（含各环节对话与行为轨迹）并返回案例选择页
    if (user && selectedCase) {
      endTraining(
        user.id,
        selectedCase.id,
        selectedCase.name,
        useAppStore.getState().learningRecords,
        (p) => router.push(p),
        selectedRole || 'defender',
        useAppStore.getState().lifecycle,
      );
    } else {
      router.push('/student/select');
    }
  };

  // Compute phase content
  let phaseContent: React.ReactNode;

  if (!selectedCase) {
    phaseContent = (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  } else if (phase === 'final-statement') {
    phaseContent = (
      <FlowPage
        title="被告人最后陈述"
        rounds={[
          {
            systemPrompt: `以旁白形式沉浸式描写庭审现场。审判长宣布法庭辩论结束，进入被告人最后陈述环节。法庭气氛庄重安静。不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写被告人最后陈述。审判长示意被告人可以作最后陈述。被告人站起，根据自己的角色设定和学习记录中的对话表现，作最后陈述。不要使用任何小标题或序号，不要提及第几幕，融入被告人的语气和神态细节，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}

角色资料:
${typeof selectedCase?.person === 'string' ? selectedCase.person : JSON.stringify(selectedCase?.person || [])}

全部学习记录:
${learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n')}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写休庭评议。被告人最后陈述完毕，审判长宣布休庭，合议庭退庭进行评议。法庭安静等待。不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
        ]}
        open={!showEndAnalysis}
        onClose={handleFinalStatementDone}
        onSkipAll={handleFinalStatementDone}
        showCloseButton={true}
        closeButtonText="继续 → 生成判决书"
        backgroundImage="/bg-final-statement.jpeg"
      />
    );
  } else if (phase === 'verdict') {
    phaseContent = (
      <FlowPage
        title="宣判与宣布闭庭"
        rounds={[
          {
            systemPrompt: `以旁白形式沉浸式描写宣判场景：书记员宣布全体起立，合议庭入庭，审判长敲响法槌宣布继续开庭。不要使用任何小标题或序号，不要提及第几幕，融入法槌声、起立声等细节，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写审判长宣读判决书。审判长以庄重语调完整宣读判决书，包括认证结论、裁判理由、裁判结果，不得缩写省略。融入审判长的语调细节。不要使用任何小标题或序号，不要提及第几幕，用纯叙事段落呈现。

案件基本资料:
${selectedCase?.case || ''}

第一审刑事判决书:
${judgment || '（判决书正在生成中）'}`,
            contextData: `${selectedCase?.case || ''}\n\n${judgment}`,
          },
          {
            systemPrompt: `以旁白形式沉浸式描写审判长宣布判决结果，告知被告人上诉权，被告人回答。审判长宣布闭庭，书记员宣布全体起立，合议庭退庭，宣布散庭。不要使用任何小标题或序号，不要提及第几幕，融入法槌声、退庭声等细节，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}

第一审刑事判决书:
${judgment || '（判决书正在生成中）'}`,
            contextData: `${selectedCase?.case || ''}\n\n${judgment}`,
          },
        ]}
        open={!showEndAnalysis}
        onClose={handleVerdictDone}
        onSkipAll={triggerEndAnalysis}
        showCloseButton={true}
        closeButtonText="完成庭审"
        backgroundImage="/bg-verdict.jpeg"
      />
    );
  } else if (phase === 'generating-judgment') {
    phaseContent = (
      <div className="h-screen flex flex-col bg-background overflow-y-auto">
        <TitleBar
          pageName="最后陈述与宣判"
          onSkip={() => { advanceLifecycleForPage('/student/final-statement'); setPhase('verdict'); }}
          onEndAnalysis={triggerEndAnalysis}
          canContinue={false}
          continueTooltip="正在生成判决书..."
          onContinue={triggerEndAnalysis}
          showHome
          onHome={() => router.push('/')}
          isStudent
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full">
            <CardContent className="p-8 text-center">
              <div className="flex flex-col items-center gap-4">
                <Gavel className="h-12 w-12 text-primary" />
                <div className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded-full bg-primary ai-thinking-dot" />
                  <span className="w-3 h-3 rounded-full bg-primary ai-thinking-dot" />
                  <span className="w-3 h-3 rounded-full bg-primary ai-thinking-dot" />
                </div>
                <h2 className="text-xl font-semibold">正在生成第一审刑事判决书...</h2>
                <p className="text-sm text-muted-foreground">
                  工作流正在根据案件资料和学习记录生成判决书
                </p>
                {pollCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    已等待约 {Math.round(pollCount * 5)} 秒...
                  </p>
                )}
                <div className="w-full max-w-md">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary animate-pulse" style={{ width: `${Math.min(pollCount * 2, 90)}%` }} />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  此过程为异步操作，可能需要数分钟，您可以继续等待
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  } else if (phase === 'done') {
    phaseContent = (
      <div className="h-screen flex flex-col bg-background overflow-y-auto">
        <TitleBar
          pageName="最后陈述与宣判"
          onSkip={() => { advanceLifecycleForPage('/student/final-statement'); triggerEndAnalysis(); }}
          onEndAnalysis={triggerEndAnalysis}
          canContinue={true}
          continueTooltip="点击结束训练"
          onContinue={triggerEndAnalysis}
          showHome
          onHome={() => router.push('/')}
          isStudent
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-2xl w-full">
            <CardContent className="p-8 text-center">
              <div className="text-6xl mb-4 text-primary"><Gavel className="h-16 w-16 mx-auto" /></div>
              <h2 className="text-2xl font-bold mb-2">模拟法庭训练完成</h2>
              <p className="text-muted-foreground mb-6">
                您已完成辩护人角色的全部模拟法庭流程
              </p>
              {judgment && (
                <div className="text-left mb-6 border rounded-lg p-4 max-h-64 overflow-y-auto scroll-thin">
                  <h3 className="font-semibold mb-2 text-primary">第一审刑事判决书</h3>
                  <div className="markdown-content text-sm">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{judgment}</ReactMarkdown>
                  </div>
                </div>
              )}
              <Button onClick={triggerEndAnalysis} size="lg">
                <ChevronRight className="h-4 w-4 mr-2" />
                结束训练
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  } else {
    phaseContent = (
      <div className="h-screen flex flex-col bg-background overflow-y-auto">
        <TitleBar
          pageName="最后陈述与宣判"
          onSkip={() => { advanceLifecycleForPage('/student/final-statement'); triggerEndAnalysis(); }}
          onEndAnalysis={triggerEndAnalysis}
          canContinue={false}
          continueTooltip="请完成流程"
          onContinue={triggerEndAnalysis}
          showHome
          onHome={() => router.push('/')}
          isStudent
        />
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full">
            <CardContent className="p-8 text-center">
              <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold mb-2">庭审最后阶段</h2>
              <p className="text-sm text-muted-foreground">
                将依次进行：被告人最后陈述 → 宣判 → 宣布闭庭
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <>
      {phaseContent}
      <ContinueModal
        open={showEndAnalysis}
        onClose={doEndTraining}
        loading={endAnalysisLoading}
        record={endAnalysisRecord}
        streamText={endAnalysisStream}
        conversations={[]}
        title="训练分析报告"
        buttonText="保存并返回案例选择"
      />
      <LifecycleBar />
    </>
  );
}
