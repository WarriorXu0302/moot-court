'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePressTalk } from '@/hooks/use-press-talk';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/lib/store';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { DELIBERATION_KNOWLEDGE, COURT_LANGUAGE_KNOWLEDGE } from '@/lib/knowledge';
import { Send, Loader2, FileCheck, Mic, Square, SkipForward, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { createTtsSentenceFeeder, interruptTts, setTtsSpeakerCallback, waitForTtsQueueDrain } from '@/lib/audio';
import { replyFormatInstruction } from '@/lib/response-style';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { LifecycleBar } from '@/components/lifecycle-bar';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming, stripLifecycleTag, hasVisibleStream } from '@/lib/lifecycle-utils';
import { parseScoringStandards, getStageStandards, stageStandardsToPrompt } from '@/lib/scoring';
import { extractScore } from '@/lib/writing-outline';
import { StageStandardsViewer } from '@/components/stage-standards-viewer';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';

export default function JudgeDeliberationPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '评议讨论' });

  const { selectedCase, addLearningRecord, setDocument, user, hydrated, learningRecords, selectedRole, documents } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('评议讨论', messages);
  const [input, setInput] = useState('');
  const [verdictDraft, setVerdictDraft] = useState('');
  const [verdictEvaluation, setVerdictEvaluation] = useState('');
  const [verdictScore, setVerdictScore] = useState<number | undefined>(undefined);
  const [evaluatingVerdict, setEvaluatingVerdict] = useState(false);
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
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [ttsSpeaker, setTtsSpeaker] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);
  const speakerRotationIdx = useRef(0);
  const isMobile = useIsMobile();

  // 合议庭评议：仅陪审员甲、陪审员乙两名AI角色发言，学生扮演审判长
  const DELIBERATION_SPEAKERS = ['陪审员甲', '陪审员乙'];

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

  // Auto-start with first AI judge speaking
  useEffect(() => {
    if (!autoStartedRef.current && selectedCase) {
      autoStartedRef.current = true;
      speakerRotationIdx.current = 0;
      setTimeout(() => streamAIResponse('请承办法官首先发表对案件事实认定、证据是否确实充分以及适用法律的意见', DELIBERATION_SPEAKERS[0], true), 500);
    }
  }, [selectedCase]);

  const contextData = `案件基本资料:\n${selectedCase?.case || ''}\n\n诉讼文书卷:\n${selectedCase?.plead || ''}\n\n询问笔录:\n${selectedCase?.record || ''}\n\n证据材料:\n${selectedCase?.evidence || ''}\n\n相关法条和司法解释:\n${selectedCase?.law || ''}\n\n刑事起诉书:\n${selectedCase?.indictment || ''}\n\n公诉意见书:\n${selectedCase?.prosecution || ''}\n\n辩护词:\n${selectedCase?.defense || ''}\n\n庭审提纲:\n${documents.plan || selectedCase?.plan || ''}\n\n角色资料:\n${selectedCase?.person || ''}`;

  const streamAIResponse = useCallback(async (prompt: string, speaker: string, playTts = true) => {
    setIsStreaming(true);
    setStreamingText('');
    setStreamingSpeaker(speaker);

    const isJudgeContent = prompt.startsWith('审判长发言:');
    const isVerdictSubmit = prompt.startsWith('审判长提交刑事判决书:');
    const judgeContent = isJudgeContent ? prompt.replace('审判长发言: ', '') : isVerdictSubmit ? prompt.replace('审判长提交刑事判决书: ', '') : '';

    const systemPrompt = `你正在模拟合议庭评议讨论。你当前扮演的角色是"${speaker}"。

${isJudgeContent ? `审判长（用户）刚刚发言："${judgeContent}"，请你以${speaker}的身份回应。` : isVerdictSubmit ? `审判长（用户）提交了刑事判决书供评议讨论："${judgeContent}"，请你以${speaker}的身份对判决书内容发表意见。` : '请根据评议的注意事项来推演评议进展，你代表当前角色发言。'}

你是合议庭成员，请根据评议注意事项进行讨论：
- 评议内容包括：确定被告人是否有罪，构成何罪，应否处以刑罚，有无从重、从轻、减轻或者免除处罚的情节
- 你应当认真负责，充分陈述意见，独立行使表决权
- 同意他人意见的，也应当提出事实根据和法律依据，进行分析论证

请根据你所掌握的全部资料来讨论。

请注意：
- 你的回复要符合角色身份，使用口语化表达，像真实说话一样自然
- 每次回复不超过80字
- 不要重复之前已经说过的话
- 不要使用括号描述神情、表情、动作等
- 严禁代替其他角色发言，只扮演"${speaker}"这一个角色

以下是评议的注意事项:
${DELIBERATION_KNOWLEDGE}

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
      const ttsFeeder = voiceModeRef.current && playTts ? createTtsSentenceFeeder(speaker, 'judge-deliberation-user') : null;
      const streamThrottle = createThrottledStreamSetter(setStreamingText);
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: systemPrompt + replyFormatInstruction(voiceModeRef.current) },
            { role: 'user', content: contextData + '\n\n已有对话:\n' + messages.map(m => `${m.speaker}: ${m.content}`).join('\n') + '\n\n当前: ' + prompt },
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

      // After a judge speaks during auto-sequence, trigger next judge in rotation
      const speakerIdx = DELIBERATION_SPEAKERS.indexOf(speaker);
      if (speakerIdx >= 0 && speakerIdx < DELIBERATION_SPEAKERS.length - 1 && messages.length <= speakerIdx) {
        if (voiceModeRef.current) await waitForTtsQueueDrain(8);
        const nextIdx = speakerIdx + 1;
        speakerRotationIdx.current = nextIdx;
        setTimeout(() => streamAIResponse('请审判员发表对案件的意见', DELIBERATION_SPEAKERS[nextIdx], true), 500);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `错误: ${err.message}`, timestamp: Date.now(), speaker }]);
      }
    } finally {
      clearTimeout(timeoutId);
      setIsStreaming(false); setStreamingText(''); setStreamingSpeaker(''); abortRef.current = null;
    }
  }, [contextData, messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isStreaming) return;
    interruptTts();
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: input.trim(), timestamp: Date.now(), speaker: '审判长' };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    // AI judges respond — rotate to next speaker
    const lastAiSpeaker = [...messages].reverse().find(m => m.role === 'assistant')?.speaker;
    const lastIdx = lastAiSpeaker ? DELIBERATION_SPEAKERS.indexOf(lastAiSpeaker) : -1;
    const nextIdx = (lastIdx + 1) % DELIBERATION_SPEAKERS.length;
    speakerRotationIdx.current = nextIdx;
    await streamAIResponse(`审判长发言: ${input.trim()}`, DELIBERATION_SPEAKERS[nextIdx], true);
  };

  const handleSubmitVerdict = async () => {
    if (!verdictDraft.trim() || isStreaming) return;
    interruptTts();
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: `[提交刑事判决书]\n${verdictDraft.trim()}`, timestamp: Date.now(), speaker: '审判长' };
    setMessages((prev) => [...prev, userMsg]);

    // 合议庭评议：仅陪审员甲、陪审员乙（加上学生扮演的审判长，共三人）发言
    await streamAIResponse(`审判长提交刑事判决书: ${verdictDraft.trim()}`, DELIBERATION_SPEAKERS[0], true);
    if (voiceModeRef.current) await waitForTtsQueueDrain(8);
    setTimeout(async () => {
      await streamAIResponse(`审判长提交刑事判决书: ${verdictDraft.trim()}`, DELIBERATION_SPEAKERS[1], true);
      if (voiceModeRef.current) await waitForTtsQueueDrain(8);
      // 判决书AI评价（法学教授视角，注入本环节评分标准）
      await streamVerdictEvaluation();
    }, 500);
  };

  /** 判决书AI评价：以法学教授身份按评分标准评价判决书并打分 */
  const streamVerdictEvaluation = async () => {
    setEvaluatingVerdict(true);
    const standardsText = stageStandardsToPrompt(
      getStageStandards(parseScoringStandards(selectedCase?.scoringStandards), 'judge-deliberation'),
    );
    const prompt = `你是一位法学教授，请评价学生在模拟法庭训练中撰写的刑事判决书。

${standardsText}

## 案件资料
案件名称：${selectedCase?.name ?? ''}
${(selectedCase?.profile ?? '').slice(0, 1200)}

## 学生撰写的判决书
${verdictDraft.trim()}

## 评价要求
1. 使用markdown格式输出，先给出总分（0-100的整数，格式为"**得分：XX分**"）
2. 从判决书结构完整性（首部/事实/证据/理由/量刑/尾部）、事实认定与证据分析、法律适用、量刑说理、语言规范性等维度逐项点评
3. 指出判决书的优点与不足，给出具体修改建议
4. 评价应结合本案具体案情，避免空泛套话`;

    const evalMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      speaker: 'AI评价',
    };
    setMessages((prev) => [...prev, evalMsg]);
    setIsStreaming(true);

    try {
      const res = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: '你是一位法学教授，负责评价模拟法庭训练中学生撰写的法律文书。请使用markdown格式输出评价，语言专业严谨。' },
            { role: 'user', content: prompt },
          ],
          temperature: 0.5,
          caching: true,
        }),
      });
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';
      setMessages((prev) => prev.map((m) => (m.id === evalMsg.id ? { ...m, content: '' } : m)));
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;
            try {
              const parsed = JSON.parse(data) as { content?: string };
              if (parsed.content) {
                fullText += parsed.content;
                const display = stripLifecycleForStreaming(fullText);
                setMessages((prev) => prev.map((m) => (m.id === evalMsg.id ? { ...m, content: display } : m)));
              }
            } catch {
              // 忽略不完整chunk
            }
          }
        }
      }
      const finalText = parseLifecycleFromAIResponse(fullText);
      setVerdictEvaluation(finalText);
      const score = extractScore(finalText);
      setVerdictScore(score);
      setMessages((prev) => prev.map((m) => (m.id === evalMsg.id ? { ...m, content: finalText } : m)));
      // 持久化到 localStorage，供学情记录与断点恢复
      try {
        localStorage.setItem(
          `court-verdict-eval-${selectedCase?.id ?? ''}`,
          JSON.stringify({ evaluation: finalText, score, createdAt: Date.now() }),
        );
      } catch {
        // 存储满时忽略
      }
    } catch {
      setMessages((prev) => prev.map((m) => (m.id === evalMsg.id ? { ...m, content: '判决书评价生成失败，请重新提交。' } : m)));
    } finally {
      setIsStreaming(false);
      setEvaluatingVerdict(false);
    }
  };

  const handleNextSpeaker = () => {
    if (isStreaming) return;
    interruptTts();
    const lastAiSpeaker = [...messages].reverse().find(m => m.role === 'assistant')?.speaker;
    const lastIdx = lastAiSpeaker ? DELIBERATION_SPEAKERS.indexOf(lastAiSpeaker) : -1;
    const nextIdx = (lastIdx + 1) % DELIBERATION_SPEAKERS.length;
    speakerRotationIdx.current = nextIdx;
    streamAIResponse('请继续发表评议意见', DELIBERATION_SPEAKERS[nextIdx], true);
  };


  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    // Save the verdict draft as finalJudge
    const finalVerdict = verdictDraft.trim();
    setDocument('finalJudge', finalVerdict);

    const allRecords = learningRecords.map(r => `${r.pageName}: ${r.summary}`).join('\n');
    const summaryPrompt = `请根据以下评议讨论的学习过程，进行概括、评价和训练建议。特别评价审判长的刑事判决书。

案件资料:
${contextData}

## 评议的注意事项
${DELIBERATION_KNOWLEDGE}

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

审判长提交的刑事判决书:
${verdictDraft || '审判长未提交刑事判决书'}

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
      const record: LearningRecordEntry = { pageName: '评议讨论', conversations: messages, summary, evaluation, suggestion, score, createdAt: Date.now(), verdictEvaluation: verdictEvaluation ? { content: verdictEvaluation, score: verdictScore ?? null } : undefined };
      setContinueRecord(record); addLearningRecord(record);
    } catch {
      setContinueRecord({ pageName: '评议讨论', conversations: messages, summary: '生成总结时出错', evaluation: '无法生成评价', suggestion: '请重试', createdAt: Date.now(), verdictEvaluation: verdictEvaluation ? { content: verdictEvaluation, score: verdictScore ?? null } : undefined });
    } finally {
      setContinueStream('');
      setContinueLoading(false);
    }
  };

  if (!selectedCase) {
    return (<div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>);
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="评议讨论"
        onSkip={() => {
          if (abortRef.current) abortRef.current.abort();
          interruptTts();
          advanceLifecycleForPage('/student/judge-verdict'); router.push('/student/judge-verdict');
        }}
        onContinue={handleContinue}
        canContinue={messages.length > 0}
        continueTooltip="请先参与评议讨论"
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          <ResizablePanel defaultSize={52} minSize={28}>
            <div className="flex flex-col overflow-hidden h-full border-r">
          <div className="panel-head px-3 py-2 shrink-0 flex items-center gap-2">
            <h3 className="font-semibold text-sm">评议讨论</h3>
            <div className="flex-1" />
            <Button variant={voiceMode ? 'default' : 'outline'} size="sm" onClick={() => { setVoiceMode(!voiceMode); interruptTts(); }} className="text-xs h-7">{voiceMode ? '切换文字模式' : '切换语音模式'}</Button>
            <Button variant="outline" size="sm" onClick={handleNextSpeaker} disabled={isStreaming}><SkipForward className="h-3.5 w-3.5 mr-1" />下一位发言</Button>
          </div>
          {voiceMode ? (
            <div
              className="relative flex-1 overflow-hidden bg-cover bg-center"
              style={{ backgroundImage: 'url(/bg-deliberation.jpeg)' }}
            >
              {(isStreaming || ttsSpeaker) && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                  <div className="flex items-center gap-2 px-6 py-2.5 rounded-full bg-primary text-primary-foreground shadow-lg">
                    <span className="w-2.5 h-2.5 rounded-full bg-primary-foreground animate-pulse" />
                    <span className="text-base font-semibold">
                      {streamingSpeaker || ttsSpeaker} 正在发言
                    </span>
                  </div>
                </div>
              )}
              {!isStreaming && !ttsSpeaker && (
                <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20">
                  <div className="px-4 py-1.5 rounded-full bg-card/70 backdrop-blur shadow text-sm text-muted-foreground">
                    等待发言
                  </div>
                </div>
              )}
              {!isStreaming && !ttsSpeaker && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
                  <div className="px-5 py-2.5 rounded-full bg-primary/90 backdrop-blur shadow-lg text-sm font-medium text-center text-primary-foreground">
                    请作为审判长参与评议讨论
                  </div>
                </div>
              )}
            </div>
          ) : (
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 min-h-0">
            {messages.length === 0 && !isStreaming && (
              <div className="text-center text-muted-foreground py-8 text-sm">评议讨论即将开始...</div>
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
                  <div className="text-xs font-semibold mb-0.5 text-primary">{streamingSpeaker}</div>
                  <div className="rounded-lg px-3 py-2 text-sm bg-muted">
                    {hasVisibleStream(streamingText) ? (
                      <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown><span className="typewriter-cursor" /></div>
                    ) : (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" /><span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" /><span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" /><span>{(streamingSpeaker || ttsSpeaker || 'AI').trim()}正在思考…</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Input */}
          <div className="border-t p-3 space-y-2 shrink-0">
            {!voiceMode ? (
              <div className="flex gap-2">
                <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="作为审判长参与讨论..." className="resize-none text-sm min-h-[40px] max-h-[80px]" disabled={isStreaming} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }} />
                <Button onClick={handleSendMessage} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0" aria-label="发送" title="发送（Enter）">
                  {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <div className="flex justify-center gap-3">
                <Button variant={isRecording ? 'destructive' : 'default'} size="sm" className="touch-none select-none" disabled={!isRecording && (isStreaming || asrLoading)} aria-label="按住说话" {...pressHandlers}>{isRecording ? <><Square className="h-4 w-4 mr-1" />松开发送</> : <>{asrLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mic className="h-4 w-4 mr-1" />}{asrLoading ? '识别中...' : '按住说话'}</>}</Button>
              </div>
            )}
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={26} minSize={18}>
            <div className="overflow-hidden flex flex-col h-full border-r">
          <div className="panel-head px-3 py-2 shrink-0">
            <h3 className="font-semibold text-sm">刑事判决书</h3>
          </div>
          <StageStandardsViewer value={selectedCase?.scoringStandards ?? null} stageKey="judge-deliberation" />
          <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-3 flex flex-col">
            <div className="text-xs font-semibold">审判长刑事判决书:</div>
            <Textarea
              value={verdictDraft}
              onChange={(e) => setVerdictDraft(e.target.value)}
              placeholder="在此撰写刑事判决书..."
              className="resize-none text-xs flex-1 min-h-[200px]"
            />
            <Button
              onClick={handleSubmitVerdict}
              disabled={!verdictDraft.trim() || isStreaming || evaluatingVerdict}
              size="sm"
              className="w-full"
            >
              {evaluatingVerdict ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <FileCheck className="h-3.5 w-3.5 mr-1" />}
              {evaluatingVerdict ? 'AI评价生成中...' : '提交判决书供评议'}
            </Button>
          </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={22} minSize={14}>
            <div className="overflow-hidden flex flex-col h-full">
          <div className="panel-head px-3 py-2 shrink-0 flex items-center justify-between">
            <span className="font-semibold text-sm flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              判决书评价
            </span>
            {verdictScore !== null && (
              <span className="text-xs font-bold text-primary shrink-0">{verdictScore} 分</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            {evaluatingVerdict && !verdictEvaluation && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                AI 正在评价判决书，讨论可继续进行...
              </div>
            )}
            {verdictEvaluation ? (
              <div className="text-xs leading-relaxed prose prose-sm max-w-none [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>
                  {stripLifecycleTag(verdictEvaluation)}
                </ReactMarkdown>
              </div>
            ) : !evaluatingVerdict && (
              <div className="text-xs text-muted-foreground leading-relaxed border border-dashed rounded-md p-3">
                提交判决书后，AI 将在本栏生成分维度评价；左侧评议讨论可并行进行，互不干扰。
              </div>
            )}
          </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ContinueModal
        open={showContinueModal}
        onClose={() => { setShowContinueModal(false); if (continueRecord) router.push('/student/judge-verdict'); }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />
    </div>
  );
}
