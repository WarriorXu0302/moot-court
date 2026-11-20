import { LLMClient } from '@/lib/llm-client';

/**
 * 司法解释(law)字段质量保障
 *
 * 背景：案例由 Coze 工作流异步生成，LLM 长输出存在"后半段疲劳"问题——
 * 曾出现生产案例 law 数组条目只有文件标题、没有正文（前几条有正文、后面全偷懒，
 * 甚至 16 条全部只有标题）。本模块在服务端落库前统一校验并自动补全，
 * 保证任何入口（工作流保存/断点恢复/教师手工编辑）写出的 law 都带正文。
 */

export interface LawCompletenessReport {
  total: number;
  /** 缺正文条目的下标 */
  missingIndexes: number[];
  items: string[];
}

/** 判断单条是否缺正文：无「：」分隔，或「：」后正文不足 10 字 */
function isEntryMissingBody(text: string): boolean {
  const t = text.trim();
  const idx = t.indexOf('：');
  if (idx === -1) return true;
  return t.slice(idx + 1).trim().length < 10;
}

/** 解析 law 字段(JSON 数组字符串)，统计缺正文条目。解析失败返回 null */
export function analyzeLawCompleteness(law: string): LawCompletenessReport | null {
  if (!law || typeof law !== 'string') return null;
  let items: unknown;
  try {
    items = JSON.parse(law);
  } catch {
    return null;
  }
  if (!Array.isArray(items) || items.length === 0) return null;
  const texts = items.map((it) => (typeof it === 'string' ? it : String(it ?? '')));
  const missingIndexes: number[] = [];
  texts.forEach((t, i) => {
    if (isEntryMissingBody(t)) missingIndexes.push(i);
  });
  return { total: texts.length, missingIndexes, items: texts };
}

const COMPLETE_PROMPT = (title: string) => `你是中国法律专家。以下是模拟法庭教学案例资料中"司法解释与参考"列表里的一条法律文件条目，该条目目前只有文件标题，缺少正文内容。

条目：${title}

请为该条目补充准确的正文内容，要求：
1. 若为法律条文（标题含【】主题），输出该条文的真实法条原文；
2. 若为司法解释/指导意见/规范文件，输出该文件与刑事诉讼、故意伤害、正当防卫等主题相关的核心内容概要（150-300字）；
3. 若为指导性案例/典型案例，输出案情简介与裁判要旨/检察要旨（150-300字）；
4. 输出格式为：以给定条目的原标题开头，紧接中文冒号「：」和正文，只输出这一行完整条目；禁止输出"原标题"三个字、序号、解释说明、引号、markdown 标记或其他任何内容。`;

/** 调用 LLM 补全单条缺正文条目；失败返回 null */
async function completeOneEntry(
  title: string,
  customHeaders?: Record<string, string>,
): Promise<string | null> {
  try {
    const llm = new LLMClient(customHeaders);
    const stream = llm.stream(
      [{ role: 'user', content: COMPLETE_PROMPT(title) }],
      { temperature: 0.2 },
    );
    let fullText = '';
    for await (const chunk of stream) {
      if (chunk.content) fullText += chunk.content.toString();
    }
    const cleaned = fullText
      .trim()
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .replace(/^原标题\s*[：:]\s*/, '')
      .replace(/\n+/g, ' ')
      .trim();
    // 补全结果必须含正文才算成功
    if (cleaned.length > 20 && !isEntryMissingBody(cleaned)) return cleaned;
    return null;
  } catch {
    return null;
  }
}

/**
 * 确保 law 字段所有条目都带正文：缺正文的条目并行调 LLM 补全后返回新的 JSON 字符串。
 * 解析失败/无缺失/补全失败的场景一律返回原文，绝不阻塞主保存流程。
 */
export async function ensureLawComplete(
  law: string,
  customHeaders?: Record<string, string>,
): Promise<string> {
  const report = analyzeLawCompleteness(law);
  if (!report || report.missingIndexes.length === 0) return law;

  const items = [...report.items];
  await Promise.all(
    report.missingIndexes.slice(0, 20).map(async (idx) => {
      const fixed = await completeOneEntry(items[idx], customHeaders);
      if (fixed) items[idx] = fixed;
    }),
  );
  return JSON.stringify(items);
}
