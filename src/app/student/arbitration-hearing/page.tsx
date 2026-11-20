'use client';

/**
 * 国际仲裁庭审页（调查 + 辩论共用，?phase=investigation|debate）
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
import { Loader2, Send, SkipForward, Mic, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { CaseFileViewer } from '@/components/case-file-viewer';
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
import { buildArbitrationContext, buildArbitrationFileSections, findPerson } from '@/lib/arbitration-case-utils';
import { getArbitrationNextRoute } from '@/lib/arbitration-route';
import { ARB_INVESTIGATION_STYLE, ARB_DEBATE_STYLE } from '@/lib/arbitration-style';
import {
  ARB_OPENING_KNOWLEDGE,
  ARB_JURISDICTION_KNOWLEDGE,
  ARB_EVIDENCE_KNOWLEDGE,
  ARB_WITNESS_KNOWLEDGE,
  ARB_CLOSING_KNOWLEDGE,
} from '@/lib/arbitration-knowledge';
import { parseHighlights } from '@/lib/highlights';
import { replyFormatInstruction } from '@/lib/response-style';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback, waitForTtsQueueDrain } from '@/lib/audio';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { extractScore } from '@/lib/writing-outline';
import {
  parseLifecycleFromAIResponse,
  stripLifecycleForStreaming,
  hasVisibleStream,
} from '@/lib/lifecycle-utils';
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
  const roleLabel = getRoleLabel('arbitration', role);

  // 稳定引用：同 (role, phase) 始终同一数组
  const STAGES: StageDef[] = getFlow('arbitration', role, phase);

  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: pageName });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useStageDialogueLogger(pageName, messages);

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => { voiceModeRef.current = voiceMode; }, [voiceMode]);

  const [currentStageIdx, setCurrentStageIdx] = useState(0);
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
  const caseFileSections = buildArbitrationFileSections(selectedCase);
  const highlightConfig = parseHighlights(selectedCase?.highlights);

  /** 构造某发言者的系统提示词 */
  /**
   * AI 阶段发言的环节说明：告诉 AI 当前是哪个环节、下一环节由谁做什么。
   * 原先只说"推演庭审进展"，AI 不知道环节边界，会自行插入流程里没有的步骤
   * （如首席仲裁员要求申请人核对身份，但阶段表里没有这一轮，学生没机会回答，流程直接跳走）。
   */
  const stageInstruction = (label: string): string => {
    const idx = STAGES.findIndex((st) => st.label === label);
    const next = idx >= 0 ? STAGES[idx + 1] : undefined;
    const nextText = next
      ? `下一环节是「${next.label}」，由${next.speaker}${next.type === 'interactive' ? `（即用户扮演的${roleLabel}）` : ''}进行。`
      : '本环节是本阶段的最后一个环节。';
    return `当前程序环节：「${label}」。你只完成这一个环节应做的事，${nextText}
- 可以在发言结尾按下一环节的内容点名下一位发言人（如"请${next?.speaker ?? '各方'}……"），但不要提出与下一环节无关的要求；
- 不要插入阶段表以外的程序步骤（如额外核实身份、额外提问后等待回答），也不要替下一位发言人回答。`;
  };

  const buildSystemPrompt = (speaker: string, mode: 'stage' | 'respond' | 'user-reply', arg: string): string => {
    const person = findPerson(selectedCase, speaker);
    const personText = person ? `\n你的角色设定：${person.set}\n你应当如实陈述或坚持的核心信息：${person.message}\n` : '';
    const intro =
      mode === 'respond'
        ? `刚才${arg}向你提问或发言（见对话记录最后一条），请你以${speaker}的身份回应。注意：你是被询问的对象，只回应刚才的提问，不要代替${arg}或其他任何角色发言，更不要自行继续提问。`
        : mode === 'user-reply'
          ? `用户（${roleLabel}）刚刚发言："${arg}"，请你以${speaker}的身份简短回应。注意：你只扮演${speaker}，不要代替${roleLabel}发言。**回应以陈述收尾，不要向${roleLabel}追问或要求其补充回答**——用户在本环节没有再次发言的机会，追问会让问题悬空；需要追问的内容留到后面的"仲裁庭提问"环节。`
          : stageInstruction(arg);
    const knowledge =
      phase === 'investigation'
        ? [ARB_OPENING_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_WITNESS_KNOWLEDGE]
        : [ARB_CLOSING_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE];
    return `你正在模拟一场国际商事仲裁庭审（${pageName}）。你当前扮演的角色是"${speaker}"。
${personText}
${intro}

可获取的资料：案件基本资料、仲裁文书卷、证人与专家陈述笔录、证据材料、法律依据（见上下文）。${speaker === '证人' || speaker === '专家证人' ? '你只知道自己亲身经历或专业范围内的事实，不知道其他人的证言。' : ''}

请注意：
- 发言须符合角色身份与仲裁庭审语境，各角色的字数与语言风格必须严格符合下方【仲裁庭审发言风格要求】（宣读法律文书、证据清单原文时按完整篇幅，不受此限）
- 依据案件资料发言，不得编造案情之外的事实、金额、日期
- 严禁代替其他角色发言，只扮演"${speaker}"这一个角色
- 如果用户（${roleLabel}）提出明显偏离案件事实或法律规定的主张，不必顺着答，应指出差异并引导回到合法合理的论证路径

以下是仲裁程序相关知识，供参考（具体条文号以仲裁规则文本为准，不要自行编造条文号）：

${knowledge.join('\n\n')}

${phase === 'investigation' ? ARB_INVESTIGATION_STYLE : ARB_DEBATE_STYLE}`;
  };

  const streamAIResponse = useCallback(async (prompt: string, speaker: string, playTts = true) => {
    setIsStreaming(true);
    setStreamingText('');
    setStreamingSpeaker(speaker);

    let mode: 'stage' | 'respond' | 'user-reply' = 'stage';
    let arg = '';
    if (prompt.startsWith(AI_RESPOND)) { mode = 'respond'; arg = prompt.slice(AI_RESPOND.length); }
    else if (prompt.startsWith(USER_SAYS)) { mode = 'user-reply'; arg = prompt.slice(USER_SAYS.length); }
    else { arg = prompt; }

    const systemPrompt = buildSystemPrompt(speaker, mode, arg);
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
            { role: 'system', content: systemPrompt + replyFormatInstruction(voiceModeRef.current) },
            {
              role: 'user',
              content:
                contextData +
                '\n\n已有对话:\n' +
                messagesRef.current.map((m) => `${m.speaker}: ${m.content}`).join('\n') +
                '\n\n当前阶段: ' + (mode === 'stage' ? prompt : mode === 'respond' ? `回应${arg}` : `回应${roleLabel}`),
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
      const msg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: 'assistant',
        content: parseLifecycleFromAIResponse(fullText),
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
    // buildSystemPrompt 依赖 selectedCase/phase/roleLabel，这里随之重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextData, phase, roleLabel, selectedCase]);

  const advanceTo = useCallback((nextIdx: number, runAI: (i: number) => void, delay = 300) => {
    setCurrentStageIdx(nextIdx);
    const next = STAGES[nextIdx];
    if (next && next.type === 'ai') setTimeout(() => runAI(nextIdx), delay);
  }, [STAGES]);

  const runAIStage = useCallback(async (stageIdx: number): Promise<void> => {
    const stage = STAGES[stageIdx];
    if (!stage) return;
    await streamAIResponse(stage.label, stage.speaker, true);
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    // 发问类阶段：被问角色回答刚才的提问（必须配 responder，见 flows/arbitration.ts）
    if (stage.responder && stage.responder === roleLabel) {
      // 被问的是学生本人：不能由 AI 代答，停在下一环节等学生（阶段表应已拆分，这里是兜底）
      if (stageIdx + 1 < STAGES.length) setCurrentStageIdx(stageIdx + 1);
      return;
    }
    if (stage.responder && !userInteractedRef.current) {
      await streamAIResponse(`${AI_RESPOND}${stage.speaker}`, stage.responder, true);
      if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    }
    if (userInteractedRef.current) { userInteractedRef.current = false; return; }
    if (stageIdx + 1 < STAGES.length) advanceTo(stageIdx + 1, runAIStage);
  }, [STAGES, streamAIResponse, advanceTo]);

  // 进入页面：若首阶段是 ai 则自动开始
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current || !selectedCase || !user) return;
    startedRef.current = true;
    if (STAGES[0]?.type === 'ai') setTimeout(() => runAIStage(0), 400);
  }, [STAGES, selectedCase, user, runAIStage]);

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
    const defaultResponder = role === 'prosecutor' ? '被申请人代理人' : role === 'defender' ? '申请人代理人' : '申请人代理人';
    const responder = stage?.responder ?? defaultResponder;
    await streamAIResponse(`${USER_SAYS}${text}`, responder, true);
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    // 用户发言已被回应，打断语义消费完毕——复位，否则下一个 ai 阶段发言完会被误判为"用户打断"而假死
    userInteractedRef.current = false;
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
    setShowContinueModal(true);
    setContinueLoading(true);
    const allRecords = learningRecords.map((r) => `${r.pageName}: ${r.summary}`).join('\n');
    const summaryPrompt = `请根据以下国际商事仲裁${pageName}的学习过程，进行概括、评价和训练建议。学生扮演的角色是${roleLabel}。

案件资料:
${contextData}

## 仲裁程序知识
${phase === 'investigation' ? [ARB_OPENING_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_WITNESS_KNOWLEDGE].join('\n') : [ARB_CLOSING_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE].join('\n')}

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

之前的学习记录:
${allRecords}

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;
    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位国际仲裁与国际民事诉讼法教授，负责对模拟仲裁庭审训练的学习过程进行总结评价。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
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
  const speakerNow = streamingSpeaker || ttsSpeaker || currentStage?.speaker || '';

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName={pageName}
        onSkip={goNext}
        onContinue={handleContinue}
        canContinue={messages.length > 0}
        continueTooltip="请先参与庭审"
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
                <div className="relative flex-1 overflow-hidden bg-cover bg-center bg-muted" style={{ backgroundImage: 'url(/characters/judge.png)' }}>
                  {(isStreaming || ttsSpeaker) && (
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                      <div className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg">
                        <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground animate-pulse" />
                        <span className="text-base font-semibold">{speakerNow} 正在发言</span>
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
                        {currentStage.hint || `请作为${roleLabel}发言`}
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
                        {currentStage?.type === 'interactive' ? (currentStage.hint || `请作为${roleLabel}发言`) : `${pageName}即将开始…`}
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
                    <span className="text-muted-foreground">环节 {currentStageIdx + 1}/{STAGES.length}　</span>
                    <span className="font-medium">{currentStage?.label}</span>
                    {currentStage?.type === 'interactive' && !isStreaming && <span className="ml-2 rounded-sm bg-seal px-1.5 py-0.5 text-xs text-seal-foreground">轮到你发言</span>}
                  </p>
                  <Button variant="ghost" size="sm" onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }} className="h-8 text-xs">
                    {voiceMode ? '改用文字' : '改用语音'}
                  </Button>
                  <Button variant="outline" size="sm" className="h-8" onClick={handleNextStage} disabled={isStreaming}>
                    <SkipForward className="h-3.5 w-3.5" />下一环节
                  </Button>
                </div>

                {currentStage?.type === 'interactive' && !voiceMode && (
                  <div className="flex gap-2">
                    <Textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder={currentStage.hint || `请作为${roleLabel}发言...`}
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
