'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { CaseFileViewer, type CaseFileSection } from '@/components/case-file-viewer';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useAppStore } from '@/lib/store';
import { parseHighlights } from '@/lib/highlights';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { Send, Loader2, CheckCircle2, Circle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { LifecycleBar } from '@/components/lifecycle-bar';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming } from '@/lib/lifecycle-utils';
import { generateReviewQuestions } from '@/lib/question-generator';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';

const FALLBACK_QUESTIONS = [
  '1. 案件是否属于本院管辖？',
  '2. 起诉书指控的被告人的身份，实施犯罪的时间、地点、手段，犯罪事实、危害后果、罪名，以及其他可能影响定罪量刑的情节等是否明确？',
  '3. 起诉书是否载明被告人被采取强制措施的种类、羁押地点，是否在案以及是否扣押、冻结在案被告人的财物及财物存放地点，是否列明被害人的姓名、住址、通信地址？',
  '4. 是否附有起诉前收集的证据目录？',
  '5. 是否附有能够证明指控犯罪行为性质、情节等内容的主要证据复印件或者照片？',
  '6. 是否附有起诉前提供了证言的证人名单，证人名单是否列明出庭作证和拟不出庭作证的证人的姓名、性别、年龄、职业、住址和通信地址？',
  '7. 已委托辩护人、代理人的，是否附有辩护人、代理人的姓名、住址等？',
  '8. 提起附带民事诉讼的，是否附有相关证据材料？',
  '9. 侦查、起诉程序的各种法律手续和诉讼文书复印件是否完备？',
  '10. 有无《刑事诉讼法》第16条第2~6项规定的不追究刑事责任的情形？',
];

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

function parseStringArray(jsonStr: string | undefined): string[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

export default function IndictmentReviewPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '起诉审查' });

  const { selectedCase, addLearningRecord, user, hydrated, learningRecords, selectedRole } = useAppStore();

  const [caseData, setCaseData] = useState(selectedCase);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('起诉审查', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<string>('');
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, { answer: string; score: number }>>({});
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [questions, setQuestions] = useState<string[]>(FALLBACK_QUESTIONS);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const questionsInitRef = useRef(false);
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
    fetch(`/api/cases?id=${selectedCase.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.case) {
          setCaseData(data.case);
          // Generate role-specific review questions based on case materials
          if (!questionsInitRef.current) {
            questionsInitRef.current = true;
            setQuestionsLoading(true);
            generateReviewQuestions(data.case)
              .then((qs) => setQuestions(qs))
              .catch(() => {})
              .finally(() => setQuestionsLoading(false));
          }
        }
      })
      .catch(() => {
        if (!questionsInitRef.current && selectedCase) {
          questionsInitRef.current = true;
          setQuestionsLoading(true);
          generateReviewQuestions(selectedCase)
            .then((qs) => setQuestions(qs))
            .catch(() => {})
            .finally(() => setQuestionsLoading(false));
        }
      });
  }, [selectedCase, user, hydrated, router]);

  const allQuestionsAnswered = Object.keys(questionAnswers).length === questions.length;

  const caseFileSections: CaseFileSection[] = [
    { label: '诉讼文书卷', items: parseJsonArray(caseData?.plead) },
    { label: '询问笔录', items: parseJsonArray(caseData?.record) },
    { label: '证据材料', items: parseJsonArray(caseData?.evidence) },
  ];
  const highlightConfig = parseHighlights(caseData?.highlights);

  const lawList = parseStringArray(caseData?.law);

  const contextData = `案件基本资料:\n${caseData?.case || ''}\n\n诉讼文书卷:\n${caseData?.plead || ''}\n\n询问笔录:\n${caseData?.record || ''}\n\n证据材料:\n${caseData?.evidence || ''}\n\n相关法条和司法解释:\n${caseData?.law || ''}\n\n刑事起诉书:\n${caseData?.indictment || ''}`;

  const sendMessage = useCallback(async (messageContent?: string) => {
    const content = messageContent || input.trim();
    if (!content || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
      speaker: '审判长',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const systemPrompt = `你是一个起诉审查解读AI助手。请根据提供的案件资料和刑事起诉书，帮助审判长分析起诉审查的关键问题。
你的回复应该专业、准确、条理清晰。请使用markdown格式输出，格式要求：
- 使用 ## 标记一级标题，### 标记二级标题，不要使用纯文本编号（如"一、""（一）"）作为标题
- 关键术语和法条名称用 **加粗** 标记
- 列举要点时使用 - 或 1. 的 markdown 列表格式
- 段落之间用空行分隔，保持层次清晰

可行性评估与风险提示：如果用户提出明显偏离案件事实或法律规定的假设，你不必直接顺着用户的思路给答案，而应指出该假设与案件事实或法律规定之间的差异，提示相关风险，并引导用户回到合法合理的分析路径上。
案件生命周期：系统已在案例详情页自动生成了初始的生命周期时间轴（从立案开始的各关键节点）。在后续对话中，你需要智能判断是否需要更新生命周期：
- 当对话涉及新的诉讼阶段或法律程序节点时，在回复末尾输出已完成的阶段节点（用<LIFECYCLE>标签包裹JSON）
- 当对话只是讨论已有阶段内的细节（如证据分析、法条解释）时，不需要重复输出生命周期
- 输出格式：<LIFECYCLE>{"nodes":[{"stage":"阶段名","legalActions":"详细描述该阶段的具体法律行为，包括主体、程序步骤和关键环节（不少于30字）","documents":"列出形成的法律文书并说明其内容和作用（不少于20字）","legalBasis":"写明法律条文全称及条文要旨"},...]}</LIFECYCLE>
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段
- 只输出已完成的阶段节点（学生已经经历过的阶段），不要输出未来未到达的阶段
- 输出时应包含之前所有已完成节点加上当前新完成的节点，不要包含未来阶段
- 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述`;

    const llmMessages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: contextData },
      ...messages.map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user' as const, content },
    ];

    const controller = new AbortController();
    abortRef.current = controller;

    try {
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
                setStreamingText(fullText);
              }
            } catch { /* skip */ }
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: parseLifecycleFromAIResponse(fullText),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingText('');
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setMessages((prev) => [...prev, {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content: `错误: ${err.message}`,
          timestamp: Date.now(),
        }]);
      }
    } finally {
      setIsStreaming(false);
      setStreamingText('');
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, contextData]);

  const handleSelectQuestion = (qIdx: string) => {
    setSelectedQuestion(qIdx);
    const idx = parseInt(qIdx);
    if (!isNaN(idx) && idx >= 0 && idx < questions.length) {
      setInput(questions[idx]);
    }
  };

  const handleSendAnswer = () => {
    if (!selectedQuestion && !input.trim()) return;
    const content = input.trim();
    sendMessage(content);

    if (selectedQuestion) {
      const qIdx = parseInt(selectedQuestion);
      if (!isNaN(qIdx)) {
        setQuestionAnswers((prev) => ({
          ...prev,
          [qIdx]: { answer: content, score: 0 },
        }));
      }
    }
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    const summaryPrompt = `请根据以下起诉审查页的学习过程，进行概括、评价和训练建议。

案件基本资料:\n${caseData?.case || ''}
诉讼文书卷:\n${caseData?.plead || ''}
询问笔录:\n${caseData?.record || ''}
证据材料:\n${caseData?.evidence || ''}
相关法条和司法解释:\n${caseData?.law || ''}
刑事起诉书:\n${caseData?.indictment || ''}

对话记录:
${messages.map((m) => `${m.role === 'user' ? '审判长' : 'AI'}: ${m.content}`).join('\n')}

用户回答的10个问题:
${questions.map((q, i) => {
  const ans = questionAnswers[i];
  return `${q}\n回答: ${ans?.answer || '未回答'}\n`;
}).join('\n')}

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
        pageName: '起诉审查',
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
        pageName: '起诉审查',
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

  if (!caseData) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="起诉审查"
        onSkip={() => { if (abortRef.current) abortRef.current.abort(); advanceLifecycleForPage('/student/trial-outline-writing'); router.push('/student/trial-outline-writing'); }}
        onContinue={handleContinue}
        canContinue={true}
        continueTooltip=""
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          {/* Column 1: Case basic data */}
          <ResizablePanel defaultSize={22} minSize={12}>
            <div className="border-r overflow-hidden flex flex-col h-full">
              <div className="panel-head px-3 py-2 shrink-0">
                <h3 className="font-semibold text-sm">案件基本资料</h3>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0">
                <div className="p-3 text-sm text-muted-foreground">
                  <div className="markdown-content text-foreground leading-relaxed mb-3">
                    {caseData.case ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{caseData.case}</ReactMarkdown>
                    ) : '暂无案件基本资料'}
                  </div>
                  <div className="border-t pt-2 mt-2">
                    <h4 className="font-semibold text-xs mb-1">相关法条</h4>
                    <div className="space-y-1">
                      {lawList.length === 0 ? (
                        <p className="text-xs text-muted-foreground">暂无</p>
                      ) : (
                        lawList.map((law, i) => (
                          <div key={i} className="border rounded p-1.5 bg-muted/30 text-xs markdown-content">
                            <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{law}</ReactMarkdown>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Column 2: Indictment */}
          <ResizablePanel defaultSize={22} minSize={12}>
            <div className="border-r overflow-hidden flex flex-col h-full">
              <div className="panel-head px-3 py-2 shrink-0">
                <h3 className="font-semibold text-sm">刑事起诉书</h3>
              </div>
              <div className="flex-1 overflow-y-auto min-h-0 p-3">
                <div className="text-sm text-muted-foreground markdown-content">
                  {caseData.indictment ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{caseData.indictment}</ReactMarkdown>
                  ) : '暂无刑事起诉书'}
                </div>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Column 3: AI Chat */}
          <ResizablePanel defaultSize={34} minSize={20}>
            <div className="overflow-hidden flex flex-col h-full min-w-0">
          <div className="panel-head px-3 py-2 shrink-0">
            <h3 className="font-semibold text-sm">起诉审查解读AI助手</h3>
          </div>

          <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3 min-h-0">
            {messages.length === 0 && !isStreaming && (
              <div className="text-center text-muted-foreground py-8 text-sm">
                选择下方问题或直接输入提问...
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}>
                  <div className="markdown-content">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {isStreaming && (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-lg px-3 py-2 bg-muted">
                  {streamingText ? (
                    <div className="markdown-content text-sm">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleForStreaming(streamingText)}</ReactMarkdown>
                      <span className="typewriter-cursor" />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                      <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                      <span className="w-2 h-2 rounded-full bg-primary ai-thinking-dot" />
                      <span>AI正在思考...</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3 space-y-2 shrink-0">
            {questionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>正在生成针对本案的审查问题...</span>
              </div>
            ) : (
            <Select value={selectedQuestion} onValueChange={handleSelectQuestion}>
              <SelectTrigger className="text-sm">
                <SelectValue placeholder="选择需要审查的问题" />
              </SelectTrigger>
              <SelectContent>
                {questions.map((q, i) => (
                  <SelectItem key={i} value={String(i)}>
                    <span className={questionAnswers[i] ? 'text-green-600' : ''}>
                      {questionAnswers[i] ? '✓ ' : ''}{q.substring(0, 30)}...
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            )}

            <div className="flex flex-wrap gap-1">
              {questions.map((_, i) => {
                const answered = !!questionAnswers[i];
                return (
                  <div
                    key={i}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${
                      answered ? 'bg-green-500 text-white' : 'bg-muted text-muted-foreground'
                    }`}
                    title={questions[i]}
                  >
                    {answered ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                  </div>
                );
              })}
            </div>

            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入问题..."
                className="resize-none text-sm min-h-[60px] max-h-[100px]"
                disabled={isStreaming}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendAnswer();
                  }
                }}
              />
              <Button
                onClick={handleSendAnswer}
                disabled={(!input.trim() && !selectedQuestion) || isStreaming}
                size="icon"
                className="shrink-0"
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Column 4: Case files */}
          <ResizablePanel defaultSize={22} minSize={12}>
            <div className="overflow-hidden flex flex-col h-full">
              <CaseFileViewer sections={caseFileSections} title="卷宗" highlightConfig={highlightConfig} currentRole={selectedRole || undefined} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ContinueModal
        open={showContinueModal}
        onClose={() => {
          setShowContinueModal(false);
          if (continueRecord) router.push('/student/trial-outline-writing');
        }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />
    </div>
  );
}
