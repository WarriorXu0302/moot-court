'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { CaseFileViewer, type CaseFileSection } from '@/components/case-file-viewer';
import { parseScoringStandards } from '@/lib/scoring';
import { FloatingAssistant } from '@/components/floating-assistant';
import { CaseLifecycleTimeline } from '@/components/case-lifecycle-timeline';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { parseLifecycleFromAIResponse, advanceLifecycleForPage, generateInitialLifecycle, stripLifecycleForStreaming } from '@/lib/lifecycle-utils';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAppStore } from '@/lib/store';
import { parseHighlights } from '@/lib/highlights';
import { interruptTts } from '@/lib/audio';
import { generateCaseQuestions } from '@/lib/question-generator';
import type { ChatMessage, LearningRecordEntry, CaseHighlights } from '@/lib/types';
import { Send, Loader2, CheckCircle2, ChevronDown, ChevronRight, PanelLeftClose, PanelRightClose, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { Textarea } from '@/components/ui/textarea';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';
import { getArbitrationNextRoute } from '@/lib/arbitration-route';
import { generateArbitrationQuestions, setArbitrationInitialLifecycle, getArbitrationFallbackQuestions, advanceArbitrationLifecycle } from '@/lib/arbitration-study';
import { buildArbitrationFileSections, buildArbitrationContext } from '@/lib/arbitration-case-utils';

const FALLBACK_QUESTIONS = [
  '1. 本案的犯罪行为人是谁？',
  '2. 本案中证明犯罪嫌疑人有罪、罪重的证据有哪些？',
  '3. 本案中证明犯罪嫌疑人无罪、罪轻的证据有哪些？',
  '4. 有罪证据能否形成完整的证据链，得出排他性的唯一结论？',
  '5. 本案犯罪嫌疑人先后作过多少次供述？其前后是否一致？不一致的原因是什么？',
  '6. 本案其他证据之间有无矛盾？该矛盾的存在如何解释？',
  '7. 如果犯罪嫌疑人构成犯罪，本案中影响对其量刑的情节有哪些？',
  '8. 本案侦查程序是否符合法律规定？',
  '9. 控方证据有哪些问题？',
];

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function parseStringArray(jsonStr: string | undefined): string[] {
  if (!jsonStr) return [];
  try {
    const arr = JSON.parse(jsonStr);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function CaseDetailPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '案例研习' });

  const { selectedCase, addLearningRecord, user, hydrated, learningRecords, selectedRole, lifecycle, setLifecycle } = useAppStore();

  const [caseData, setCaseData] = useState(selectedCase);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('案例详情查看', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [selectedQuestion, setSelectedQuestion] = useState<string>('');
  const [questionsOpen, setQuestionsOpen] = useState(true);
  const [questionAnswers, setQuestionAnswers] = useState<Record<number, { answer: string; score: number }>>({});
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [error, setError] = useState('');
  const [highlightConfig, setHighlightConfig] = useState<CaseHighlights>({});
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);
  const [questions, setQuestions] = useState<string[]>(
    selectedCase?.caseType === 'arbitration' && selectedRole
      ? getArbitrationFallbackQuestions(selectedRole)
      : FALLBACK_QUESTIONS,
  );
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const isMobile = useIsMobile();
  const lifecycleInitRef = useRef(false);
  const questionsInitRef = useRef(false);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) {
      router.push('/');
      return;
    }
    if (!selectedCase) {
      router.push('/student/select');
      return;
    }
    // Load full case data from API
    fetch(`/api/cases?id=${selectedCase.id}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.case) {
          setCaseData(data.case);
          setHighlightConfig(parseHighlights(data.case.highlights));
          const isArb = data.case.caseType === 'arbitration';
          // Generate initial lifecycle after case data is loaded（仲裁：固定庭前节点，不调 LLM）
          if (!lifecycleInitRef.current) {
            lifecycleInitRef.current = true;
            if (isArb) setArbitrationInitialLifecycle(selectedRole);
            else generateInitialLifecycle(data.case, selectedRole);
          }
          // Generate role-specific questions based on case materials
          if (!questionsInitRef.current && selectedRole) {
            questionsInitRef.current = true;
            setQuestionsLoading(true);
            const gen = isArb ? generateArbitrationQuestions : generateCaseQuestions;
            gen(data.case, selectedRole)
              .then((qs) => setQuestions(qs))
              .catch(() => {})
              .finally(() => setQuestionsLoading(false));
          }
        }
      })
      .catch(() => {
        // Use whatever we have
        const isArb = selectedCase?.caseType === 'arbitration';
        if (!lifecycleInitRef.current && selectedCase) {
          lifecycleInitRef.current = true;
          if (isArb) setArbitrationInitialLifecycle(selectedRole);
          else generateInitialLifecycle(selectedCase, selectedRole);
        }
        if (!questionsInitRef.current && selectedCase && selectedRole) {
          questionsInitRef.current = true;
          setQuestionsLoading(true);
          const gen = isArb ? generateArbitrationQuestions : generateCaseQuestions;
          gen(selectedCase, selectedRole)
            .then((qs) => setQuestions(qs))
            .catch(() => {})
            .finally(() => setQuestionsLoading(false));
        }
      });
  }, [selectedCase, user, hydrated, router]);

  const answeredCount = Object.keys(questionAnswers).length;
  const allQuestionsAnswered = answeredCount === questions.length;

  // Build case file sections for the viewer
  const scoringStandards = parseScoringStandards(caseData?.scoringStandards);
  const scoringSection: CaseFileSection | null = scoringStandards
    ? {
        label: '评分标准',
        items: [
          {
            title: '总标准',
            book: [
              ...scoringStandards.overall.dimensions.map(
                (d) => `${d.name}（权重${d.weight}%）：${d.criteria}`
              ),
              ...scoringStandards.overall.grading.map((g) => `${g.band}（${g.range}）：${g.desc}`),
            ].join('\r\r'),
          },
          ...scoringStandards.stages.map((s) => ({
            title: `${s.name}（${s.roles.join('／')}）`,
            book: s.points.join('\r\r'),
          })),
        ],
      }
    : null;

  const isArbitration = (caseData?.caseType ?? selectedCase?.caseType) === 'arbitration';

  const caseFileSections: CaseFileSection[] = isArbitration
    ? [
        // 仲裁：法律依据已在左侧"相关法条"展示，卷宗只放三类材料 + 评分标准
        ...buildArbitrationFileSections(caseData).filter((s) => s.label !== '法律依据'),
        ...(scoringSection ? [scoringSection] : []),
      ]
    : [
        { label: '诉讼文书卷', items: parseJsonArray(caseData?.plead) },
        { label: '询问笔录', items: parseJsonArray(caseData?.record) },
        { label: '证据材料', items: parseJsonArray(caseData?.evidence) },
        ...(scoringSection ? [scoringSection] : []),
      ];

  const lawList = parseStringArray(caseData?.law);

  const contextData = isArbitration
    ? buildArbitrationContext(caseData)
    : `案件基本资料:\n${caseData?.case || ''}\n\n诉讼文书卷:\n${caseData?.plead || ''}\n\n询问笔录:\n${caseData?.record || ''}\n\n证据材料:\n${caseData?.evidence || ''}\n\n相关法条和司法解释:\n${caseData?.law || ''}`;

  const arbitrationSystemPrompt = `你是一个国际仲裁案例解读AI助手。请根据提供的案件资料，帮助用户分析案例的关键问题。
你的回复应该专业、准确、条理清晰。请使用markdown格式输出，格式要求：
- 使用 ## 标记一级标题，### 标记二级标题，不要使用纯文本编号（如"一、""（一）"）作为标题
- 关键术语和法条名称用 **加粗** 标记
- 列举要点时使用 - 或 1. 的 markdown 列表格式
- 段落之间用空行分隔，保持层次清晰
重要：你需要引导用户重点审查：①仲裁协议的约定是否清晰、效力是否存在瑕疵（是否约定仲裁机构、仲裁地、仲裁协议适用的法律）；②仲裁协议准据法应如何确定；③证据的真实性、合法性、关联性；④争议焦点与证明责任分配。如果用户发现了管辖或程序上的问题，请给予肯定并分析其法律后果。
涉及法条、条约、判例时：只引用你有把握的内容；不确定条文号或案号时，明确提示"请以规则或法律原文核对"，严禁编造。提醒用户对 AI 给出的任何法律依据都要自行核验。

可行性评估与风险提示：如果用户提出明显偏离案件事实或法律规定的假设，你不必直接顺着用户的思路给答案，而应指出该假设与案件事实或法律规定之间的差异，提示相关风险，并引导用户回到合法合理的分析路径上。`;

  const criminalSystemPrompt = `你是一个法律案例详情解读AI助手。请根据提供的案件资料，帮助用户分析案例的关键问题。
你的回复应该专业、准确、条理清晰。请使用markdown格式输出，格式要求：
- 使用 ## 标记一级标题，### 标记二级标题，不要使用纯文本编号（如"一、""（一）"）作为标题
- 关键术语和法条名称用 **加粗** 标记
- 列举要点时使用 - 或 1. 的 markdown 列表格式
- 段落之间用空行分隔，保持层次清晰
重要：你需要引导用户仔细审查案件材料中可能存在的程序瑕疵。程序瑕疵可能包括但不限于：侦查程序违法、证据收集程序违法、强制措施不当、诉讼程序违规等。如果用户发现了程序瑕疵，请给予肯定并详细分析其法律后果。

案件生命周期：系统已在页面加载时自动生成了初始的生命周期时间轴（从立案开始的各关键节点）。在后续对话中，你需要智能判断是否需要更新生命周期：
- 当对话涉及新的诉讼阶段或法律程序节点时，在回复末尾输出已完成的阶段节点（用<LIFECYCLE>标签包裹JSON）
- 当对话只是讨论已有阶段内的细节（如证据分析、法条解释）时，不需要重复输出生命周期
- 输出格式：<LIFECYCLE>{"nodes":[{"stage":"阶段名","legalActions":"详细描述该阶段的具体法律行为，包括主体、程序步骤和关键环节（不少于30字）","documents":"列出形成的法律文书并说明其内容和作用（不少于20字）","legalBasis":"写明法律条文全称及条文要旨"},...]}</LIFECYCLE>
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段
- 只输出已完成的阶段节点（学生已经经历过的阶段），不要输出未来未到达的阶段
- 输出时应包含之前所有已完成节点加上当前新完成的节点，不要包含未来阶段
- 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述

可行性评估与风险提示：如果用户提出明显偏离案件事实或法律规定的假设，你不必直接顺着用户的思路给答案，而应指出该假设与案件事实或法律规定之间的差异，提示相关风险，并引导用户回到合法合理的分析路径上。`;

  const systemPromptWithContext = isArbitration ? arbitrationSystemPrompt : criminalSystemPrompt;

  const sendMessage = useCallback(async (messageContent?: string) => {
    const content = messageContent || input.trim();
    if (!content || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const systemPrompt = systemPromptWithContext;

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

      const cleanText = parseLifecycleFromAIResponse(fullText);
      const assistantMsg: ChatMessage = {
        id: `msg-${Date.now()}-ai`,
        role: 'assistant',
        content: cleanText,
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
    // Do NOT auto-fill input with question text — user writes their own answer
    setInput('');
  };

  const handleSendAnswer = () => {
    if (!selectedQuestion && !input.trim()) return;
    const userAnswer = input.trim();
    // Prepend the selected question as context so AI knows what's being asked
    const qIdx = selectedQuestion ? parseInt(selectedQuestion) : -1;
    const questionText = (qIdx >= 0 && qIdx < questions.length) ? questions[qIdx] : '';
    const content = questionText ? `【问题】${questionText}\n\n【回答】${userAnswer}` : userAnswer;
    sendMessage(content);

    // Mark question as answered
    if (selectedQuestion) {
      if (!isNaN(qIdx)) {
        const nextAnswers = { ...questionAnswers, [qIdx]: { answer: userAnswer, score: 0 } };
        setQuestionAnswers(nextAnswers);
        // 自动选中下一道未答的题，省得学生再去找
        const total = questions.length;
        let next = -1;
        for (let k = 1; k <= total; k++) {
          const j = (qIdx + k) % total;
          if (!nextAnswers[j]) { next = j; break; }
        }
        setSelectedQuestion(next >= 0 ? String(next) : '');
        // 清单展开时会占掉对话区大半高度（1024 宽实测只剩 3 行），答过一题后收起，进度仍显示在清单标题上
        setQuestionsOpen(false);
      }
    }
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);

    const summaryPrompt = `请根据以下案例详情查看页的学习过程，进行概括、评价和训练建议。

案件基本资料:
${caseData?.case || ''}
诉讼文书卷:
${caseData?.plead || ''}
询问笔录:
${caseData?.record || ''}
证据材料:
${caseData?.evidence || ''}
相关法条和司法解释:
${caseData?.law || ''}
程序瑕疵说明:
${caseData?.wrong || ''}

对话记录:
${messages.map((m) => `${m.role === 'user' ? '学生' : 'AI'}: ${m.content}`).join('\n')}

用户回答的9个问题:
${questions.map((q, i) => {
  const ans = questionAnswers[i];
  return `${q}\n回答: ${ans?.answer || '未回答'}\n`;
}).join('\n')}

请从以下维度进行**详细**评价，必须结合具体对话内容和学生回答的原话来阐述，禁止空泛评价：

1. **学习过程概括**（至少200字）：
   - 学生是否认真阅读了案件材料
   - 对话中展现了哪些分析思路，引用学生的具体发言
   - 学生使用了哪些法律概念和条文
   - 学习态度和参与度如何

2. **程序瑕疵发现能力**（如案件有程序瑕疵）：
   - 学生是否注意到案件材料中可能存在的程序性问题
   - 如果发现了，引用学生的原话说明发现过程
   - 如果未发现，指出学生遗漏了哪些重要线索，并给出具体的材料位置提示

3. **评价**（至少300字，必须引用学生原话）：
   - 优点：引用学生具体回答内容，说明为什么好
   - 不足：引用学生具体回答内容，说明问题在哪里
   - 法律分析能力：对法律条文的理解和应用是否准确
   - 逻辑思维能力：论证是否严密，是否存在逻辑跳跃

4. **训练建议**（至少200字，必须具体可执行）：
   - 针对每个不足，给出具体的改进建议
   - 建议重点复习的法律知识点（具体到条文）
   - 建议加强的实务技能
   - 下一阶段训练的注意事项

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;

    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位资深法学教授，负责对模拟法庭训练的学习过程进行详细总结评价。评价必须结合具体对话内容和学生的原话来阐述，禁止空泛的套话。每个评价点都要引用学生的具体回答内容作为依据。特别要评估学生是否发现案件中的程序瑕疵。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      let summary = data.summary || '', evaluation = data.evaluation, suggestion = data.suggestion, score: number | undefined = data.score;
      if (score === undefined && evaluation) { try { const { extractScore } = await import('@/lib/writing-outline'); score = extractScore(evaluation); } catch { /* skip */ } }

      const record: LearningRecordEntry = {
        pageName: '案例详情查看',
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
        pageName: '案例详情查看',
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

  /** 本环节完成后的下一站：仲裁案例走仲裁路线，刑事保持原有路由 */
  const goToNextStage = () => {
    if (caseData?.caseType === 'arbitration') {
      router.push(getArbitrationNextRoute(selectedRole, 'case-detail'));
    } else if (selectedRole === 'prosecutor') {
      router.push('/student/sentencing-negotiation');
    } else if (selectedRole === 'judge') {
      router.push('/student/indictment-review');
    } else {
      router.push('/student/sentencing-negotiation');
    }
  };

  const handleSkip = () => {
    abortRef.current?.abort();
    interruptTts();
    if (isArbitration) advanceArbitrationLifecycle('case-detail');
    else advanceLifecycleForPage('/student/case-detail');
    goToNextStage();
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
        pageName="案情研读"
        onSkip={handleSkip}
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
          {leftPanelCollapsed ? null : (
          <>
          <ResizablePanel defaultSize={33} minSize={20}>
            <div className="border-r overflow-hidden flex flex-col h-full">
          <div className="panel-head px-3 py-2">
            <h3 className="font-semibold text-sm">案件基本资料</h3>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0">
            <div className="px-5 py-4">
              <div className="markdown-content docket-text">
                {caseData.case ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{caseData.case}</ReactMarkdown>
                ) : (
                  '暂无案件基本资料'
                )}
              </div>
            </div>
          </div>

          {/* Law section */}
          <div className="border-t">
            <div className="panel-head px-3 py-2">
              <h3 className="font-semibold text-sm">相关法律依据</h3>
            </div>
            <div className="max-h-48 overflow-y-auto min-h-0">
              <div className="p-3 space-y-2">
                {lawList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无法条信息</p>
                ) : (
                  lawList.map((law, i) => (
                    <div key={i} className="border-l-2 border-primary/30 pl-3 text-xs leading-relaxed markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{law}</ReactMarkdown>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          </>
          )}
          <ResizablePanel defaultSize={leftPanelCollapsed && rightPanelCollapsed ? 100 : leftPanelCollapsed || rightPanelCollapsed ? 50 : 34} minSize={20}>
            <div className="border-r overflow-hidden flex flex-col h-full">
          <div className="panel-head flex items-center justify-between gap-2 px-2 py-1">
            {/* 两侧栏的收起/展开放在中栏栏头两端，不再单独占一整行 */}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setLeftPanelCollapsed(!leftPanelCollapsed)}
              aria-label={leftPanelCollapsed ? '显示案件基本资料' : '隐藏案件基本资料'}
              title={leftPanelCollapsed ? '显示案件基本资料' : '隐藏案件基本资料'}
            >
              {leftPanelCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </Button>
            <h3 className="font-semibold text-sm">AI 助教</h3>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground"
              onClick={() => setRightPanelCollapsed(!rightPanelCollapsed)}
              aria-label={rightPanelCollapsed ? '显示卷宗' : '隐藏卷宗'}
              title={rightPanelCollapsed ? '显示卷宗' : '隐藏卷宗'}
            >
              {rightPanelCollapsed ? <PanelRightOpen className="h-4 w-4" /> : <PanelRightClose className="h-4 w-4" />}
            </Button>
          </div>

          {/* Messages */}
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

          {/* Input area */}
          <div className="border-t p-3 space-y-2 shrink-0">
            {/* 思考题清单：原来藏在下拉框里，旁边一排无编号的圆点，学生看不到有哪些题、做到哪了 */}
            {questionsLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>正在生成针对本案的思考题...</span>
              </div>
            ) : (
              <div className="rounded-md border">
                <button
                  type="button"
                  onClick={() => setQuestionsOpen((v) => !v)}
                  aria-expanded={questionsOpen}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/40"
                >
                  {questionsOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="font-medium">思考题</span>
                  <span className="text-xs tabular-nums text-muted-foreground">已回答 {answeredCount} / {questions.length}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{questionsOpen ? '收起' : '展开'}</span>
                </button>
                {questionsOpen && (
                  <ol className="max-h-[22vh] overflow-y-auto border-t py-1 scroll-thin">
                    {questions.map((q, i) => {
                      const answered = !!questionAnswers[i];
                      const active = selectedQuestion === String(i);
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => handleSelectQuestion(active ? '' : String(i))}
                            aria-pressed={active}
                            className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm leading-snug hover:bg-muted/40 ${active ? 'bg-primary/10' : ''}`}
                          >
                            <span
                              className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] tabular-nums ${
                                answered ? 'bg-green-600 text-white' : active ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground'
                              }`}
                              aria-label={answered ? '已回答' : '未回答'}
                            >
                              {answered ? <CheckCircle2 className="h-3 w-3" /> : i + 1}
                            </span>
                            <span className={`${active ? 'font-medium' : answered ? 'text-muted-foreground' : ''} ${active ? '' : 'line-clamp-2'}`}>{q}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            )}

            {selectedQuestion !== '' && questions[Number(selectedQuestion)] && (
              <div className="text-xs text-muted-foreground">
                {/* 清单收起时，把当前题目完整显示在输入框上方，学生不用展开就知道在答哪题 */}
                {!questionsOpen && (
                  <p className="mb-1 max-h-24 overflow-y-auto rounded-sm bg-muted/50 px-2 py-1.5 text-sm leading-snug text-foreground scroll-thin">
                    {Number(selectedQuestion) + 1}. {questions[Number(selectedQuestion)]}
                  </p>
                )}
                正在回答第 {Number(selectedQuestion) + 1} 题{questionAnswers[Number(selectedQuestion)] ? '（已答过，再发送会补充回答）' : ''}。
                <button type="button" className="ml-1 underline hover:text-foreground" onClick={() => handleSelectQuestion('')}>改为自由提问</button>
              </div>
            )}

            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={selectedQuestion ? "写下你的分析，Enter 发送，Shift+Enter 换行" : "选一道思考题作答，或直接向 AI 助教提问"}
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
                title="发送"
              >
                {isStreaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
          </ResizablePanel>
          {rightPanelCollapsed ? null : (
          <>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={33} minSize={20}>
            <div className="overflow-hidden flex flex-col h-full">
              <CaseFileViewer
                sections={caseFileSections}
                title="卷宗"
                highlightConfig={highlightConfig}
                currentRole={selectedRole || undefined}
              />
            </div>
          </ResizablePanel>
          </>
          )}
        </ResizablePanelGroup>
      </div>

      <ContinueModal
        open={showContinueModal}
        onClose={() => {
          setShowContinueModal(false);
          if (continueRecord) {
            goToNextStage();
          }
        }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />

      <FloatingAssistant pageContext="查看案例详情和卷宗材料，回答9个引导问题" />
    </div>
  );
}
