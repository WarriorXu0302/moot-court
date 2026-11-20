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
import { Textarea } from '@/components/ui/textarea';
import { COURT_DEBATE_KNOWLEDGE, COURT_LANGUAGE_KNOWLEDGE } from '@/lib/knowledge';
import { useAppStore } from '@/lib/store';
import { parseHighlights } from '@/lib/highlights';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { Send, Loader2, SkipForward, Mic, Square, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback, waitForTtsQueueDrain } from '@/lib/audio';
import { replyFormatInstruction } from '@/lib/response-style';
import { DEBATE_SPEECH_STYLE } from '@/lib/court-style';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { LifecycleBar } from '@/components/lifecycle-bar';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming, hasVisibleStream } from '@/lib/lifecycle-utils';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { getFlow } from '@/lib/flows';

// Court debate stages — prosecutor perspective
const DEBATE_STAGES = getFlow('criminal', 'prosecutor', 'debate');

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

export default function ProsecutorDebatePage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '法庭辩论' });

  const { selectedCase, addLearningRecord, user, hydrated, learningRecords, selectedRole } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('法庭辩论', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingSpeaker, setStreamingSpeaker] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const [lastAiBubble, setLastAiBubble] = useState<{ speaker: string; content: string } | null>(null);
  const [currentStageIdx, setCurrentStageIdx] = useState(0);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);
  const userInteractedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const caseFileSections: CaseFileSection[] = [
    { label: '诉讼文书卷', items: parseJsonArray(selectedCase?.plead) },
    { label: '询问笔录', items: parseJsonArray(selectedCase?.record) },
    { label: '证据材料', items: parseJsonArray(selectedCase?.evidence) },
  ];
  const highlightConfig = parseHighlights(selectedCase?.highlights);

  const contextData = `案件基本资料:\n${selectedCase?.case || ''}\n\n诉讼文书卷:\n${selectedCase?.plead || ''}\n\n询问笔录:\n${selectedCase?.record || ''}\n\n证据材料:\n${selectedCase?.evidence || ''}\n\n相关法条和司法解释:\n${selectedCase?.law || ''}\n\n刑事起诉书:\n${selectedCase?.indictment || ''}\n\n公诉意见书:\n${selectedCase?.prosecution || ''}\n\n辩护词:\n${selectedCase?.defense || ''}\n\n角色资料:\n${selectedCase?.person || ''}`;

  const streamAIResponse = useCallback(async (prompt: string, speaker: string) => {
    setIsStreaming(true);
    setStreamingText('');
    setStreamingSpeaker(speaker);

    const systemPrompt = `你正在模拟一场法庭辩论。你当前扮演的角色是"${speaker}"。

请根据法庭辩论的操作步骤和注意事项来推演法庭进展。

${speaker === '审判长' ? '你能获取到案件基本资料和庭审提纲。你需要读取法庭语言的相关知识。' : ''}
${speaker === '公诉人' ? '你能获取到案件基本资料、刑事起诉书和公诉意见书。你需要读取法庭辩论和法庭语言的相关知识。' : ''}
${speaker === '被告人' ? '你能获取到辩护词。' : ''}
${speaker === '被害人' ? '你能获取到刑事代理词。' : ''}
${speaker === '辩护人' ? '你能获取到辩护词。你需要读取法庭辩论和法庭语言的相关知识。' : ''}

以下是法庭辩论的相关知识:
${COURT_DEBATE_KNOWLEDGE}

以下是法庭语言的相关知识:
${COURT_LANGUAGE_KNOWLEDGE}

注意事项:
- 如果受害人已去世或无法出庭，则被害人不发言，也去掉相应环节
- 在自由辩论中，法官根据具体情况决定是否介入
- 法庭辩论的目的是说服法官，辩论者应见好就收
- 使用口语化表达，像真实说话一样自然
- 各角色发言的语言风格与字数必须严格符合下方【发言语言风格要求】（宣读法律文书原文时按其完整篇幅，不受此限）
- 不要重复之前已经说过的话
案件生命周期：系统已在案例详情页自动生成了初始的生命周期时间轴（从立案开始的各关键节点）。在后续对话中，你需要智能判断是否需要更新生命周期：
- 当对话涉及新的诉讼阶段或法律程序节点时，在回复末尾输出已完成的阶段节点（用<LIFECYCLE>标签包裹JSON）
- 当对话只是讨论已有阶段内的细节（如证据分析、法条解释）时，不需要重复输出生命周期
- 输出格式：<LIFECYCLE>{"nodes":[{"stage":"阶段名","legalActions":"详细描述该阶段的具体法律行为，包括主体、程序步骤和关键环节（不少于30字）","documents":"列出形成的法律文书并说明其内容和作用（不少于20字）","legalBasis":"写明法律条文全称及条文要旨"},...]}</LIFECYCLE>
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段
- 只输出已完成的阶段节点（学生已经经历过的阶段），不要输出未来未到达的阶段
- 输出时应包含之前所有已完成节点加上当前新完成的节点，不要包含未来阶段
- 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述
可行性评估与风险提示：如果用户提出明显偏离案件事实或法律规定的假设，你不必直接顺着用户的思路给答案，而应指出该假设与案件事实或法律规定之间的差异，提示相关风险，并引导用户回到合法合理的分析路径上。
- 不要使用括号描述神情、表情、动作等，这些会被语音合成读出来

${DEBATE_SPEECH_STYLE}`;

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const ttsFeeder = voiceModeRef.current ? createTtsSentenceFeeder(speaker, 'prosecutor-debate-user') : null;
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
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                streamThrottle.push(fullText);
                if (ttsFeeder) ttsFeeder.push(fullText);
              }
            } catch { /* skip */ }
          }
        }
      }

      const msg: ChatMessage = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: parseLifecycleFromAIResponse(fullText),
        timestamp: Date.now(),
        speaker,
      };
      setMessages((prev) => [...prev, msg]);
      setStreamingText('');

      if (ttsFeeder) ttsFeeder.flush(fullText);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `错误: ${err.message}`,
          timestamp: Date.now(),
          speaker,
        }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      setStreamingText('');
      setStreamingSpeaker('');
      abortRef.current = null;
    }
  }, [contextData, messages]);

  const runAIStage = useCallback(async (stageIdx: number, autoRun = false) => {
    const stage = DEBATE_STAGES[stageIdx];
    if (!stage) return;
    await streamAIResponse(stage.label, stage.speaker);
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    if (userInteractedRef.current) {
      userInteractedRef.current = false;
      return;
    }
    if (stageIdx + 1 < DEBATE_STAGES.length) {
      const nextIdx = stageIdx + 1;
      setCurrentStageIdx(nextIdx);
      const nextStage = DEBATE_STAGES[nextIdx];
      if (autoRun && nextStage.type === 'ai') {
        setTimeout(() => runAIStage(nextIdx, true), 300);
      }
    }
  }, [streamAIResponse]);

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    const firstStage = DEBATE_STAGES[0];
    if (firstStage?.type === 'ai') {
      runAIStage(0, true);
    }
  }, [runAIStage]);


  // 长按说话（统一 hook：指针/触摸适配 + 竞态安全）
  const { isRecording, asrLoading, pressHandlers } = usePressTalk({
    uid: user?.id || 'guest',
    onText: (text) => {
      setInput(text);
      setTimeout(() => handleSendMessage(), 0);
    },
  });

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    userInteractedRef.current = true;
    interruptTts();
    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      speaker: '公诉人',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    const stage = DEBATE_STAGES[currentStageIdx];
    const responder = stage?.id === 'free_debate' ? '辩护人' : '审判长';
    await streamAIResponse(`公诉人发言: ${input.trim()}`, responder);
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    // 用户发言已被responder回应，打断语义消费完毕——复位以让后续AI阶段正常自动推进（否则下个AI阶段发言后会误判为用户打断而假死）
    userInteractedRef.current = false;
  };

  const handleNextStage = () => {
    interruptTts();
    if (voiceMode) {
      const lastAi = [...messages].reverse().find((m) => m.role === 'assistant');
      if (lastAi) setLastAiBubble({ speaker: lastAi.speaker || 'AI', content: lastAi.content });
    }
    if (isStreaming) {
      abortRef.current?.abort();
      setIsStreaming(false);
      setStreamingText('');
    }
    if (currentStageIdx + 1 < DEBATE_STAGES.length) {
      const nextIdx = currentStageIdx + 1;
      setCurrentStageIdx(nextIdx);
      const nextStage = DEBATE_STAGES[nextIdx];
      if (nextStage.type === 'ai') {
        runAIStage(nextIdx, true);
      }
    } else {
      // 辩论环节全部完成：走「继续」流程生成本环节学习记录，随后进入最后陈述，而非直接结束训练
      handleContinue();
    }
  };

  const handleSkipAll = () => {
    interruptTts();
    if (isStreaming) {
      abortRef.current?.abort();
      setIsStreaming(false);
      setStreamingText('');
    }
    router.push('/student/final-statement');
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    const allRecords = learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n');
    const summaryPrompt = `请根据以下法庭辩论的学习过程，进行概括、评价和训练建议。

案件资料:\n${contextData}

## 法庭辩论的操作步骤
- 1. 审判长宣布进入法庭辩论。
- 2. 公诉人发表公诉意见。
- 3. 被害人及其诉讼代理人发言。
- 4. 被告人自行辩护。
- 5. 辩护人辩护。
- 6. 在审判长的主持下控辩双方进行新一轮辩论。
- 7. 审判长宣布法庭辩论结束。
## 法庭辩论的注意事项：
- 1. 刑事审判中的法庭辩论，包括在法庭调查阶段的法庭辩论和专门的法庭辩论阶段进行的辩论。
- 2. 审判长应当善于抓住双方辩论的焦点和分歧点，将辩论引向深入。
- 3. 在个别案件中，被害人和公诉人的意见可能会有分歧，此时审判长应允许被害人与公诉人之间进行辩论。
- 4. 在司法实践中，法庭辩论阶段公诉人的第一次发言通常称为公诉词（或公诉意见书），辩护人的第一次发言称为辩护词。
- 5. 在法庭辩论过程中发现了新的事实，认为有必要进行调查的，审判长可以宣布暂停辩论，恢复法庭调查。
- 6. 法庭辩论的目的是说服法官，而非辩论者个人单纯地展现自己的才华和争强斗胜。
- 7. 附带民事诉讼部分的法庭辩论应当在刑事诉讼部分的辩论结束后进行。

用户角色: 公诉人

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

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

      const record: LearningRecordEntry = {
        pageName: '法庭辩论',
        conversations: messages,
        summary,
        evaluation,
        suggestion,
        score,
        createdAt: Date.now(),
      };
      setContinueRecord(record);
      addLearningRecord(record);
    } catch {
      setContinueRecord({
        pageName: '法庭辩论',
        conversations: messages,
        summary: '生成总结时出错',
        evaluation: '无法生成评价',
        suggestion: '请重试',
        createdAt: Date.now(),
      });
    } finally {
      setContinueStream('');
      setContinueLoading(false);
    }
  };

  if (!selectedCase) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const currentStage = DEBATE_STAGES[currentStageIdx];

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="法庭辩论"
        onSkip={() => { if (abortRef.current) abortRef.current.abort(); interruptTts(); advanceLifecycleForPage('/student/final-statement'); router.push('/student/final-statement'); }}
        onContinue={handleContinue}
        canContinue={messages.length > 0}
        continueTooltip="请先参与法庭辩论"
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
          {/* Mode switch button */}
          <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/30 shrink-0">
            <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">当前环节: {currentStage?.label}</span>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSkipAll}
                className="text-xs h-7 text-muted-foreground hover:text-foreground"
              >
                全部跳过
              </Button>
              <Button
                variant={voiceMode ? "default" : "outline"}
                size="sm"
                onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }}
                className="text-xs h-7"
              >
                {voiceMode ? '切换到文字模式' : '切换到语音模式'}
              </Button>
            </div>
          </div>

          {voiceMode ? (
            <div className="flex-1 relative overflow-hidden min-h-0">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: 'url(/characters/prosecutor.png)', transition: 'opacity 0.5s' }}
              />
              {(isStreaming || ttsSpeaker) && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                  <div className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground animate-pulse" />
                    <span className="text-base font-semibold">
                      {streamingSpeaker || ttsSpeaker || currentStage?.speaker} 正在发言
                    </span>
                  </div>
                </div>
              )}
              {!isStreaming && !ttsSpeaker && currentStage?.speaker && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                  <div className="px-4 py-1.5 rounded-full bg-card/70 backdrop-blur shadow text-sm text-muted-foreground">
                    {currentStage.speaker}
                  </div>
                </div>
              )}
              {lastAiBubble && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 w-[420px] max-w-[90%]">
                  <div className="relative bg-card/95 backdrop-blur rounded-lg shadow-2xl border-2 border-primary/40 p-4">
                    <button
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-muted-foreground text-background flex items-center justify-center shadow-md hover:bg-muted-foreground/80 z-10"
                      onClick={() => setLastAiBubble(null)}
                    >
                      <X className="w-4 h-4" />
                    </button>
                    <div className="text-xs font-semibold text-primary mb-1.5">{lastAiBubble.speaker}</div>
                    <div className="text-sm text-foreground prose prose-sm max-w-none prose-headings:text-sm prose-headings:font-semibold prose-p:my-1 prose-li:my-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{lastAiBubble.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              )}
              {currentStage?.type === 'interactive' && !isStreaming && (
                <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
                  <button
                    className={`relative w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all select-none ${
                      isRecording ? 'bg-destructive scale-110' : 'bg-primary hover:bg-primary/90'
                    }`}
                    aria-label="按住说话"
                    {...pressHandlers}
                  >
                    {isRecording ? <Square className="w-7 h-7 text-white" /> : <Mic className="w-7 h-7 text-primary-foreground" />}
                    {isRecording && (
                      <span className="absolute inset-0 rounded-full border-4 border-destructive/40 animate-ping" />
                    )}
                  </button>
                  <div className="text-sm font-medium text-primary-foreground bg-primary/80 backdrop-blur rounded-full px-4 py-1">
                    {isRecording ? '正在聆听…' : '长按说话'}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 relative overflow-hidden min-h-0">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: 'url(/characters/prosecutor.png)', opacity: 0.15, transition: 'opacity 0.5s' }}
              />
              <div ref={scrollRef} className="relative z-10 h-full overflow-y-auto scroll-thin p-4 space-y-2">
                {messages.length === 0 && !isStreaming && (
                  <div className="text-center text-muted-foreground py-8 text-sm">
                    法庭辩论即将开始...
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground">
                          <div className="font-semibold mb-1">{msg.speaker}</div>
                          <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown></div>
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
                      <div className="text-xs font-semibold mb-0.5 text-primary">
                        {streamingSpeaker || currentStage?.speaker}
                      </div>
                      <div className="rounded-lg px-3 py-2 text-sm bg-muted">
                        {hasVisibleStream(streamingText) ? (
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown>
                            <span className="typewriter-cursor" />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                            <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                            <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                            <span>{(streamingSpeaker || currentStage?.speaker || 'AI').trim()}正在思考…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="border-t p-3 space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={handleNextStage} disabled={isStreaming}>
                <SkipForward className="h-3.5 w-3.5 mr-1" />
                下一环节
              </Button>
            </div>

            {currentStage?.type === 'interactive' && (
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={currentStage.id === 'prosecutor_opinion' ? '发表公诉意见...' : '进行自由辩论...'}
                  className="resize-none text-sm min-h-[50px] max-h-[80px]"
                  disabled={isStreaming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button onClick={handleSendMessage} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0" aria-label="发送" title="发送（Enter）">
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {currentStage?.type === 'ai' && isStreaming && (
              <div className="text-center text-xs text-muted-foreground py-2">{currentStage.label}中...</div>
            )}
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={34} minSize={20}>
            <div className="overflow-hidden h-full">
              <CaseFileViewer sections={caseFileSections} title="卷宗" highlightConfig={highlightConfig} currentRole={selectedRole || undefined} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ContinueModal
        open={showContinueModal}
        onClose={() => {
          setShowContinueModal(false);
          if (continueRecord) router.push('/student/final-statement');
        }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />
    </div>
  );
}
