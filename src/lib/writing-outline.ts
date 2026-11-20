'use client';

import type { CaseData } from './types';

/**
 * 各文书类型的写作提纲和写作方法提示词。
 * 调用 /api/llm/stream 获取 AI 生成的结构提纲和一般性写作方法。
 */
export const WRITING_OUTLINE_PROMPTS: Record<string, { title: string; docType: string; prompt: string }> = {
  defense: {
    title: '辩护词',
    docType: 'defense',
    prompt: `请为辩护词撰写提供结构提纲和一般性写作方法指导。

输出格式要求：
## 辩护词结构提纲
（列出辩护词的标准结构，包括标题、引言、辩护意见、事实与理由、结语等部分，每部分说明应写什么内容）

## 写作方法指导
（从论点构建、证据引用、法律适用、语言规范等方面给出一般性指导）

## 常见问题提示
（列举撰写辩护词时常见的问题和注意事项）

请使用markdown格式，关键术语用**加粗**标记。`,
  },
  indictment: {
    title: '刑事起诉书',
    docType: 'indictment',
    prompt: `请为刑事起诉书撰写提供结构提纲和一般性写作方法指导。

输出格式要求：
## 刑事起诉书结构提纲
（列出刑事起诉书的标准结构，包括首部、正文（犯罪事实、证据、起诉理由和法律依据）、尾部等部分，每部分说明应写什么内容）

## 写作方法指导
（从事实归纳、证据列举、法律适用、格式规范等方面给出一般性指导）

## 常见问题提示
（列举撰写刑事起诉书时常见的问题和注意事项）

请使用markdown格式，关键术语用**加粗**标记。`,
  },
  prosecution: {
    title: '公诉意见书',
    docType: 'prosecution',
    prompt: `请为公诉意见书撰写提供结构提纲和一般性写作方法指导。

输出格式要求：
## 公诉意见书结构提纲
（列出公诉意见书的标准结构，包括首部、正文（犯罪事实综述、证据分析、法律适用、量刑建议）、尾部等部分，每部分说明应写什么内容）

## 写作方法指导
（从论证逻辑、证据分析、量刑建议、语言规范等方面给出一般性指导）

## 常见问题提示
（列举撰写公诉意见书时常见的问题和注意事项）

请使用markdown格式，关键术语用**加粗**标记。`,
  },
  plan: {
    title: '庭审提纲',
    docType: 'plan',
    prompt: `请为庭审提纲撰写提供结构提纲和一般性写作方法指导。

输出格式要求：
## 庭审提纲结构提纲
（列出庭审提纲的标准结构，包括开庭准备、法庭调查提纲、法庭辩论提纲、最后陈述、评议宣判等部分，每部分说明应写什么内容）

## 写作方法指导
（从庭审流程把控、争议焦点归纳、程序要点、语言规范等方面给出一般性指导）

## 常见问题提示
（列举撰写庭审提纲时常见的问题和注意事项）

请使用markdown格式，关键术语用**加粗**标记。`,
  },
};

/**
 * 获取写作提纲（流式调用 LLM）
 */
export async function fetchWritingOutline(
  docType: string,
  caseData: CaseData | null,
  onChunk: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const config = WRITING_OUTLINE_PROMPTS[docType];
  if (!config) throw new Error(`未知的文书类型: ${docType}`);

  const contextData = caseData
    ? `案件基本资料:\n${caseData.case || ''}\n\n诉讼文书卷:\n${caseData.plead || ''}\n\n相关法条:\n${caseData.law || ''}`
    : '';

  const messages = [
    {
      role: 'system' as const,
      content: `你是一位法学教授，负责指导学生撰写法律文书。请根据案件资料提供${config.title}的结构提纲和写作方法。请使用markdown格式输出，格式要求：
- 使用 ## 标记一级标题，### 标记二级标题
- 关键术语用 **加粗** 标记
- 列举要点时使用 - 或 1. 的列表格式
- 段落之间用空行分隔`,
    },
    {
      role: 'user' as const,
      content: `${config.prompt}\n\n${contextData}`,
    },
  ];

  const res = await fetch('/api/llm/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, temperature: 0.5, caching: true }),
    signal,
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
          if (parsed.content) {
            fullText += parsed.content;
            onChunk(fullText);
          }
        } catch { /* skip */ }
      }
    }
  }

  return fullText;
}

/**
 * 从 AI 评价文本中提取分数 (0-100)
 * 查找格式如 "得分：85" "得分: 85" "总分：85分" "评分：85/100" 等
 */
export function extractScore(text: string): number | undefined {
  if (!text) return undefined;
  // Match patterns like 得分：85, 得分: 85, 总分：85分, 评分：85/100, 成绩：85
  const patterns = [
    /(?:得分|总分|评分|成绩|分数)[：:]\s*(\d{1,3})\s*(?:分)?(?:\/\s*100)?/,
    /(?:得分|总分|评分|成绩|分数)\s+(\d{1,3})\s*(?:分)?/,
    /\b(\d{1,3})\s*\/\s*100\b/,
    /\b(\d{1,3})\s*分\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const score = parseInt(match[1], 10);
      if (score >= 0 && score <= 100) return score;
    }
  }
  return undefined;
}

/**
 * 构建卷宗 sections（复用于写作页面的卷宗栏）
 */
export function buildCaseFileSections(caseData: CaseData | null) {
  if (!caseData) return [];

  const parseJsonArray = (raw: string | undefined) => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((item: unknown) => {
          if (typeof item === 'string') return { title: item, book: '' };
          if (item && typeof item === 'object') {
            const obj = item as Record<string, unknown>;
            return { title: (obj.title as string) || (obj.name as string) || '', book: (obj.book as string) || (obj.content as string) || '' };
          }
          return { title: String(item), book: '' };
        });
      }
    } catch { /* not JSON */ }
    return [{ title: '全文', book: raw }];
  };

  return [
    { label: '诉讼文书卷', items: parseJsonArray(caseData.plead) },
    { label: '询问笔录', items: parseJsonArray(caseData.record) },
    { label: '证据材料', items: parseJsonArray(caseData.evidence) },
  ];
}
