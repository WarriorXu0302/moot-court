'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePressTalk } from '@/hooks/use-press-talk';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { CaseFileViewer, type CaseFileSection } from '@/components/case-file-viewer';
import { FloatingAssistant } from '@/components/floating-assistant';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/lib/store';
import { parseHighlights } from '@/lib/highlights';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { Send, Loader2, Mic, Square, Volume2, VolumeX } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback } from '@/lib/audio';
import { replyFormatInstruction } from '@/lib/response-style';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { LifecycleBar } from '@/components/lifecycle-bar';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming, hasVisibleStream } from '@/lib/lifecycle-utils';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

export default function SentencingNegotiationPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '量刑协商' });

  const { selectedCase, selectedRole, addLearningRecord, user, hydrated, learningRecords, setDocument } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('量刑协商模拟', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [voiceMode, setVoiceMode] = useState(false);
  const voiceModeRef = useRef(voiceMode);
  useEffect(() => {
    voiceModeRef.current = voiceMode;
  }, [voiceMode]);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [regenerating, setRegenerating] = useState(false);
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();


  const isDefender = selectedRole === 'defender';
  const userRoleLabel = isDefender ? '辩护人' : '公诉人';
  const opponentRoleLabel = isDefender ? '公诉人' : '辩护人';

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

  const caseData = selectedCase;
  const caseFileSections: CaseFileSection[] = [
    { label: '诉讼文书卷', items: parseJsonArray(caseData?.plead) },
    { label: '询问笔录', items: parseJsonArray(caseData?.record) },
    { label: '证据材料', items: parseJsonArray(caseData?.evidence) },
  ];
  const highlightConfig = parseHighlights(caseData?.highlights);

  const contextData = `案件基本资料:\n${caseData?.case || ''}\n\n诉讼文书卷:\n${caseData?.plead || ''}\n\n询问笔录:\n${caseData?.record || ''}\n\n证据材料:\n${caseData?.evidence || ''}\n\n相关法条和司法解释:\n${caseData?.law || ''}\n\n刑事起诉书:\n${caseData?.indictment || ''}\n\n公诉意见书:\n${caseData?.prosecution || ''}\n\n辩护词:\n${caseData?.defense || ''}`;


  // 长按说话（统一 hook：指针/触摸适配 + 竞态安全）
  const { isRecording, asrLoading, pressHandlers } = usePressTalk({
    uid: user?.id || 'guest',
    onText: (text) => {
      setInput(text);
      setTimeout(() => sendMessage(), 0);
    },
  });

  const sendMessage = useCallback(async (messageContent?: string) => {
    const content = messageContent || input.trim();
    if (!content || isStreaming) return;

    interruptTts();

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      speaker: userRoleLabel,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const systemPrompt = `你是模拟法庭量刑协商环节中的${opponentRoleLabel}角色，正在与${userRoleLabel}进行量刑协商。

${contextData}

量刑协商要点：
- 这是一个博弈和权衡的过程，你需要基于案件事实和法律规定提出合理的量刑建议
- 作为${opponentRoleLabel}，你需要维护己方立场，但也要体现法律职业理性
- 如果${userRoleLabel}提出的方案明显偏离案件事实或法律规定，你应指出问题并提示风险
- 协商内容应涉及：罪名认定、量刑情节（法定/酌定）、量刑幅度、认罪认罚从宽幅度等
- 请使用markdown格式输出，语气专业但可以适度展示谈判策略
- 你的回复要符合角色身份，使用口语化表达，像真实说话一样自然
- 每次回复不超过200字

可行性评估与风险提示：如果${userRoleLabel}提出明显偏离案件事实或法律规定的假设，你不必直接顺着对方的思路给答案，而应指出差异并提示风险。
案件生命周期：系统已在案例详情页自动生成了初始的生命周期时间轴（从立案开始的各关键节点）。在后续对话中，你需要智能判断是否需要更新生命周期：
- 当对话涉及新的诉讼阶段或法律程序节点时，在回复末尾输出已完成的阶段节点（用<LIFECYCLE>标签包裹JSON）
- 当对话只是讨论已有阶段内的细节（如证据分析、法条解释）时，不需要重复输出生命周期
- 输出格式：<LIFECYCLE>{"nodes":[{"stage":"阶段名","legalActions":"详细描述该阶段的具体法律行为，包括主体、程序步骤和关键环节（不少于30字）","documents":"列出形成的法律文书并说明其内容和作用（不少于20字）","legalBasis":"写明法律条文全称及条文要旨"},...]}</LIFECYCLE>
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段
- 只输出已完成的阶段节点（学生已经经历过的阶段），不要输出未来未到达的阶段
- 输出时应包含之前所有已完成节点加上当前新完成的节点，不要包含未来阶段
- 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述`;

    const llmMessages = [
      { role: 'system' as const, content: systemPrompt + replyFormatInstruction(voiceModeRef.current) },
      ...messages.map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content },
    ];

    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    try {
      const ttsFeeder = voiceModeRef.current ? createTtsSentenceFeeder(opponentRoleLabel, 'sentencing-negotiation-user') : null;
      const streamThrottle = createThrottledStreamSetter(setStreamingText);
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: llmMessages, temperature: 0.7, caching: true }),
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

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: parseLifecycleFromAIResponse(fullText),
        speaker: opponentRoleLabel,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingText('');

      // TTS playback
      if (ttsFeeder) ttsFeeder.flush(fullText);

      // Auto-trigger document regeneration after every 3+ messages
      if (messages.length >= 3) {
        handleRegenerateDocs();
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `错误: ${err.message}`,
          speaker: opponentRoleLabel,
          timestamp: Date.now(),
        }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, contextData, opponentRoleLabel, userRoleLabel]);

  // Voice recording (MediaRecorder → /api/asr)

  const handleSkip = () => {
    abortRef.current?.abort();
    interruptTts();
    advanceLifecycleForPage('/student/sentencing-negotiation');
    if (isDefender) {
      router.push('/student/defense-writing');
    } else {
      router.push('/student/indictment-writing');
    }
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    const summaryPrompt = `请根据以下量刑协商模拟的学习过程，进行概括、评价和训练建议。

案件基本资料:\n${caseData?.case || ''}
刑事起诉书:\n${caseData?.indictment || ''}
辩护词:\n${caseData?.defense || ''}

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

请从以下维度进行详细评价（每个维度需引用学生具体发言内容）：
1. 学习过程概括：学生在量刑协商中展现了哪些策略和思路（引用具体对话）
2. 协商能力评价：学生是否能够基于案件事实和法律规定进行有效博弈，是否提出了合理的量刑建议
3. 法律适用能力：学生是否正确运用了量刑情节、认罪认罚从宽等法律制度
4. 风险提示能力：学生是否注意到协商中对方提出的偏离事实或法律的观点并予以纠正

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;

    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位法学教授，负责对模拟法庭量刑协商训练进行详细评价。评价要结合具体对话内容，指出优点和不足。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      let summary = data.summary || '', evaluation = data.evaluation, suggestion = data.suggestion, score: number | undefined = data.score;
      if (score === undefined && evaluation) { try { const { extractScore } = await import('@/lib/writing-outline'); score = extractScore(evaluation); } catch { /* skip */ } }

      const record: LearningRecordEntry = {
        pageName: '量刑协商模拟',
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
        pageName: '量刑协商模拟',
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

  const handleRegenerateDocs = async () => {
    if (!selectedCase) return;
    setRegenerating(true);
    interruptTts();

    const negotiationSummary = messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n');

    const prompt = `根据以下量刑协商的结果，重新生成法律文书。请保持原文书的基本结构，但根据协商中达成的一致意见调整相关内容。

案件基本资料:\n${caseData?.case || ''}
诉讼文书卷:\n${caseData?.plead || ''}
证据材料:\n${caseData?.evidence || ''}
相关法条:\n${caseData?.law || ''}

原刑事起诉书:\n${caseData?.indictment || ''}
原公诉意见书:\n${caseData?.prosecution || ''}
原辩护词:\n${caseData?.defense || ''}

量刑协商记录:\n${negotiationSummary}

请输出JSON格式:
{
  "indictment": "重新生成的刑事起诉书",
  "prosecution": "重新生成的公诉意见书",
  "defense": "重新生成的辩护词"
}`;

    try {
      const res = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: '你是一位法律文书专家。根据量刑协商结果重新生成法律文书。请输出JSON格式: {"indictment": "...", "prosecution": "...", "defense": "..."}' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.5,
          caching: false,
        }),
      });

      const reader = res.body?.getReader();
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
              if (parsed.content) fullText += parsed.content;
            } catch { /* skip */ }
          }
        }
      }

      try {
        const match = fullText.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          if (parsed.indictment) setDocument('indictment', parsed.indictment);
          if (parsed.prosecution) setDocument('prosecution', parsed.prosecution);
          if (parsed.defense) setDocument('defense', parsed.defense);
        }
      } catch { /* parse error */ }
    } catch { /* error */ }
    setRegenerating(false);
  };

  if (!caseData) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="量刑协商模拟"
        onSkip={handleSkip}
        onContinue={handleContinue}
        canContinue={true}
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
            <>
              {/* Voice mode: background image with speaker indicator */}
              <div className="relative flex-1 overflow-hidden bg-black">
                {/* Blurred background fill — eliminates dark bars */}
                <div
                  className="absolute inset-0 bg-cover bg-center scale-110"
                  style={{ 
                    backgroundImage: `url(${isDefender ? '/characters/defender-negotiation.jpg' : '/characters/prosecutor-negotiation.jpg'})`,
                    filter: 'blur(16px) brightness(0.7)',
                  }}
                />
                {/* Sharp image centered — full scene visible */}
                <div
                  className="absolute inset-0 bg-contain bg-center bg-no-repeat"
                  style={{ backgroundImage: `url(${isDefender ? '/characters/defender-negotiation.jpg' : '/characters/prosecutor-negotiation.jpg'})` }}
                />
                {/* Speaker indicator badge at top */}
                {(isStreaming || ttsSpeaker) && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                    <div className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg">
                      <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground animate-pulse" />
                      <span className="text-base font-semibold">
                        {(isStreaming ? opponentRoleLabel : ttsSpeaker) || opponentRoleLabel} 正在发言
                      </span>
                    </div>
                  </div>
                )}
                {/* Opponent name watermark when idle */}
                {!isStreaming && !ttsSpeaker && (
                  <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                    <div className="px-4 py-1.5 rounded-full bg-card/70 backdrop-blur shadow text-sm text-muted-foreground">
                      {opponentRoleLabel}
                    </div>
                  </div>
                )}
                {/* Interactive prompt in voice mode */}
                {!isStreaming && (
                  <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20">
                    <div className="px-5 py-2.5 rounded-full bg-primary/90 backdrop-blur shadow-lg text-sm font-medium text-center text-primary-foreground">
                      请作为{userRoleLabel}发言
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Text mode: pure text chat */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 min-h-0">
                {messages.length === 0 && !isStreaming && (
                  <div className="text-center text-muted-foreground py-8 text-sm">
                    量刑协商已开始。作为{userRoleLabel}，请与{opponentRoleLabel}就量刑问题进行协商。
                  </div>
                )}
                {messages.map((msg) => (
                  <div key={msg.id}>
                    {msg.role === 'user' ? (
                      <div className="flex justify-end">
                        <div className="max-w-[85%] rounded-lg px-3 py-2 text-sm bg-primary text-primary-foreground">
                          <div className="font-semibold mb-1">{msg.speaker}</div>
                          <div className="markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown>
                          </div>
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
                        {opponentRoleLabel}
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
                            <span>{opponentRoleLabel}正在思考…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Mode switch + controls */}
          <div className="border-t p-3 space-y-2 shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">量刑协商: {userRoleLabel} vs {opponentRoleLabel}</span>
              {regenerating && (
                <span className="text-xs text-primary flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  文书更新中...
                </span>
              )}
              <Button
                variant={voiceMode ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }}
                className="text-xs h-7"
              >
                {voiceMode ? <Volume2 className="h-3 w-3 mr-1" /> : <VolumeX className="h-3 w-3 mr-1" />}
                {voiceMode ? '文字模式' : '语音模式'}
              </Button>
            </div>

            {!voiceMode && (
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={`作为${userRoleLabel}发言...`}
                  className="resize-none text-sm min-h-[50px] max-h-[80px]"
                  disabled={isStreaming}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <Button onClick={() => sendMessage()} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0">
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            )}

            {voiceMode && (
              <div className="flex items-center justify-center gap-3 py-2">
                <Button
                  variant={isRecording ? 'destructive' : 'default'}
                  size="lg"
                  disabled={isStreaming || asrLoading}
                  {...pressHandlers}
                  className="rounded-full h-14 w-14 p-0 select-none touch-none"
                >
                  {isRecording ? <Square className="h-5 w-5" /> : asrLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Mic className="h-6 w-6" />}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {asrLoading ? '识别中...' : isRecording ? '正在聆听…' : '长按说话'}
                </span>
              </div>
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
          if (continueRecord) {
            if (isDefender) {
              router.push('/student/defense-writing');
            } else {
              router.push('/student/indictment-writing');
            }
          }
        }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />

      <FloatingAssistant pageContext="量刑协商模拟，与对方角色进行量刑讨论" />
    </div>
  );
}
