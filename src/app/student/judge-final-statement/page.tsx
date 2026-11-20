'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { FlowPage } from '@/components/flow-page';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAppStore } from '@/lib/store';
import { Loader2, Gavel } from 'lucide-react';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { parseLifecycleFromAIResponse, advanceLifecycleForPage } from '@/lib/lifecycle-utils';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';

// 稳定空数组：禁止内联字面量传入 useStageDialogueLogger（会引发无限 setState 循环白屏）
const EMPTY_MESSAGES: never[] = [];

export default function JudgeFinalStatementPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '最后陈述' });
  // 本环节行为计入行为轨迹（结束分析遍历全部环节用）
  useStageDialogueLogger('最后陈述', EMPTY_MESSAGES);

  const { selectedCase, user, hydrated, learningRecords, addLearningRecord } = useAppStore();
  const [phase, setPhase] = useState<'final-statement' | 'ready-for-deliberation'>('final-statement');

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
  }, [selectedCase, user, hydrated, router]);

  const handleFinalStatementDone = () => {
    advanceLifecycleForPage('/student/judge-final-statement');
    addLearningRecord({
      pageName: '被告人最后陈述',
      conversations: [],
      summary: '审判长主持被告人最后陈述环节',
      evaluation: '已完成最后陈述环节',
      suggestion: '请进入评议讨论环节，撰写刑事判决书',
      createdAt: Date.now(),
    });
    setPhase('ready-for-deliberation');
  };

  if (!selectedCase) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (phase === 'final-statement') {
    return (
      <FlowPage
        title="被告人最后陈述"
        rounds={[
          {
            systemPrompt: `以旁白形式沉浸式描写庭审现场。审判长宣布法庭辩论结束，进入被告人最后陈述环节。审判长宣布由被告人作最后陈述。法庭气氛庄重安静。不要使用任何小标题或序号，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}

角色资料:
${selectedCase?.person || ''}

全部学习记录:
${learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n')}`,
            contextData: selectedCase?.case || '',
          },
          {
            systemPrompt: `以旁白形式沉浸式描写被告人最后陈述。被告人站起，根据自己的角色设定和学习记录中的对话表现，作最后陈述。不要使用任何小标题或序号，融入被告人的语气和神态细节，用纯叙事段落呈现，约500字。

案件基本资料:
${selectedCase?.case || ''}

角色资料:
${selectedCase?.person || ''}

全部学习记录:
${learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n')}`,
            contextData: selectedCase?.case || '',
          },
        ]}
        open={true}
        onClose={handleFinalStatementDone}
        onSkipAll={handleFinalStatementDone}
        showCloseButton={true}
        closeButtonText="继续 → 评议讨论"
        backgroundImage="/bg-final-statement.jpeg"
      />
    );
  }

  // ready-for-deliberation
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="被告人最后陈述"
        onContinue={() => router.push('/student/judge-deliberation')}
        canContinue={true}
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <Card>
            <CardContent className="pt-6">
              <h2 className="text-lg font-semibold mb-2">进入评议讨论环节</h2>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>被告人最后陈述环节已完成。接下来审判长将主持合议庭评议讨论。</p>
                <p>在评议讨论中，审判长需要亲自撰写<strong>第一审刑事判决书</strong>。这是检验审判长法律分析能力和文书写作能力的重要环节，请认真完成。</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-center">
            <Button size="lg" onClick={() => router.push('/student/judge-deliberation')}>
              <Gavel className="h-5 w-5 mr-2" />
              进入评议讨论
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
