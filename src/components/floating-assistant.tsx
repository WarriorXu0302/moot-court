'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { useAppStore } from '@/lib/store';
import { Send, Scale, X, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import type { CaseData, UserRole } from '@/lib/types';
import { getRoleLabel, normalizeCaseType, isAdversarial } from '@/lib/case-type';
import { describeArbitrationMeta } from '@/lib/arbitration-case-utils';

interface FloatingAssistantProps {
  /** Current page context for the AI to understand what the student is doing */
  pageContext: string;
}

/**
 * A persistent floating AI assistant that reads the full case data,
 * understands the user's role, and adapts to the current page context.
 * Includes risk assessment / feasibility evaluation in its system prompt.
 */
export function FloatingAssistant({ pageContext }: FloatingAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedCase = useAppStore((s) => s.selectedCase) as CaseData | null;
  const selectedRole = useAppStore((s) => s.selectedRole) as UserRole | null;
  const lifecycle = useAppStore((s) => s.lifecycle);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isStreaming]);

  const caseType = normalizeCaseType(selectedCase?.caseType);
  const isArbitration = isAdversarial(caseType);
  const isCivil = caseType === 'civil';
  const roleLabel = selectedRole ? getRoleLabel(caseType, selectedRole) : '学生';

  const buildSystemPrompt = useCallback(() => {
    const caseData = selectedCase;
    const caseContext = caseData && isArbitration ? [
      `案件名称: ${caseData.name || ''}`,
      `案件基本介绍: ${caseData.profile || ''}`,
      `训练价值: ${caseData.teach || ''}`,
      `${isCivil ? '案件基本信息' : '仲裁基本信息'}: ${describeArbitrationMeta(caseData)}`,
      `案件基本资料: ${caseData.case || ''}`,
      `${isCivil ? '诉讼文书卷' : '仲裁文书卷'}: ${caseData.plead || ''}`,
      `证人与专家陈述笔录: ${caseData.record || ''}`,
      `证据材料: ${caseData.evidence || ''}`,
      `法律依据: ${caseData.law || ''}`,
    ].filter(Boolean).join('\n') : caseData ? [
      `案件名称: ${caseData.name || ''}`,
      `案件基本介绍: ${caseData.profile || ''}`,
      `训练价值: ${caseData.teach || ''}`,
      `案件基本资料: ${caseData.case || ''}`,
      `诉讼文书卷: ${caseData.plead || ''}`,
      `询问笔录: ${caseData.record || ''}`,
      `证据材料: ${caseData.evidence || ''}`,
      `相关法条和司法解释: ${caseData.law || ''}`,
      `程序瑕疵说明: ${caseData.wrong || ''}`,
      selectedRole === 'defender' ? `辩护词: ${caseData.defense || ''}` : '',
      selectedRole === 'prosecutor' ? `刑事起诉书: ${caseData.indictment || ''}\n公诉意见书: ${caseData.prosecution || ''}` : '',
      selectedRole === 'judge' ? `庭审提纲: ${caseData.plan || ''}` : '',
    ].filter(Boolean).join('\n') : '';

    return `你是一个常驻的${isCivil ? '涉外民商事诉讼模拟' : isArbitration ? '模拟国际仲裁' : '模拟法庭'}AI助手，服务于${roleLabel}角色。${isArbitration ? '\n涉及条文号、条约、判例时：只引用你有把握的内容，不确定时请直接提示"请以法律或规则原文核对"，严禁编造；也不要替学生给出本案的最终结论，应引导学生自己论证。' : ''}

## 重要原则：可行性评估与风险提示
当用户提出明显偏离案件事实或法律规定的假设时，你不必直接顺着用户的思路给答案。你应该：
1. 指出该假设与案件事实或法律规定不符之处
2. 提供正确的法律分析方向
3. 给出风险提示，帮助用户理解可能的后果
4. 引导用户回到合法合规的分析路径上

## 案件信息
${caseContext}

## 当前页面上下文
用户当前正在: ${pageContext}

## 你的职责
- 根据用户的${roleLabel}角色，针对性提供法律建议和分析
- 结合当前页面的训练情况，给出具体指导
- 如果有程序瑕疵信息，提醒用户注意相关风险
- 保持专业、严谨，但语言要清晰易懂
- 回答要结合具体案件事实和法律条文，避免空泛`;
  }, [selectedCase, selectedRole, roleLabel, pageContext, isArbitration, isCivil]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isStreaming) return;
    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: buildSystemPrompt() },
            ...newMessages.map(m => ({ role: m.role, content: m.content })),
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
                setMessages(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'assistant') {
                    return [...prev.slice(0, -1), { role: 'assistant', content: fullText }];
                  }
                  return [...prev, { role: 'assistant', content: fullText }];
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: '抱歉，连接出现问题，请稍后重试。' }]);
    }
    setIsStreaming(false);
  }, [input, isStreaming, messages, buildSystemPrompt]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          aria-label="打开 AI 助手"
          className="fixed bottom-6 right-6 z-40 flex h-12 items-center gap-2 rounded-full border bg-card pl-3 pr-4 text-sm font-medium text-foreground shadow-lg transition-colors hover:bg-accent"
        >
          {/* 原先 72px 方块 + 常驻红点 + 持续脉冲动画，在任何页面都抢走注意力；现在是一个安静的入口 */}
          <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground">
            <Scale className="h-4 w-4" />
          </span>
          问 AI
        </button>
      )}

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-40 w-96 max-w-[calc(100vw-2rem)] h-[32rem] max-h-[calc(100vh-3rem)] flex flex-col bg-card rounded-lg shadow-xl border">
          {/* Header */}
          <div className="panel-head flex items-center justify-between px-3 py-2">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-primary" />
              <span className="font-display text-sm font-semibold">AI 助手</span>
              <span className="text-xs text-muted-foreground">({roleLabel})</span>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setIsOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-thin p-3 space-y-2 min-h-0">
            {messages.length === 0 ? (
              <div className="text-center py-8">
                <Scale className="h-12 w-12 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm text-muted-foreground">
                  我是你的模拟法庭AI助手，可以读取全案卷宗，结合你当前的{roleLabel}角色和训练页面提供指导。
                </p>
              </div>
            ) : (
              messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}>
                    <div className="markdown-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{msg.content}</ReactMarkdown>
                    </div>
                  </div>
                </div>
              ))
            )}
            {isStreaming && (
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>思考中...</span>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t p-2 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="提问或讨论..."
              className="text-sm min-h-[40px] max-h-24 resize-none flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
            />
            <Button size="icon" className="shrink-0" onClick={sendMessage} disabled={isStreaming || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
