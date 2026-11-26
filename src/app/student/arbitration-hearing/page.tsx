'use client';

/**
 * 国际仲裁 / 涉外民商事诉讼庭审页（调查 + 辩论共用，?phase=investigation|debate；类型差异见 lib/forum-profile.ts）
 *
 * 数据驱动：阶段来自 getFlow('arbitration', role, phase)，发言风格来自 arbitration-style，
 * 程序知识来自 arbitration-knowledge。见 docs/arbitration-design.md 第6、7节。
 *
 * 沿用 AGENTS.md 全部既有约束：
 * - 发问类 ai 阶段必须配 responder（在 flows/arbitration.ts 中已配）
 * - responder 回答完成后必须复位 userInteractedRef=false，否则下一个 ai 阶段误判用户打断而假死
 * - 文本/语音双模式：文本模式零 TTS，语音模式走分句流水线
 * - TTS 仅在 voiceModeRef.current 为真时生成；阶段推进用 waitForTtsQueueDrain(8)
 * - 流式 setState 经 createThrottledStreamSetter 节流
 * - useStageDialogueLogger 的 pageName 稳定；messages 为 state 引用，非内联数组
 * - useSearchParams 必须包在 Suspense 内
 */

import React, { Suspense, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Send, SkipForward, Mic, Square, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { CaseFileViewer } from '@/components/case-file-viewer';
import { CourtroomDiagram } from '@/components/courtroom-diagram';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { usePressTalk } from '@/hooks/use-press-talk';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { useAppStore } from '@/lib/store';
import { getFlow, type FlowPhase, type StageDef } from '@/lib/flows';
import { getRoleLabel } from '@/lib/case-type';
import { buildArbitrationContext, buildArbitrationFileSections } from '@/lib/arbitration-case-utils';
import { getArbitrationNextRoute } from '@/lib/arbitration-route';
import { buildHearingSystemPrompt, buildHearingUserContent, finalizeHearingText, responderForUserTurn, hearingReplyFormat, isQuestioningDone, type PromptOpts, type HearingCtx, type HearingMode } from '@/lib/hearing-engine';
import { getForumProfile, adversarialType } from '@/lib/forum-profile';
import { parseHighlights } from '@/lib/highlights';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback, waitForTtsQueueDrain } from '@/lib/audio';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { extractScore } from '@/lib/writing-outline';
import { stripLifecycleForStreaming, hasVisibleStream } from '@/lib/lifecycle-utils';
import { advanceArbitrationLifecycle } from '@/lib/arbitration-study';
import type { ChatMessage, LearningRecordEntry, UserRole } from '@/lib/types';

const PHASE_NAME: Record<FlowPhase, string> = { investigation: '庭审调查', debate: '庭审辩论' };

/** 各阶段用户所处的"提问者"标识前缀（与刑事页 AI_RESPOND 协议一致） */
const AI_RESPOND = 'AI_RESPOND:';
const USER_SAYS = 'USER_SAYS:';

function ArbitrationHearingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const phase: FlowPhase = searchParams.get('phase') === 'debate' ? 'debate' : 'investigation';
  const pageName = PHASE_NAME[phase];

  const { selectedCase, addLearningRecord, user, hydrated, learningRecords, selectedRole, documents } = useAppStore();
  const role: UserRole = selectedRole ?? 'defender';
  // 仲裁与涉外民商事诉讼共用本页：类型相关的措辞、知识、风格、流程全部来自 forum-profile
  const caseType = adversarialType(selectedCase?.caseType);
  const profile = getForumProfile(caseType);
  const roleLabel = getRoleLabel(caseType, role);

  // 稳定引用：同 (caseType, role, phase) 始终同一数组
  const STAGES: StageDef[] = getFlow(caseType, role, phase);

  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: pageName });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useStageDialogueLogger(pageName, messages);
  const userSpoke = messages.some((m) => m.role === 'user');

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  // 当前环节内学生已发问的次数（multiTurn 环节用），换环节清零
  const [stageTurns, setStageTurns] = useState(0);
  useEffect(() => { setStageTurns(0); }, [currentStageIdx]);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);

  const userInteractedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const isMobile = useIsMobile();

  const nextRoute = getArbitrationNextRoute(role, phase);

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
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, streamingText]);

  const contextData = buildArbitrationContext(selectedCase, documents);
  // 卷宗最前面放学生上一环节写的文书（起诉状 / 答辩状等），庭审陈述时可以对照自己的文书
  const myDocs = (['claim', 'answer', 'award'] as const)
    .filter((d) => (documents[d] ?? '').trim())
    .map((d) => ({ title: `${profile.docs[d].title}（我撰写的）`, book: documents[d] }));
  const caseFileSections = [
    ...(myDocs.length ? [{ label: '我的文书', items: myDocs }] : []),
    ...buildArbitrationFileSections(selectedCase),
  ];
  const highlightConfig = parseHighlights(selectedCase?.highlights);

  // 提示词与规则集中在 lib/hearing-engine.ts（scripts/hearing-sim.ts 整场模拟用的是同一份）
  const hearingCtx: HearingCtx = { caseData: selectedCase, profile, phase, pageName, role, roleLabel, stages: STAGES };
  const buildSystemPrompt = (speaker: string, mode: HearingMode, arg: string, opts: PromptOpts = {}): string => buildHearingSystemPrompt(hearingCtx, speaker, mode, arg, opts);

  const streamAIResponse = useCallback(async (prompt: string, speaker: string, playTts = true, opts: PromptOpts = {}): Promise<string> => {
    let finalText = '';
    setIsStreaming(true);
    setStreamingText('');
    setStreamingSpeaker(speaker);

    let mode: HearingMode = 'stage';
    let arg = '';
    if (prompt.startsWith(AI_RESPOND)) { mode = 'respond'; arg = prompt.slice(AI_RESPOND.length); }
    else if (prompt.startsWith(USER_SAYS)) { mode = 'user-reply'; arg = prompt.slice(USER_SAYS.length); }
    else { arg = prompt; }

    const systemPrompt = buildSystemPrompt(speaker, mode, arg, opts);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const ttsFeeder = voiceModeRef.current && playTts ? createTtsSentenceFeeder(speaker, 'arbitration-hearing-user') : null;
      const streamThrottle = createThrottledStreamSetter(setStreamingText);
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt + hearingReplyFormat(voiceModeRef.current) },
            {
              role: 'user',
              content: buildHearingUserContent(contextData, messagesRef.current, mode, prompt, arg, roleLabel),
            },
          ],
          temperature: 0.7,
          caching: true,
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data) as { content?: string };
            if (parsed.content) {
              fullText += parsed.content;
              streamThrottle.push(fullText);
              if (ttsFeeder) ttsFeeder.push(fullText);
            }
          } catch { /* skip */ }
        }
      }
      finalText = finalizeHearingText(speaker, fullText);
      const msg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        // 兜底：当事人发言末尾替主持人安排程序的句子剪掉（提示词已禁止，模型偶尔仍会说）
        content: finalText,
        timestamp: Date.now(),
        speaker,
      };
      // 同步写 ref：responder 紧接着就要读到这条提问；只靠 useEffect 同步会晚一拍，
      // 实测证人回答"未见对方提出具体问题"
      messagesRef.current = [...messagesRef.current, msg];
      setMessages((prev) => [...prev, msg]);
      setStreamingText('');
      if (ttsFeeder) ttsFeeder.flush(fullText);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `错误: ${err.message}`, timestamp: Date.now(), speaker }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      setStreamingText('');
      setStreamingSpeaker('');
      abortRef.current = null;
    }
    return finalText;
    // buildSystemPrompt 依赖 selectedCase/phase/roleLabel，这里随之重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextData, phase, roleLabel, selectedCase, profile]);

  const advanceTo = useCallback((nextIdx: number, runAI: (i: number) => void, delay = 300) => {
    setCurrentStageIdx(nextIdx);
    const next = STAGES[nextIdx];
    if (next && next.type === 'ai') setTimeout(() => runAI(nextIdx), delay);
  }, [STAGES]);

  const runAIStage = useCallback(async (stageIdx: number): Promise<void> => {
    const stage = STAGES[stageIdx];
    if (!stage) return;
    // 发问类环节可多轮问答（stage.rounds）：每轮问一个问题、对方回答；发问方说"询问完毕"即结束
    const n = stage.rounds ?? 1;
    for (let k = 1; k <= n; k++) {
      const said = await streamAIResponse(stage.label, stage.speaker, true, { stageId: stage.id, round: n > 1 ? { k, n } : undefined });
      if (voiceModeRef.current) await waitForTtsQueueDrain(8);
      // 发问类阶段：被问角色回答刚才的提问（必须配 responder，见 flows/arbitration.ts）
      if (stage.responder && stage.responder === roleLabel) {
        // 被问的是学生本人：不能由 AI 代答，停在下一环节等学生（阶段表应已拆分，这里是兜底）
        if (stageIdx + 1 < STAGES.length) setCurrentStageIdx(stageIdx + 1);
        return;
      }
      const finished = n > 1 && isQuestioningDone(said);
      if (stage.responder && !userInteractedRef.current && !(finished && !/[？?]/.test(said))) {
        await streamAIResponse(`${AI_RESPOND}${stage.speaker}`, stage.responder, true, { stageId: stage.id });
        if (voiceModeRef.current) await waitForTtsQueueDrain(8);
      }
      if (userInteractedRef.current || finished || !said) break;
    }
    if (userInteractedRef.current) { userInteractedRef.current = false; return; }
    if (stageIdx + 1 < STAGES.length) advanceTo(stageIdx + 1, runAIStage);
  }, [STAGES, streamAIResponse, advanceTo]);

  // 进入页面：有本阶段的进度快照（从下一步点「上一步」回来）就恢复笔录与环节位置；否则首阶段是 ai 时自动开始
  const progressKey = `${role}:${pageName}`;
  const saveHearingProgress = useAppStore((st) => st.saveHearingProgress);
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !selectedCase || !user) return;
    startedRef.current = true;
    const saved = useAppStore.getState().hearingProgress[progressKey];
    if (saved && saved.messages.length > 0) {
      messagesRef.current = saved.messages;
      setMessages(saved.messages);
      setCurrentStageIdx(Math.min(saved.stageIdx, STAGES.length - 1));
      return;
    }
    if (STAGES[0]?.type === 'ai') setTimeout(() => runAIStage(0), 400);
  }, [STAGES, selectedCase, user, runAIStage, progressKey]);
  // 每次笔录或环节变化都存快照（恢复完成前不写，避免空数组覆盖已有快照）
  useEffect(() => {
    if (!startedRef.current || messages.length === 0) return;
    saveHearingProgress(progressKey, { messages, stageIdx: currentStageIdx });
  }, [messages, currentStageIdx, progressKey, saveHearingProgress]);

  const handleSendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    const stage = STAGES[currentStageIdx];
    userInteractedRef.current = true;
    interruptTts();
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: text, timestamp: Date.now(), speaker: roleLabel };
    messagesRef.current = [...messagesRef.current, userMsg];
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // 回应者：阶段指定的 responder；没有则由对方代理人回应（自由辩论等）
    const responder = responderForUserTurn(stage, STAGES[currentStageIdx + 1]);
    if (responder) {
      await streamAIResponse(`${USER_SAYS}${text}`, responder, true, { stageId: stage?.id });
      if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    }
    // 用户发言已被回应，打断语义消费完毕——复位，否则下一个 ai 阶段发言完会被误判为"用户打断"而假死
    userInteractedRef.current = false;
    // 学生发问的环节可以连续问几次（stage.multiTurn），没问完前留在本环节；说"询问完毕"或点「下一环节」结束
    const turns = stageTurns + 1;
    if (stage?.multiTurn && turns < stage.multiTurn && !isQuestioningDone(text)) { setStageTurns(turns); return; }
    if (currentStageIdx + 1 < STAGES.length) advanceTo(currentStageIdx + 1, runAIStage);
  };

  const { isRecording, asrLoading, pressHandlers } = usePressTalk({
    uid: user?.id || 'guest',
    onText: (text) => { setInput(text); setTimeout(() => handleSendMessage(), 0); },
  });

  const handleNextStage = () => {
    if (isStreaming) { abortRef.current?.abort(); setIsStreaming(false); setStreamingText(''); }
    interruptTts();
    if (currentStageIdx + 1 < STAGES.length) advanceTo(currentStageIdx + 1, runAIStage, 400);
  };

  const goNext = () => {
    abortRef.current?.abort();
    interruptTts();
    advanceArbitrationLifecycle(phase === 'debate' ? 'hearing-debate' : 'hearing-investigation');
    router.push(nextRoute);
  };

  const handleContinue = async () => {
    // 学生本环节没发过言：不调 AI 打分（原先会把 AI 各角色的发言当成学生表现，跳过不答也能拿 80 多分）
    if (!userSpoke) {
      const record: LearningRecordEntry = { pageName, conversations: messages, summary: `本环节学生未发言（${roleLabel}的发言环节均被跳过）。`, evaluation: '本环节没有学生本人的发言，不评分。', suggestion: `建议回到本环节，在「轮到你发言」时以${roleLabel}身份完成陈述、举证、质证等任务。`, score: undefined, createdAt: Date.now() };
      setContinueRecord(record);
      addLearningRecord(record);
      setShowContinueModal(true);
      return;
    }
    setShowContinueModal(true);
    setContinueLoading(true);
    const allRecords = learningRecords.map((r) => `${r.pageName}: ${r.summary}`).join('\n');
    const summaryPrompt = `请根据以下${profile.hearingName}中${pageName}的学习过程，进行概括、评价和训练建议。学生扮演的角色是${roleLabel}。

案件资料:
${contextData}

## 程序与法律适用知识
${(phase === 'investigation' ? profile.investigationKnowledge : profile.debateKnowledge).join('\n')}

对话记录（标【学生】的是学生本人以${roleLabel}身份的发言，其余均为 AI 扮演的角色）:
${messages.map((m) => `${m.role === 'user' ? `【学生】${roleLabel}` : m.speaker || m.role}: ${m.content}`).join('\n')}

评分要求：**只依据标【学生】的发言**评价与打分。AI 角色（包括 AI 扮演的${roleLabel}以外的任何角色）的发言质量与学生无关，不得计入；学生发言很少或很简略时，得分应相应偏低。

之前的学习记录:
${allRecords}

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;
    try {
      const data = await fetchSummarySections({
        systemPrompt: `你是一位${profile.professor}，负责对${profile.trainingName}的学习过程进行总结评价。` + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      const evaluation = data.evaluation;
      const score = data.score !== undefined ? data.score : evaluation ? extractScore(evaluation) : undefined;
      const record: LearningRecordEntry = { pageName, conversations: messages, summary: data.summary || '', evaluation, suggestion: data.suggestion, score, createdAt: Date.now() };
      setContinueRecord(record);
      addLearningRecord(record);
    } catch {
      setContinueRecord({ pageName, conversations: messages, summary: '生成总结时出错', evaluation: '无法生成评价', suggestion: '请重试', createdAt: Date.now() });
    } finally {
      setContinueStream('');
      setContinueLoading(false);
    }
  };

  if (!selectedCase) {
    return <div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  const currentStage = STAGES[currentStageIdx];
  // 多次发问的环节：已问过至少一次时，提示可以继续问或结束
  const followUpHint = currentStage?.multiTurn && stageTurns > 0
    ? `可以继续发问（还可问 ${currentStage.multiTurn - stageTurns} 次），问完点「下一环节」结束询问`
    : '';
  const stageHint = followUpHint || currentStage?.hint || `请作为${roleLabel}发言`;
  const speakerNow = streamingSpeaker || ttsSpeaker || currentStage?.speaker || '';

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName={pageName}
        onSkip={goNext}
        onContinue={handleContinue}
        canContinue={userSpoke}
        continueTooltip="请先在「轮到你发言」的环节发言，再生成本环节总结"
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          <ResizablePanel defaultSize={66} minSize={30}>
            <div className="flex flex-col overflow-hidden h-full border-r">
              {voiceMode ? (
                <div className="relative flex-1 overflow-hidden">
                  {/* 庭室示意：原先是刑事法庭背景图（桌牌写公诉人、辩护人），与仲裁/民商事庭审不符 */}
                  <CourtroomDiagram layout={profile.courtroom} active={speakerNow} self={roleLabel} title={caseType === 'civil' ? '涉外民商事法庭' : '仲裁庭'} />
                  {currentStage?.type === 'interactive' && !isStreaming && (
                    <div className="absolute bottom-4 left-1/2 w-[min(36rem,90%)] -translate-x-1/2 z-20">
                      <div className="rounded-md bg-primary px-5 py-2.5 text-center text-sm font-medium text-primary-foreground shadow-lg">
                        {stageHint}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-thin bg-card">
                  {/* 庭审笔录式排版：左列发言人、右列发言内容，用户本人的发言加竖线强调。
                      原来是聊天气泡，多方发言时谁在说话靠颜色辨认，读起来不像庭审。 */}
                  <div className="mx-auto max-w-[52rem] px-6 py-6 lg:px-10">
                    <p className="mb-6 border-b pb-3 text-center font-display text-lg font-semibold tracking-[0.25em] text-foreground">{pageName}笔录</p>
                    {messages.length === 0 && !isStreaming && (
                      <p className="py-8 text-center text-sm text-muted-foreground">
                        {currentStage?.type === 'interactive' ? stageHint : `${pageName}即将开始…`}
                      </p>
                    )}
                    <ol className="space-y-5">
                      {messages.map((msg) => {
                        const mine = msg.role === 'user';
                        return (
                          <li key={msg.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4">
                            <p className={`pt-0.5 text-right text-sm font-semibold ${mine ? 'text-primary' : 'text-foreground'}`}>{msg.speaker}{mine && <span className="block text-xs font-normal text-muted-foreground">（本人）</span>}</p>
                            <div className={`markdown-content docket-text ${mine ? 'border-l-2 border-primary pl-4' : ''}`}><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown></div>
                          </li>
                        );
                      })}
                      {isStreaming && (
                        <li className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-4">
                          <p className="pt-0.5 text-right text-sm font-semibold text-foreground">{streamingSpeaker || currentStage?.speaker}</p>
                          {hasVisibleStream(streamingText) ? (
                            <div className="markdown-content docket-text"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown><span className="typewriter-cursor" /></div>
                          ) : (
                            <div className="flex items-center gap-2 pt-1 text-sm text-muted-foreground">
                              <span className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-primary" /><span className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-primary" /><span className="ai-thinking-dot h-1.5 w-1.5 rounded-full bg-primary" />
                              <span>{(streamingSpeaker || currentStage?.speaker || 'AI').trim()}正在组织发言</span>
                            </div>
                          )}
                        </li>
                      )}
                    </ol>
                  </div>
                </div>
              )}

              <div className={`shrink-0 space-y-2 border-t p-3 ${currentStage?.type === 'interactive' && !isStreaming ? 'bg-primary/[0.04]' : 'bg-card'}`}>
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm">
                    {/* 点开看本阶段完整程序：已完成打勾、当前高亮、学生发言的环节标「你」 */}
                    <Popover>
                      <PopoverTrigger asChild>
                        <button type="button" className="mr-1 rounded-sm text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground" title="查看本阶段全部环节">
                          环节 {currentStageIdx + 1}/{STAGES.length}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" side="top" className="max-h-[60vh] w-[min(30rem,90vw)] overflow-y-auto p-3">
                        <p className="mb-2 text-xs text-muted-foreground">{pageName}程序</p>
                        <ol className="space-y-1">
                          {STAGES.map((st, i) => (
                            <li key={st.id} className={`flex items-start gap-2 text-sm ${i === currentStageIdx ? 'font-semibold text-foreground' : i < currentStageIdx ? 'text-muted-foreground' : 'text-foreground/80'}`} aria-current={i === currentStageIdx ? 'step' : undefined}>
                              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums ${i < currentStageIdx ? 'border-primary/50 bg-primary/50 text-primary-foreground' : i === currentStageIdx ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/30'}`}>
                                {i < currentStageIdx ? <Check className="h-3 w-3" /> : i + 1}
                              </span>
                              <span className="min-w-0 flex-1 leading-snug">{st.label}</span>
                              {st.type === 'interactive' && <span className="shrink-0 rounded-sm bg-seal px-1.5 text-xs font-normal text-seal-foreground">你</span>}
                            </li>
                          ))}
                        </ol>
                      </PopoverContent>
                    </Popover>
                    <span className="font-medium">{currentStage?.label}</span>
                    {currentStage?.type === 'interactive' && !isStreaming && <span className="ml-2 rounded-sm bg-seal px-1.5 py-0.5 text-xs text-seal-foreground">轮到你发言</span>}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }} className="h-8 text-xs">
                    {voiceMode ? '改用文字' : '改用语音'}
                  </Button>
                  {currentStageIdx + 1 < STAGES.length ? (
                    <Button variant="outline" size="sm" className="h-8" onClick={handleNextStage} disabled={isStreaming}>
                      <SkipForward className="h-3.5 w-3.5" />下一环节
                    </Button>
                  ) : (
                    // 最后一个环节没有"下一环节"，原先按钮一直可见却点不动；改为结束本阶段：
                    // 发过言 → 生成本环节总结后进入下一步；没发过言 → 直接进入下一步（与跳过等价）
                    <Button size="sm" className="h-8" onClick={() => { interruptTts(); if (userSpoke) handleContinue(); else goNext(); }} disabled={isStreaming}>
                      <SkipForward className="h-3.5 w-3.5" />{userSpoke ? '完成本阶段' : '进入下一步'}
                    </Button>
                  )}
                </div>

                {currentStage?.type === 'interactive' && !voiceMode && (
                  <div className="flex gap-2">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={stageHint}
                      className="max-h-[120px] min-h-[64px] resize-none bg-card text-sm"
                      disabled={isStreaming || asrLoading}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
                    />
                    <Button size="icon" variant={isRecording ? 'destructive' : 'outline'} className="shrink-0 touch-none select-none" disabled={!isRecording && (isStreaming || asrLoading)} aria-label="按住说话" title="按住说话" {...pressHandlers}>
                      {isRecording ? <Square className="h-4 w-4" /> : asrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                    </Button>
                    <Button onClick={handleSendMessage} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0" aria-label="发送" title="发送（Enter）">
                      {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                )}

                {currentStage?.type === 'interactive' && voiceMode && (
                  <div className="flex justify-center gap-3">
                    <Button variant={isRecording ? 'destructive' : 'default'} size="sm" className="touch-none select-none" disabled={!isRecording && (isStreaming || asrLoading)} {...pressHandlers}>
                      {isRecording ? <><Square className="h-4 w-4 mr-1" />松开发送</> : <>{asrLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mic className="h-4 w-4 mr-1" />}{asrLoading ? '识别中...' : '按住说话'}</>}
                    </Button>
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
        onClose={() => { setShowContinueModal(false); if (continueRecord) goNext(); }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />
    </div>
  );
}

/**
 * 调查 → 辩论只改了 ?phase=，Next 复用同一个组件实例：消息、环节下标、"已开始"标记全部沿用调查阶段，
 * 实测进入辩论页仍显示调查笔录、"环节 15/8"且不会自动开始。按 phase 作 key 让每个阶段是独立实例。
 */
function ArbitrationHearingRoute() {
  const searchParams = useSearchParams();
  const phase = searchParams.get('phase') === 'debate' ? 'debate' : 'investigation';
  return <ArbitrationHearingInner key={phase} />;
}

export default function ArbitrationHearingPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <ArbitrationHearingRoute />
    </Suspense>
  );
}
