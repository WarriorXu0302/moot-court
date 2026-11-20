'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TitleBar } from '@/components/title-bar';
import { ContinueModal } from '@/components/continue-modal';
import { fetchSummarySections, STAGE_SUMMARY_FORMAT_INSTRUCTION } from '@/lib/summary-stream';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAppStore } from '@/lib/store';
import type { ChatMessage, LearningRecordEntry } from '@/lib/types';
import { Send, Loader2, Bold, Italic, Underline, FileCheck, BookOpen, Save, Check, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { interruptTts } from '@/lib/audio';
import { LifecycleBar } from '@/components/lifecycle-bar';
import { CaseFileViewer, type CaseFileSection } from '@/components/case-file-viewer';
import { WritingOutlineDialog } from '@/components/writing-outline-dialog';
import { SampleViewerDialog } from '@/components/sample-viewer-dialog';
import {
  parseScoringStandards,
  getStageStandards,
  stageStandardsToPrompt,
  getEvalProgressMap,
  recordEvalProgress,
  canViewSample,
  DEFAULT_SAMPLE_UNLOCK,
  sampleLockedHint,
  type DocEvalProgress,
} from '@/lib/scoring';
import { buildCaseFileSections, extractScore } from '@/lib/writing-outline';

import { parseLifecycleFromAIResponse, advanceLifecycleForPage, stripLifecycleForStreaming } from '@/lib/lifecycle-utils';
import { StageStandardsViewer } from '@/components/stage-standards-viewer';
import { useEndAnalysis } from '@/hooks/use-end-analysis';
import { useStageDialogueLogger } from '@/hooks/use-stage-logger';

type FormatType = 'body' | 'h1' | 'h2' | 'h3';
type FontFamily = 'yahei' | 'heiti' | 'songti';
type EditorFontSize = '14px' | '16px' | '18px' | '20px';

export default function TrialOutlineWritingPage() {
  const router = useRouter();
  const { modal: endAnalysisModal, handleEndAnalysis } = useEndAnalysis({ currentPageName: '庭审提纲撰写' });

  const { selectedCase, addLearningRecord, setDocument, documents, user, hydrated, learningRecords, selectedRole } = useAppStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // 本环节对话实时计入学习记录（供学习记录展示与结束分析遍历全部环节）
  useStageDialogueLogger('庭审提纲撰写', messages);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [formatType, setFormatType] = useState<FormatType>('body');
  const [editorFont, setEditorFont] = useState<FontFamily>('yahei');
  const [editorFontSize, setEditorFontSize] = useState<EditorFontSize>('16px');
  const [evaluation, setEvaluation] = useState('');
  const [evaluating, setEvaluating] = useState(false);
  const [showContinueModal, setShowContinueModal] = useState(false);
  const [continueLoading, setContinueLoading] = useState(false);
  const [continueStream, setContinueStream] = useState('');
  const [continueRecord, setContinueRecord] = useState<LearningRecordEntry | undefined>(undefined);
  const [showOutline, setShowOutline] = useState(false);
  const [showSample, setShowSample] = useState(false);
  const [evalProgress, setEvalProgress] = useState<DocEvalProgress | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [saved, setSaved] = useState(false);

  const handleSaveDoc = () => {
    setDocument('plan', editorContent);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Auto-save on unmount
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  useEffect(() => {
    return () => {
      const content = editorContentRef.current;
      if (content.trim()) setDocument('plan', content);
    };
  }, [setDocument]);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) { router.push('/'); return; }
    if (!selectedCase) { router.push('/student/select'); return; }
  }, [selectedCase, user, hydrated, router]);

  useEffect(() => () => interruptTts(), []);

  // Load previously saved document content from store
  useEffect(() => {
    const saved = documents['plan'];
    if (saved) setEditorContent(saved);
  }, [documents]);

  // Load eval progress (for AI sample unlock)
  useEffect(() => {
    setEvalProgress(getEvalProgressMap(selectedCase?.id, user?.id)['plan']);
  }, [selectedCase?.id, user?.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingText]);

  const contextData = `案件基本资料:\n${selectedCase?.case || ''}\n\n诉讼文书卷:\n${selectedCase?.plead || ''}\n\n询问笔录:\n${selectedCase?.record || ''}\n\n证据材料:\n${selectedCase?.evidence || ''}\n\n相关法条和司法解释:\n${selectedCase?.law || ''}\n\n刑事起诉书:\n${selectedCase?.indictment || ''}\n\n庭审提纲参考:\n${selectedCase?.plan || ''}`;

  const caseFileSections: CaseFileSection[] = buildCaseFileSections(selectedCase);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    interruptTts();

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: Date.now(),
      speaker: '审判长',
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsStreaming(true);
    setStreamingText('');

    const systemPrompt = `你是一个庭审提纲撰写辅助AI助手。请根据案件资料、刑事起诉书和庭审提纲参考，帮助审判长撰写和讨论庭审提纲。
你的回复应该专业、有针对性。请使用markdown格式输出，格式要求：
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
      { role: 'user' as const, content: contextData + (editorContent ? `\n\n当前庭审提纲内容:\n${editorContent}` : '') },
      ...messages.map((m) => ({
        role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: `${m.speaker ? `[${m.speaker}] ` : ''}${m.content}`,
      })),
      { role: 'user' as const, content: input.trim() },
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
        speaker: 'AI助手',
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
  }, [input, isStreaming, messages, contextData, editorContent]);

  const handleEvaluate = async () => {
    if (!editorContent.trim()) return;
    setEvaluating(true);
    setEvaluation('');

    const standardsText = stageStandardsToPrompt(
      getStageStandards(parseScoringStandards(selectedCase?.scoringStandards), 'trial-outline'),
    );

    const evalPrompt = `请根据以下案件资料和庭审提纲参考，评价审判长撰写的庭审提纲质量。

${contextData}

用户撰写的庭审提纲:
${editorContent}

对话上下文:
${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

${standardsText ? standardsText + '\n\n' : ''}请从以下几个方面评价：
1. 庭审提纲结构是否完整、逻辑是否清晰
2. 法庭调查和辩论的安排是否合理
3. 法律适用是否正确
4. 语言表达是否规范
5. 改进建议

请在评价的最开头给出具体得分，格式为"得分：XX"（0-100分整数），然后换行给出详细评价。

请使用markdown格式输出，格式要求：
- 使用 ## 标记一级标题，### 标记二级标题，不要使用纯文本编号（如"一、""（一）"）作为标题
- 关键术语和法条名称用 **加粗** 标记
- 列举要点时使用 - 或 1. 的 markdown 列表格式
- 段落之间用空行分隔，保持层次清晰`;

    let fullText = '';
    try {
      const res = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'system', content: '你是一位法学教授，负责评价模拟法庭训练中学生的表现。请使用markdown格式输出评价。' }, { role: 'user', content: evalPrompt }],
          temperature: 0.5,
          caching: true,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
                setEvaluation(fullText);
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      fullText = '评价生成失败，请重试。';
      setEvaluation(fullText);
    } finally {
      setEvaluating(false);
      setEvalProgress(recordEvalProgress(selectedCase?.id, user?.id, 'plan', extractScore(fullText)));
    }
  };

  const handleContinue = async () => {
    setShowContinueModal(true);
    setContinueLoading(true);
    setDocument('plan', editorContent);

    const summaryPrompt = `请根据以下庭审提纲撰写过程，进行概括、评价和训练建议。

案件基本资料:\n${selectedCase?.case || ''}
诉讼文书卷:\n${selectedCase?.plead || ''}
询问笔录:\n${selectedCase?.record || ''}
证据材料:\n${selectedCase?.evidence || ''}
相关法条和司法解释:\n${selectedCase?.law || ''}
刑事起诉书:\n${selectedCase?.indictment || ''}
庭审提纲参考:\n${selectedCase?.plan || ''}

用户撰写的庭审提纲:\n${editorContent}

对话记录:\n${messages.map((m) => `${m.speaker || m.role}: ${m.content}`).join('\n')}

${STAGE_SUMMARY_FORMAT_INSTRUCTION}`;

    try {
      const data = await fetchSummarySections({
        systemPrompt: '你是一位法学教授，负责对模拟法庭训练的学习过程进行总结评价。' + '\n\n' + STAGE_SUMMARY_FORMAT_INSTRUCTION,
        userPrompt: summaryPrompt,
        temperature: 0.5,
        onChunk: (t) => setContinueStream(t),
      });
      let summary = data.summary || '', evaluation = data.evaluation, suggestion = data.suggestion, score: number | undefined = data.score;
      if (score === undefined && evaluation) { score = extractScore(evaluation); }

      const record: LearningRecordEntry = {
        pageName: '庭审提纲撰写',
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
        pageName: '庭审提纲撰写',
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

  const applyFormat = (type: 'bold' | 'italic' | 'underline') => {
    const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = editorContent.substring(start, end);
    let wrapper = '';
    if (type === 'bold') wrapper = '**';
    else if (type === 'italic') wrapper = '*';
    else if (type === 'underline') wrapper = '<u>';

    const closeWrapper = type === 'underline' ? '</u>' : wrapper;
    const newContent = editorContent.substring(0, start) + wrapper + selected + closeWrapper + editorContent.substring(end);
    setEditorContent(newContent);
  };

  const applyHeading = (type: FormatType) => {
    setFormatType(type);
    const textarea = document.getElementById('editor-textarea') as HTMLTextAreaElement;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const lineStart = editorContent.lastIndexOf('\n', start - 1) + 1;
    const prefix = type === 'h1' ? '# ' : type === 'h2' ? '## ' : type === 'h3' ? '### ' : '';
    // Remove existing heading prefix
    const existingLine = editorContent.substring(lineStart).split('\n')[0];
    const stripped = existingLine.replace(/^#{1,3}\s*/, '');
    const newContent = editorContent.substring(0, lineStart) + prefix + stripped + editorContent.substring(lineStart + existingLine.length);
    setEditorContent(newContent);
  };

  const canContinue = editorContent.trim().length > 0;

  if (!selectedCase) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  const fontMap = { yahei: 'Microsoft YaHei, sans-serif', heiti: 'SimHei, sans-serif', songti: 'SimSun, serif' };

  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <TitleBar
        pageName="庭审提纲撰写"
        onSkip={() => { if (abortRef.current) abortRef.current.abort(); interruptTts(); advanceLifecycleForPage('/student/judge-opening'); router.push('/student/judge-opening'); }}
        onContinue={handleContinue}
        canContinue={canContinue}
        continueTooltip="请先撰写庭审提纲"
        onEndAnalysis={handleEndAnalysis}
        showHome
        onHome={() => router.push('/')}
        isStudent
      />
      {endAnalysisModal}
      <LifecycleBar />

      <div className="flex-1 overflow-hidden">
        <ResizablePanelGroup orientation={isMobile ? 'vertical' : 'horizontal'} className="h-full">
          {/* Column 1: Indictment reference */}
          <ResizablePanel defaultSize={14} minSize={8}>
            <div className="border-r overflow-hidden flex flex-col h-full">
          <div className="panel-head px-3 py-2 shrink-0">
            <h3 className="font-semibold text-sm">刑事起诉书</h3>
          </div>
          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            <div className="text-sm text-muted-foreground markdown-content">
              {selectedCase.indictment ? (
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{selectedCase.indictment}</ReactMarkdown>
              ) : '暂无刑事起诉书'}
            </div>
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Column 2: AI Chat */}
          <ResizablePanel defaultSize={18} minSize={10}>
            <div className="border-r overflow-hidden flex flex-col h-full">
          <div className="panel-head px-3 py-2 shrink-0">
            <h3 className="font-semibold text-sm">公诉准备对话</h3>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-3 min-h-0">
            {messages.length === 0 && !isStreaming && (
              <div className="text-center text-muted-foreground py-8 text-sm">
                输入问题与AI讨论庭审提纲...
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                  msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}>
                  {msg.speaker && msg.role === 'user' && (
                    <div className="text-xs opacity-70 mb-0.5">{msg.speaker}</div>
                  )}
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
          <div className="border-t p-2 shrink-0">
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入问题..."
                className="resize-none text-sm min-h-[40px] max-h-[80px]"
                disabled={isStreaming}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              <Button
                onClick={sendMessage}
                disabled={!input.trim() || isStreaming}
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
          {/* Column 3: Editor */}
          <ResizablePanel defaultSize={36} minSize={22}>            <div className="border-r overflow-hidden flex flex-col h-full">
          <div className="panel-head px-3 py-2 shrink-0">
            <h3 className="font-semibold text-sm">庭审提纲</h3>
          </div>
          {/* Toolbar */}
          <div className="flex items-center gap-1 px-2 py-1.5 border-b bg-muted/30 shrink-0 flex-wrap">
            <Select value={formatType} onValueChange={(v) => applyHeading(v as FormatType)}>
              <SelectTrigger className="h-7 w-24 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="body">正文</SelectItem>
                <SelectItem value="h1">标题一</SelectItem>
                <SelectItem value="h2">标题二</SelectItem>
                <SelectItem value="h3">标题三</SelectItem>
              </SelectContent>
            </Select>
            <Select value={editorFont} onValueChange={(v) => setEditorFont(v as FontFamily)}>
              <SelectTrigger className="h-7 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="yahei">雅黑</SelectItem>
                <SelectItem value="heiti">黑体</SelectItem>
                <SelectItem value="songti">宋体</SelectItem>
              </SelectContent>
            </Select>
            <Select value={editorFontSize} onValueChange={(v) => setEditorFontSize(v as EditorFontSize)}>
              <SelectTrigger className="h-7 w-16 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="14px">14</SelectItem>
                <SelectItem value="16px">16</SelectItem>
                <SelectItem value="18px">18</SelectItem>
                <SelectItem value="20px">20</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => applyFormat('bold')} title="加粗" aria-label="加粗">
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => applyFormat('italic')} title="斜体" aria-label="斜体">
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => applyFormat('underline')} title="下划线" aria-label="下划线">
              <Underline className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleSaveDoc} disabled={!editorContent.trim()} title="保存文书">
              {saved ? <Check className="h-3.5 w-3.5 mr-1 text-green-600" /> : <Save className="h-3.5 w-3.5 mr-1" />}
              {saved ? '已保存' : '保存'}
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowOutline(true)} title="获取写作提纲和写作方法">
              <BookOpen className="h-3.5 w-3.5 mr-1" />
              提纲
            </Button>
            <Button variant="outline" size="sm" className="h-7 ml-auto text-xs" onClick={handleEvaluate} disabled={evaluating || !editorContent.trim()}>
              {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <FileCheck className="h-3.5 w-3.5 mr-1" />}
              评价{evalProgress ? ` ${evalProgress.evalCount}` : ''}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setShowSample(true)}
              disabled={!canViewSample(evalProgress)}
              title={canViewSample(evalProgress) ? '查看本环节AI参考样例' : sampleLockedHint(evalProgress)}
            >
              <Sparkles className="h-3.5 w-3.5 mr-1" />
              AI样例
            </Button>
          </div>
          <textarea
            id="editor-textarea"
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            className="flex-1 w-full resize-none border-0 outline-none p-3 bg-background text-foreground"
            style={{ fontFamily: fontMap[editorFont], fontSize: editorFontSize, lineHeight: 1.8 }}
            placeholder="在此撰写庭审提纲..."
          />
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Column 4: Evaluation */}
          <ResizablePanel defaultSize={17} minSize={10}>
            <div className="border-r overflow-hidden flex flex-col h-full">
          <div className="panel-head px-3 py-2 shrink-0">
            <h3 className="font-semibold text-sm">庭审提纲评价</h3>
          </div>
          <StageStandardsViewer value={selectedCase?.scoringStandards ?? null} stageKey="trial-outline-writing" />
          <div className="flex-1 overflow-y-auto min-h-0 p-3">
            {evaluation ? (
              <div className="markdown-content text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{evaluation}</ReactMarkdown>
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-8 text-sm">
                点击"评价"按钮获取AI对庭审提纲的评价
              </div>
            )}
          </div>
        </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          {/* Column 5: Case Files */}
          <ResizablePanel defaultSize={15} minSize={8}>
            <div className="overflow-hidden flex flex-col h-full">
              <div className="panel-head px-3 py-2 shrink-0">
                <h3 className="font-semibold text-sm">卷宗</h3>
              </div>
              <CaseFileViewer sections={caseFileSections} title="卷宗" />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ContinueModal
        open={showContinueModal}
        onClose={() => {
          setShowContinueModal(false);
          if (continueRecord) router.push('/student/judge-opening');
        }}
        loading={continueLoading}
        streamText={continueStream}
        record={continueRecord}
        conversations={messages}
      />

      <WritingOutlineDialog
        open={showOutline}
        onOpenChange={setShowOutline}
        docType="plan"
        caseData={selectedCase}
      />

      <SampleViewerDialog
        open={showSample}
        onOpenChange={setShowSample}
        docType="plan"
        docTitle="庭审提纲"
        sampleText={selectedCase?.plan ?? ''}
        progress={evalProgress}
        thresholdScore={DEFAULT_SAMPLE_UNLOCK.scoreThreshold}
        thresholdCount={DEFAULT_SAMPLE_UNLOCK.evalCountThreshold}
      />
    </div>
  );
}
