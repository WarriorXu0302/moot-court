'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePressTalk } from '@/hooks/use-press-talk';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { CaseFileViewer, type CaseFileSection } from '@/components/case-file-viewer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/lib/store';
import { parseHighlights } from '@/lib/highlights';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { VERDICT_STEPS, COURT_LANGUAGE_KNOWLEDGE } from '@/lib/knowledge';
import { Send, Loader2, SkipForward, Mic, Square, CheckCircle2, Home } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback, waitForTtsQueueDrain } from '@/lib/audio';
import { replyFormatInstruction } from '@/lib/response-style';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { LifecycleBar } from '@/components/lifecycle-bar';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming, hasVisibleStream } from '@/lib/lifecycle-utils';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';

const STAGES = [
  { id: 'clerk_stand', label: '书记员宣布全体起立', type: 'ai', speaker: '书记员' },
  { id: 'clerk_sit', label: '书记员宣布请坐下', type: 'ai', speaker: '书记员' },
  { id: 'judge_continue', label: '审判长宣布继续开庭', type: 'interactive', speaker: '审判长', hint: '请审判长宣布继续开庭' },
  { id: 'judge_verdict_content', label: '审判长宣布判决内容', type: 'interactive', speaker: '审判长', hint: '请审判长宣布判决内容，包括认证结论、裁判理由' },
  { id: 'clerk_stand2', label: '书记员宣布全体起立', type: 'ai', speaker: '书记员' },
  { id: 'judge_final_result', label: '审判长宣布判决结果', type: 'interactive', speaker: '审判长', hint: '请审判长宣布最终的判决结果' },
  { id: 'clerk_sit2', label: '书记员宣布请坐下', type: 'ai', speaker: '书记员' },
  { id: 'judge_appeal_rights', label: '审判长告知上诉权', type: 'interactive', speaker: '审判长', hint: '请审判长告知当事人上诉权并征询意见' },
  { id: 'defendant_response', label: '被告人回答', type: 'ai', speaker: '被告人' },
  { id: 'judge_close_court', label: '审判长宣布闭庭', type: 'interactive', speaker: '审判长', hint: '请审判长宣布闭庭' },
  { id: 'clerk_stand3', label: '书记员宣布全体起立', type: 'ai', speaker: '书记员' },
  { id: 'clerk_dismiss', label: '书记员宣布散庭', type: 'ai', speaker: '书记员' },
];

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

type Phase = 'interactive' | 'completed';

export default function JudgeVerdictPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '宣判与闭庭' });

  const { selectedCase, addLearningRecord, user, hydrated, learningRecords, selectedRole, documents } = useAppStore();

  const [phase, setPhase] = useState<Phase>('interactive');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('宣判与闭庭', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const { isRecording, asrLoading, pressHandlers } = usePressTalk({
    uid: user?.id || 'guest',
    onText: (text) => {
      setInput(text);
      setTimeout(() => handleSendMessage(), 0);
    },
  });
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);
  const userInteractedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
  }, [selectedCase, user, hydrated, router]);

  useEffect(() => {
    setTtsSpeakerCallback(setTtsSpeaker);
    return () => { setTtsSpeakerCallback(null); interruptTts(); abortRef.current?.abort(); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }
  }, [messages, streamingText]);

  useEffect(() => {
    if (phase === 'interactive' && !autoStartedRef.current) {
      autoStartedRef.current = true;
      setTimeout(() => runAIStage(0), 500);
    }
  }, [phase]);

  const finalVerdict = documents.finalJudge || '';

  const contextData = `案件基本资料:\n${selectedCase?.case || ''}\n\n诉讼文书卷:\n${selectedCase?.plead || ''}\n\n询问笔录:\n${selectedCase?.record || ''}\n\n证据材料:\n${selectedCase?.evidence || ''}\n\n相关法条和司法解释:\n${selectedCase?.law || ''}\n\n刑事起诉书:\n${selectedCase?.indictment || ''}\n\n公诉意见书:\n${selectedCase?.prosecution || ''}\n\n辩护词:\n${selectedCase?.defense || ''}\n\n庭审提纲:\n${documents.plan || selectedCase?.plan || ''}\n\n审判长撰写的刑事判决书:\n${finalVerdict}\n\n角色资料:\n${selectedCase?.person || ''}`;

  const caseFileSections: CaseFileSection[] = [
    { label: '诉讼文书卷', items: parseJsonArray(selectedCase?.plead) },
    { label: '询问笔录', items: parseJsonArray(selectedCase?.record) },
    { label: '证据材料', items: parseJsonArray(selectedCase?.evidence) },
  ];
  const highlightConfig = parseHighlights(selectedCase?.highlights);

  const streamAIResponse = useCallback(async (prompt: string, speaker: string, playTts = true) => {
    setIsStreaming(true);
    setStreamingText('');
    setStreamingSpeaker(speaker);

    const isJudgeContent = prompt.startsWith('审判长发言:');
    const judgeContent = isJudgeContent ? prompt.replace('审判长发言: ', '') : '';

    const systemPrompt = `你正在模拟法庭宣判与闭庭环节。你当前扮演的角色是"${speaker}"。

${isJudgeContent ? `审判长（用户）刚刚发言："${judgeContent}"，请你以${speaker}的身份回应。` : '请根据宣判的操作步骤和注意事项来推演法庭进展，你代表当前阶段的角色发言。'}

${speaker === '书记员' ? '你是书记员，负责宣布程序性指令。请严格按照宣判操作步骤中书记员的台词发言。' : ''}
${speaker === '被告人' ? '你是被告人，请根据审判长告知的上诉权内容，做出自然的回答。' : ''}

请注意：
- 你的回复要符合角色身份，使用口语化表达，像真实说话一样自然
- 每次回复不超过50字
- 不要重复之前已经说过的话
- 不要使用括号描述神情、表情、动作等
- 严禁代替其他角色发言，只扮演"${speaker}"这一个角色

以下是宣判的操作步骤和注意事项:
${VERDICT_STEPS}

以下是法庭语言的相关知识:
案件生命周期：系统已在案例详情页自动生成了初始的生命周期时间轴（从立案开始的各关键节点）。在后续对话中，你需要智能判断是否需要更新生命周期：
- 当对话涉及新的诉讼阶段或法律程序节点时，在回复末尾输出已完成的阶段节点（用<LIFECYCLE>标签包裹JSON）
- 当对话只是讨论已有阶段内的细节（如证据分析、法条解释）时，不需要重复输出生命周期
- 输出格式：<LIFECYCLE>{"nodes":[{"stage":"阶段名","legalActions":"详细描述该阶段的具体法律行为，包括主体、程序步骤和关键环节（不少于30字）","documents":"列出形成的法律文书并说明其内容和作用（不少于20字）","legalBasis":"写明法律条文全称及条文要旨"},...]}</LIFECYCLE>
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段
- 只输出已完成的阶段节点（学生已经经历过的阶段），不要输出未来未到达的阶段
- 输出时应包含之前所有已完成节点加上当前新完成的节点，不要包含未来阶段
- 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述
可行性评估与风险提示：如果用户提出明显偏离案件事实或法律规定的假设，你不必直接顺着用户的思路给答案，而应指出该假设与案件事实或法律规定之间的差异，提示相关风险，并引导用户回到合法合理的分析路径上。
${COURT_LANGUAGE_KNOWLEDGE}`;

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const ttsFeeder = voiceModeRef.current && playTts ? createTtsSentenceFeeder(speaker, 'judge-verdict-user') : null;
      const streamThrottle = createThrottledStreamSetter(setStreamingText);
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt + replyFormatInstruction(voiceModeRef.current) },
            { role: 'user', content: contextData + '\n\n已有对话:\n' + messages.map(m => `${m.speaker}: ${m.content}`).join('\n') + '\n\n当前阶段: ' + prompt },
          ],
          temperature: 0.7,
          caching: true,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try { const parsed = JSON.parse(data); if (parsed.content) { fullText += parsed.content; streamThrottle.push(fullText); if (ttsFeeder) ttsFeeder.push(fullText); } } catch { /* skip */ }
          }
        }
      }

      const msg: ChatMessage = { id: `msg-${Date.now()}`, role: 'assistant', content: parseLifecycleFromAIResponse(fullText), timestamp: Date.now(), speaker };
      setMessages((prev) => [...prev, msg]);
      setStreamingText('');
      if (ttsFeeder) ttsFeeder.flush(fullText);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `错误: ${err.message}`, timestamp: Date.now(), speaker }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false); setStreamingText(''); setStreamingSpeaker(''); abortRef.current = null;
    }
  }, [contextData, messages]);

  const runAIStage = useCallback(async (stageIdx: number) => {
    const stage = STAGES[stageIdx];
    if (!stage) return;
    await streamAIResponse(stage.label, stage.speaker, true);
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    if (userInteractedRef.current) { userInteractedRef.current = false; return; }
    if (stageIdx + 1 < STAGES.length) {
      const nextStage = STAGES[stageIdx + 1];
      setCurrentStageIdx(stageIdx + 1);
      if (nextStage.type === 'ai') { setTimeout(() => runAIStage(stageIdx + 1), 300); }
    }
  }, [streamAIResponse]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    userInteractedRef.current = true;
    interruptTts();
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: input.trim(), timestamp: Date.now(), speaker: '审判长' };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    const currentStage = STAGES[currentStageIdx];
    const responder = (currentStage as { responder?: string })?.responder;

    if (responder) {
      await streamAIResponse(`审判长发言: ${input.trim()}`, responder, true);
      if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    }
    // 用户发言已被responder回应，打断语义消费完毕——复位以让后续AI阶段正常自动推进（否则下个AI阶段发言后会误判为用户打断而假死）
    userInteractedRef.current = false;

    if (currentStageIdx + 1 < STAGES.length) {
      const nextStage = STAGES[currentStageIdx + 1];
      setCurrentStageIdx(currentStageIdx + 1);
      if (nextStage.type === 'ai') { setTimeout(() => runAIStage(currentStageIdx + 1), 300); }
    }
  };

  const handleNextStage = () => {
    if (isStreaming) { abortRef.current?.abort(); setIsStreaming(false); setStreamingText(''); }
    interruptTts();
    if (currentStageIdx + 1 < STAGES.length) {
      const nextIdx = currentStageIdx + 1;
      setCurrentStageIdx(nextIdx);
      const nextStage = STAGES[nextIdx];
      if (nextStage.type === 'ai') { setTimeout(() => runAIStage(nextIdx), 400); }
    }
  };


  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    const allRecords = learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n');
    const summaryPrompt = `请根据以下宣判与闭庭的学习过程，进行概括、评价和训练建议。

案件资料:
${contextData}

## 宣判的操作步骤和注意事项
${VERDICT_STEPS}

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

审判长撰写的刑事判决书:
${finalVerdict || '审判长未提交刑事判决书'}

之前的学习记录:
${allRecords}

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;

    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位法学教授，负责对模拟法庭训练的学习过程进行总结评价。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      let summary = data.summary || '', evaluation = data.evaluation, suggestion = data.suggestion, score: number | undefined = data.score;
      if (score === undefined && evaluation) { try { const { extractScore } = await import('@/lib/writing-outline'); score = extractScore(evaluation); } catch { /* skip */ } }
      const record: LearningRecordEntry = { pageName: '宣判与闭庭', conversations: messages, summary, evaluation, suggestion, score, createdAt: Date.now() };
      setContinueRecord(record); addLearningRecord(record);
    } catch {
      setContinueRecord({ pageName: '宣判与闭庭', conversations: messages, summary: '生成总结时出错', evaluation: '无法生成评价', suggestion: '请重试', createdAt: Date.now() });
    } finally {
      setContinueStream('');
      setContinueLoading(false);
    }
  };

  const handleEndTraining = () => {
    // 结束训练同样先展示全程学习分析（遍历各环节学习记录），关闭弹窗后保存并返回案例选择
    handleEndAnalysis();
  };

  if (!selectedCase) {
    return (<div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>);
  }

  if (phase === 'completed') {
    return (
      <div className="h-screen flex flex-col bg-background overflow-hidden">
        <TitleBar
          pageName="宣判与闭庭"
          showHome
          onHome={() => router.push('/')}
          isStudent
        />
      {endAnalysisModal}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto space-y-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="h-6 w-6 text-primary" />
                  <h2 className="text-xl font-semibold">庭审流程已全部完成</h2>
                </div>

                {continueRecord ? (
                  <div className="space-y-4">
                    <div>
                      <h3 className="font-semibold text-sm mb-1 text-primary">概括</h3>
                      <div className="text-sm text-muted-foreground markdown-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{continueRecord.summary}</ReactMarkdown>
                      </div>
                    </div>
                    {continueRecord.evaluation && (
                      <div>
                        <h3 className="font-semibold text-sm mb-1 text-primary">评价</h3>
                        <div className="text-sm text-muted-foreground markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{continueRecord.evaluation}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                    {continueRecord.suggestion && (
                      <div>
                        <h3 className="font-semibold text-sm mb-1 text-primary">训练建议</h3>
                        <div className="text-sm text-muted-foreground markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{continueRecord.suggestion}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">宣判与闭庭流程已完成。</p>
                )}

                <div className="mt-6 flex justify-center gap-3">
                  <Button variant="outline" onClick={() => router.push('/student/select')}>
                    <Home className="h-4 w-4 mr-2" />
                    返回案例选择
                  </Button>
                  <Button onClick={handleEndTraining}>
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    结束训练
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  const currentStage = STAGES[currentStageIdx];

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="宣判与闭庭"
        onSkip={() => { if (abortRef.current) abortRef.current.abort(); interruptTts(); advanceLifecycleForPage('/student/judge-verdict'); handleContinue(); }}
        onContinue={handleContinue}
        canContinue={messages.length > 0}
        continueTooltip="请先参与宣判流程"
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      <LifecycleBar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          <ResizablePanel defaultSize={66} minSize={30}>
            <div className="flex flex-col overflow-hidden h-full border-r">
          {voiceMode ? (
            <div className="relative flex-1 overflow-hidden bg-cover bg-center" style={{ backgroundImage: 'url(/characters/judge.png)' }}>
              {(isStreaming || ttsSpeaker) && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                  <div className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground animate-pulse" />
                    <span className="text-base font-semibold">{streamingSpeaker || ttsSpeaker || currentStage?.speaker} 正在发言</span>
                  </div>
                </div>
              )}
              {!isStreaming && !ttsSpeaker && currentStage?.speaker && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                  <div className="px-4 py-1.5 rounded-full bg-card/70 backdrop-blur shadow text-sm text-muted-foreground">{currentStage.speaker}</div>
                </div>
              )}
              {currentStage?.type === 'interactive' && !isStreaming && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
                  <div className="px-5 py-2.5 rounded-full bg-primary/90 backdrop-blur shadow-lg text-sm font-medium text-center text-primary-foreground">
                    请作为审判长发言
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 min-h-0">
              {messages.length === 0 && !isStreaming && (<div className="text-center text-muted-foreground py-8 text-sm">宣判即将开始...</div>)}
              {messages.map((msg) => (
                <div key={msg.id}>
                  {msg.role === 'user' ? (
                    <div className="flex justify-end">
                      <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground">
                        <div className="font-semibold mb-1">{msg.speaker}</div><div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown></div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex justify-start">
                      <div className="max-w-[85%]">
                        <div className="text-xs font-semibold mb-0.5 text-primary">{msg.speaker}</div>
                        <div className="rounded-lg px-3 py-2 text-sm bg-muted markdown-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {isStreaming && (
                <div className="flex justify-start">
                  <div className="max-w-[85%]">
                    <div className="text-xs font-semibold mb-0.5 text-primary">{streamingSpeaker || currentStage?.speaker}</div>
                    <div className="rounded-lg px-3 py-2 text-sm bg-muted">
                      {hasVisibleStream(streamingText) ? (
                        <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown><span className="typewriter-cursor" /></div>
                      ) : (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" /><span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" /><span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" /><span>{(streamingSpeaker || currentStage?.speaker || 'AI').trim()}正在思考…</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="border-t p-3 space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">当前环节: {currentStage?.label}</span>
              <Button variant={voiceMode ? 'default' : 'outline'} size="sm" onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }} className="text-xs h-7">{voiceMode ? '切换文字模式' : '切换语音模式'}</Button>
              <Button variant="outline" size="sm" onClick={handleNextStage} disabled={isStreaming}><SkipForward className="h-3.5 w-3.5 mr-1" />下一环节</Button>
            </div>

            {currentStage?.type === 'interactive' && !voiceMode && (
              <div className="flex gap-2">
                <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={(currentStage as { hint?: string })?.hint || '请作为审判长发言...'} className="resize-none text-sm min-h-[40px] max-h-[80px]" disabled={isStreaming || asrLoading} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                <Button size="icon" variant={isRecording ? 'destructive' : 'outline'} className="shrink-0 touch-none select-none" disabled={!isRecording && (isStreaming || asrLoading)} aria-label="按住说话" title="按住说话" {...pressHandlers}>{isRecording ? <Square className="h-4 w-4" /> : asrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}</Button>
                <Button onClick={handleSendMessage} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0" aria-label="发送" title="发送（Enter）">{isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
              </div>
            )}

            {currentStage?.type === 'interactive' && voiceMode && (
              <div className="flex justify-center gap-3">
                <Button variant={isRecording ? 'destructive' : 'default'} size="sm" className="touch-none select-none" disabled={!isRecording && (isStreaming || asrLoading)} {...pressHandlers}>{isRecording ? <><Square className="h-4 w-4 mr-1" />松开发送</> : <>{asrLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mic className="h-4 w-4 mr-1" />}{asrLoading ? '识别中...' : '按住说话'}</>}</Button>
              </div>
            )}

            {currentStage?.type === 'ai' && !isStreaming && (
              <div className="text-xs text-muted-foreground text-center py-1">
                {currentStage.label} · 自动推进中
              </div>
            )}
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={34} minSize={20}>
            <div className="overflow-hidden flex flex-col h-full">
              <CaseFileViewer sections={caseFileSections} title="卷宗" highlightConfig={highlightConfig} currentRole={selectedRole || undefined} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ContinueModal
        open={showContinueModal}
        onClose={() => { setShowContinueModal(false); setPhase('completed'); }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />
    </div>
  );
}
