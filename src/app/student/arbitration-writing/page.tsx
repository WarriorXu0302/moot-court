'use client';

/**
 * 仲裁文书写作页（?doc=claim 仲裁申请书 | answer 答辩状 | award 裁决书）
 *
 * 复用现有写作页的四栏骨架：对话讨论 | 文书编辑 | 评价 | 卷宗。
 * 见 docs/arbitration-design.md 第8节。文书类型差异全部配置化在 DOC_CONFIG。
 *
 * 约束（AGENTS.md）：useSearchParams 包在 Suspense 内；useStageDialogueLogger 用稳定 pageName；
 * 评价提示词注入本环节评分标准（stageStandardsToPrompt）；评价计数用 recordEvalProgress 持久化。
 */

import React, { Suspense, useState, useCallback, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Send, FileCheck, Save, Check, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { CaseFileViewer } from '@/components/case-file-viewer';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { SampleViewerDialog } from '@/components/sample-viewer-dialog';
import { StageStandardsViewer } from '@/components/stage-standards-viewer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { useAppStore } from '@/lib/store';
import { getRoleLabel } from '@/lib/case-type';
import { buildArbitrationContext, buildArbitrationFileSections, parseCaseItems } from '@/lib/arbitration-case-utils';
import { getArbitrationNextRoute, type ArbitrationDoc } from '@/lib/arbitration-route';
import { ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_DELIBERATION_KNOWLEDGE, ARB_OPENING_KNOWLEDGE } from '@/lib/arbitration-knowledge';
import {
  parseScoringStandards, getStageStandards, stageStandardsToPrompt,
  getEvalProgressMap, recordEvalProgress, canViewSample, DEFAULT_SAMPLE_UNLOCK, sampleLockedHint,
  type DocEvalProgress,
} from '@/lib/scoring';
import { extractScore } from '@/lib/writing-outline';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { createThrottledStreamSetter } from '@/lib/streaming-throttle';
import { stripLifecycleForStreaming } from '@/lib/lifecycle-utils';
import { advanceArbitrationLifecycle } from '@/lib/arbitration-study';
import type { ChatMessage, LearningRecordEntry, UserRole } from '@/lib/types';

interface DocConfig {
  title: string;
  /** 评分标准环节 key（对应 scoring 种子 stages[].key） */
  stageKey: string;
  /** 样例在 plead 文书卷中的标题关键词 */
  sampleKeyword: string;
  /** 文书结构要点（写入对话与评价提示词） */
  structure: string;
  evalPoints: string[];
  knowledge: string;
  who: string;
}

const DOC_CONFIG: Record<ArbitrationDoc, DocConfig> = {
  claim: {
    title: '仲裁申请书',
    stageKey: 'arb-claim-writing',
    sampleKeyword: '申请书',
    structure: '当事人基本情况 → 仲裁请求（具体、可执行、含金额与费用）→ 仲裁协议及管辖依据 → 事实与理由（请求权基础、事实经过、法律依据）→ 证据清单 → 此致/申请人/日期',
    evalPoints: ['当事人信息与代理权限是否完整准确', '仲裁请求是否具体明确、金额计算是否有依据', '仲裁协议与管辖依据是否充分，准据法论证是否到位', '事实陈述与证据对应是否清晰', '法律依据是否准确，是否存在编造条文或判例', '文书格式与语言是否规范'],
    knowledge: [ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE].join('\n\n'),
    who: '申请人代理人',
  },
  answer: {
    title: '答辩状（含反请求）',
    stageKey: 'arb-answer-writing',
    sampleKeyword: '答辩',
    structure: '答辩人基本情况 → 对仲裁请求的答辩意见 → 管辖权异议（如有）→ 事实抗辩 → 法律抗辩 → 反请求（如有）→ 证据清单 → 此致/答辩人/日期',
    evalPoints: ['是否针对申请人的每项仲裁请求逐一答辩', '管辖权异议是否抓住仲裁协议的存在、效力、范围、准据法', '事实抗辩与证据是否对应', '法律抗辩是否准确，是否存在编造条文或判例', '反请求（如有）是否有独立的请求权基础与金额依据', '文书格式与语言是否规范'],
    knowledge: [ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE].join('\n\n'),
    who: '被申请人代理人',
  },
  award: {
    title: '裁决书',
    stageKey: 'arb-award-writing',
    sampleKeyword: '裁决',
    structure: '当事人及代理人 → 仲裁程序概述 → 案件事实与各方主张 → 争议焦点 → 仲裁庭意见（管辖权 / 事实认定 / 法律适用）→ 裁决主文 → 仲裁费用承担 → 作出地点与日期 → 仲裁员签名',
    evalPoints: ['争议焦点归纳是否准确、完整', '管辖权问题是否先行说理', '事实认定是否基于证据，证明责任分配是否正确', '法律适用是否准确（仲裁协议准据法、实体准据法）', '裁决主文是否明确、可执行，与仲裁请求对应，无超裁漏裁', '仲裁费用承担是否有理由，裁决书格式是否规范'],
    knowledge: [ARB_DELIBERATION_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_OPENING_KNOWLEDGE].join('\n\n'),
    who: '首席仲裁员',
  },
};

function parseDoc(v: string | null): ArbitrationDoc {
  return v === 'answer' || v === 'award' ? v : 'claim';
}

function ArbitrationWritingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const doc = parseDoc(searchParams.get('doc'));
  const cfg = DOC_CONFIG[doc];
  const pageName = `${cfg.title}撰写`;

  const { selectedCase, addLearningRecord, setDocument, documents, user, hydrated, selectedRole } = useAppStore();
  const role: UserRole = selectedRole ?? 'defender';
  const roleLabel = getRoleLabel('arbitration', role);
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: pageName });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  useStageDialogueLogger(pageName, messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [evaluation, setEvaluation] = useState('');
  const [sideTab, setSideTab] = useState<'guide' | 'eval' | 'file'>('guide');
  const [evaluating, setEvaluating] = useState(false);
  // 最近一次「请 AI 评价」针对的正文与得分：环节总结若是同一份正文就沿用这个分，避免两次独立打分得出两个分数（实测 40 vs 56）
  const lastEvalRef = useRef<{ text: string; score: number | undefined } | null>(null);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [showSample, setShowSample] = useState(false);
  const [evalProgress, setEvalProgress] = useState<DocEvalProgress | undefined>(undefined);
  const [saved, setSaved] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const nextRoute = getArbitrationNextRoute(role, doc === 'award' ? 'award' : 'writing');

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
  }, [selectedCase, user, hydrated, router]);

  // 离开页面自动保存文书；载入已保存内容
  const editorRef = useRef(editorContent);
  editorRef.current = editorContent;
  useEffect(() => () => { if (editorRef.current.trim()) setDocument(doc, editorRef.current); }, [doc, setDocument]);
  useEffect(() => { const s = documents[doc]; if (s) setEditorContent(s); }, [documents, doc]);
  useEffect(() => { setEvalProgress(getEvalProgressMap(selectedCase?.id, user?.id)[doc]); }, [selectedCase?.id, user?.id, doc]);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages, streamingText]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const contextData = buildArbitrationContext(selectedCase, documents);
  const caseFileSections = buildArbitrationFileSections(selectedCase);

  // AI 样例：从案例文书卷中按关键词找（裁决书样例无预置，则无）
  const sampleText = parseCaseItems(selectedCase?.plead).find((i) => i.title.includes(cfg.sampleKeyword))?.book ?? '';

  /** 流式调用 LLM，返回完整文本；onText 收增量（已节流） */
  const streamLLM = useCallback(async (system: string, user_: string, onText: (t: string) => void, signal?: AbortSignal): Promise<string> => {
    const res = await fetch('/api/llm/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user_ }], temperature: 0.5, caching: true }),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No reader');
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
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
        try { const p = JSON.parse(data) as { content?: string }; if (p.content) { full += p.content; onText(full); } } catch { /* skip */ }
      }
    }
    return full;
  }, []);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    const userMsg: ChatMessage = { id: `msg-${Date.now()}`, role: 'user', content: text, timestamp: Date.now(), speaker: roleLabel };
    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');
    const controller = new AbortController();
    abortRef.current = controller;
    const throttle = createThrottledStreamSetter(setStreamingText);
    const system = `你是国际仲裁与国际民事诉讼法教授，正在指导学生（${roleLabel}）撰写${cfg.title}。

文书结构参考：${cfg.structure}

要求：
- 紧密结合本案资料回答，引用本案具体事实与证据名称
- 只给思路、框架与点评，不要替学生写出完整文书
- 涉及法条、条约、判例时：只引用你有把握的；不确定条文号或案号时直说"请以规则/法条原文核对"，严禁编造
- 提示学生对 AI 给出的任何法律依据都要自行核验

程序与实体知识参考：
${cfg.knowledge}`;
    try {
      const full = await streamLLM(
        system,
        `${contextData}\n\n学生当前文书草稿:\n${editorContent || '（尚未动笔）'}\n\n对话记录:\n${history.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}`,
        (t) => throttle.push(t),
        controller.signal,
      );
      setMessages((prev) => [...prev, { id: `msg-${Date.now()}-a`, role: 'assistant', content: full, timestamp: Date.now(), speaker: 'AI指导' }]);
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setMessages((prev) => [...prev, { id: `err-${Date.now()}`, role: 'assistant', content: `错误: ${e.message}`, timestamp: Date.now(), speaker: 'AI指导' }]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }
  };

  const handleEvaluate = async () => {
    if (!editorContent.trim()) return;
    setEvaluating(true);
    setEvaluation('');
    setSideTab('eval');
    const standardsText = stageStandardsToPrompt(getStageStandards(parseScoringStandards(selectedCase?.scoringStandards), cfg.stageKey));
    const prompt = `请根据以下案件资料，评价学生（${roleLabel}）撰写的${cfg.title}质量。

${contextData}

学生撰写的${cfg.title}:
${editorContent}

对话上下文:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

${standardsText ? standardsText + '\n\n' : ''}请从以下方面评价：
${cfg.evalPoints.map((p, i) => `${i + 1}. ${p}`).join('\n')}
${cfg.evalPoints.length + 1}. 改进建议

特别提示：逐一核对文书中引用的条文、条约、判例，凡无法从案件资料或公认法律中确认其真实性的，须明确指出"该引用待核验"，不得替学生背书。

请在评价的最开头给出具体得分，格式为"得分：XX"（0-100分整数），然后换行给出详细评价。
请使用 markdown：## 一级标题，### 二级标题，关键术语用 **加粗**，要点用 - 或 1. 列表，段落间空行。`;
    const throttle = createThrottledStreamSetter(setEvaluation);
    let full = '';
    try {
      full = await streamLLM('你是国际仲裁与国际民事诉讼法教授，负责评价模拟仲裁训练中学生的文书。请使用markdown格式输出评价。', prompt, (t) => throttle.push(t));
      setEvaluation(full);
    } catch {
      full = '评价生成失败，请重试。';
      setEvaluation(full);
    } finally {
      setEvaluating(false);
      const evalScore = extractScore(full);
      lastEvalRef.current = { text: editorContent, score: evalScore };
      setEvalProgress(recordEvalProgress(selectedCase?.id, user?.id, doc, evalScore));
    }
  };

  const handleSaveDoc = () => {
    setDocument(doc, editorContent);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);
    setDocument(doc, editorContent);
    const summaryPrompt = `请根据以下${cfg.title}撰写过程，进行概括、评价和训练建议。学生扮演${roleLabel}。

案件资料:
${contextData}

学生撰写的${cfg.title}:
${editorContent}
${lastEvalRef.current && lastEvalRef.current.text === editorContent && lastEvalRef.current.score !== undefined ? `\n该文书已按本环节评分标准评过分：${lastEvalRef.current.score} 分。【得分】请直接给出 ${lastEvalRef.current.score}，评价与建议应与该分数一致。\n` : ''}

对话记录:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;
    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位国际仲裁与国际民事诉讼法教授，负责对模拟仲裁训练的学习过程进行总结评价。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      const evaluated = lastEvalRef.current && lastEvalRef.current.text === editorContent ? lastEvalRef.current.score : undefined;
      const score = evaluated ?? (data.score !== undefined ? data.score : data.evaluation ? extractScore(data.evaluation) : undefined);
      const record: LearningRecordEntry = { pageName, conversations: messages, summary: data.summary || '', evaluation: data.evaluation, suggestion: data.suggestion, score, createdAt: Date.now() };
      setContinueRecord(record);
      addLearningRecord(record);
    } catch {
      setContinueRecord({ pageName, conversations: messages, summary: '生成总结时出错', evaluation: '无法生成评价', suggestion: '请重试', createdAt: Date.now() });
    } finally {
      setContinueStream('');
      setContinueLoading(false);
    }
  };

  const goNext = () => {
    abortRef.current?.abort();
    advanceArbitrationLifecycle(doc === 'claim' ? 'writing-claim' : doc === 'answer' ? 'writing-answer' : 'writing-award');
    router.push(nextRoute);
  };

  if (!selectedCase) {
    return <div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName={pageName}
        onSkip={goNext}
        onContinue={handleContinue}
        canContinue={editorContent.trim().length > 0}
        continueTooltip={`请先撰写${cfg.title}`}
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />

      {/* 版式：文书是主角，占左侧大部分宽度、像一张纸；写作指导 / 评价 / 卷宗收进右侧同一个面板的页签。
          原来四栏并排，编辑区只有三成宽，每行不到 30 个字。 */}
      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          <ResizablePanel defaultSize={62} minSize={40}>
            <div className="flex h-full flex-col overflow-hidden bg-muted/40">
              <div className="flex min-w-0 shrink-0 items-center gap-2 border-b bg-card px-4 py-2">
                <p className="w-0 min-w-0 flex-1 truncate text-xs text-muted-foreground" title={cfg.structure}>
                  建议结构：{cfg.structure}
                </p>
                <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline">{editorContent.replace(/\s/g, '').length} 字</span>
                <Button variant="ghost" size="sm" className="h-8" onClick={handleSaveDoc} disabled={!editorContent.trim()}>
                  {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}{saved ? '已保存' : '保存'}
                </Button>
                {sampleText && (
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => setShowSample(true)} title={canViewSample(evalProgress) ? '查看AI样例' : sampleLockedHint(evalProgress)}>
                    <Sparkles className="h-3.5 w-3.5" />AI 样例
                  </Button>
                )}
                <Button size="sm" className="h-8" onClick={handleEvaluate} disabled={evaluating || !editorContent.trim()}>
                  {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCheck className="h-3.5 w-3.5" />}请 AI 评价
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto scroll-thin px-4 py-6 lg:px-10">
                <div className="mx-auto flex min-h-full max-w-[46rem] flex-col rounded-sm border bg-card px-8 py-8 shadow-sm lg:px-14 lg:py-12">
                  <h2 className="mb-6 text-center font-display text-2xl font-semibold tracking-[0.3em] text-foreground">{cfg.title}</h2>
                  <textarea
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    aria-label={`${cfg.title}正文`}
                    className="docket-text min-h-[50vh] w-full flex-1 resize-none border-none bg-transparent outline-none placeholder:text-muted-foreground/60"
                    placeholder={`从这里开始撰写${cfg.title}。不确定怎么写，可以在右侧「写作指导」里问 AI。`}
                  />
                </div>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={38} minSize={24}>
            <div className="flex h-full flex-col overflow-hidden bg-card">
              <div role="tablist" aria-label="辅助面板" className="flex shrink-0 border-b px-2">
                {([['guide', '写作指导'], ['eval', '评价'], ['file', '卷宗']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={sideTab === key}
                    onClick={() => setSideTab(key)}
                    className={`relative px-3 py-2.5 text-sm transition-colors ${sideTab === key ? 'font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {label}
                    {key === 'eval' && evaluation && sideTab !== 'eval' && <span className="absolute right-1 top-2 h-1.5 w-1.5 rounded-full bg-seal" aria-label="有新评价" />}
                    {sideTab === key && <span className="absolute inset-x-2 -bottom-px h-0.5 bg-primary" aria-hidden />}
                  </button>
                ))}
              </div>

              {sideTab === 'guide' && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 scroll-thin">
                    {messages.length === 0 && !isStreaming && (
                      <div className="py-6 text-sm text-muted-foreground">
                        <p className="mb-2 text-foreground">可以这样问：</p>
                        <ul className="space-y-1.5">
                          {[`${cfg.title}应该包括哪些部分？`, '本案的管辖权争点应该怎么组织论证？', '请帮我检查请求事项写得是否具体可执行'].map((q) => (
                            <li key={q}>
                              <button type="button" onClick={() => setInput(q)} className="text-left text-primary underline-offset-4 hover:underline">{q}</button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {messages.map((msg) => (
                      <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[90%] rounded-md px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
                          {msg.speaker && <div className="mb-1 font-semibold">{msg.speaker}</div>}
                          <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown></div>
                        </div>
                      </div>
                    ))}
                    {isStreaming && (
                      <div className="flex justify-start">
                        <div className="max-w-[90%] rounded-md bg-muted px-3 py-2">
                          {streamingText ? (
                            <div className="markdown-content text-sm"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown><span className="typewriter-cursor" /></div>
                          ) : (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="ai-thinking-dot h-2 w-2 rounded-full bg-primary" /><span className="ai-thinking-dot h-2 w-2 rounded-full bg-primary" /><span className="ai-thinking-dot h-2 w-2 rounded-full bg-primary" /><span>AI 正在思考…</span></div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 border-t p-3">
                    <div className="flex gap-2">
                      <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="问 AI 怎么写，Enter 发送" className="max-h-[100px] min-h-[56px] resize-none text-sm" disabled={isStreaming} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
                      <Button onClick={sendMessage} disabled={!input.trim() || isStreaming} size="icon" className="shrink-0 self-end" aria-label="发送">{isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
                    </div>
                  </div>
                </div>
              )}

              {sideTab === 'eval' && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <StageStandardsViewer value={selectedCase.scoringStandards ?? null} stageKey={cfg.stageKey} />
                  <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
                    {evaluating && !evaluation ? (
                      <div className="flex flex-col items-center justify-center gap-3 py-10"><Loader2 className="h-6 w-6 animate-spin text-primary" /><p className="text-sm text-muted-foreground">正在按评分标准评价…</p></div>
                    ) : evaluation ? (
                      <div className="markdown-content text-sm"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{evaluation}</ReactMarkdown></div>
                    ) : (
                      <div className="py-10 text-center text-sm text-muted-foreground">
                        <FileCheck className="mx-auto mb-2 h-7 w-7 opacity-40" />
                        写完后点左上方「请 AI 评价」，<br />评价会按本环节评分标准给分并指出问题。
                      </div>
                    )}
                  </div>
                </div>
              )}

              {sideTab === 'file' && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <CaseFileViewer sections={caseFileSections} title="卷宗" />
                </div>
              )}
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

      <SampleViewerDialog
        open={showSample}
        onOpenChange={setShowSample}
        docType={doc}
        docTitle={cfg.title}
        sampleText={sampleText}
        progress={evalProgress}
        thresholdScore={DEFAULT_SAMPLE_UNLOCK.scoreThreshold}
        thresholdCount={DEFAULT_SAMPLE_UNLOCK.evalCountThreshold}
      />
    </div>
  );
}

export default function ArbitrationWritingPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <ArbitrationWritingInner />
    </Suspense>
  );
}
