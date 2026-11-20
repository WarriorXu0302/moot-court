/**
 * 学习过程总结流式输出协议与工具。
 *
 * 协议：模型按固定分隔标记输出四段（不使用 JSON，便于流式增量解析）：
 *   【概括】...【评价】...【建议】...【得分】85
 *
 * 前端边收边解析：四个区块固定渲染，内容在各自框内增长，版面结构稳定。
 */

export interface SummarySections {
  summary: string;
  evaluation: string;
  suggestion: string;
  score?: number;
}

const MARKS = {
  summary: '【概括】',
  evaluation: '【评价】',
  suggestion: '【建议】',
  score: '【得分】',
} as const;

/** 去掉段尾未闭合的半截标记（流式中途「【得」这类残片） */
function stripDanglingMark(text: string): string {
  return text.replace(/【[^】]*$/, '').trim();
}

/**
 * 增量解析分隔标记协议文本。流式中途也可调用：
 * 尚未出现的标记对应区块返回空串；score 仅在出现完整数字时给出。
 */
export function parseSummarySections(text: string): SummarySections {
  const iSummary = text.indexOf(MARKS.summary);
  const iEval = text.indexOf(MARKS.evaluation);
  const iSugg = text.indexOf(MARKS.suggestion);
  const iScore = text.indexOf(MARKS.score);

  // 一个标记都没出现：可能是流式初期或模型未遵守协议，全文作概括兜底
  if (iSummary < 0 && iEval < 0 && iSugg < 0 && iScore < 0) {
    return { summary: stripDanglingMark(text), evaluation: '', suggestion: '' };
  }

  const slice = (start: number, end: number) =>
    stripDanglingMark(text.slice(start, end < 0 ? text.length : end));

  // 各段起点：取「本标记之后、下一个出现的标记之前」
  const nextOf = (from: number) =>
    [iEval, iSugg, iScore].filter((i) => i > from).sort((a, b) => a - b)[0] ?? -1;

  let summary = '';
  let evaluation = '';
  let suggestion = '';

  if (iSummary >= 0) {
    summary = slice(iSummary + MARKS.summary.length, nextOf(iSummary));
  } else if (iEval > 0) {
    // 无【概括】标记但评价标记前有内容 → 视为概括
    summary = slice(0, iEval);
  }
  if (iEval >= 0) {
    evaluation = slice(iEval + MARKS.evaluation.length, nextOf(iEval));
  }
  if (iSugg >= 0) {
    suggestion = slice(iSugg + MARKS.suggestion.length, nextOf(iSugg));
  }

  let score: number | undefined;
  if (iScore >= 0) {
    const m = text.slice(iScore + MARKS.score.length).match(/\d{1,3}/);
    if (m) {
      const n = parseInt(m[0], 10);
      if (n >= 0 && n <= 100) score = n;
    }
  }

  return { summary, evaluation, suggestion, score };
}

export interface StreamSummaryParams {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** 每个 chunk 到达时回调（传入累积全文） */
  onChunk: (fullText: string) => void;
}

/**
 * 调用 /api/summary（SSE 流式），边收边回调累积全文，返回最终完整文本。
 * 失败时抛出异常，由调用方兜底。
 */
export async function streamSummary({
  systemPrompt,
  userPrompt,
  temperature = 0.5,
  onChunk,
}: StreamSummaryParams): Promise<string> {
  const res = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemPrompt, userPrompt, temperature }),
  });

  if (!res.ok || !res.body) {
    throw new Error(`summary request failed: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json: { content?: string; error?: string };
      try {
        json = JSON.parse(payload) as { content?: string; error?: string };
      } catch {
        continue; // 半截行忽略
      }
      if (json.error) throw new Error(json.error);
      if (json.content) {
        fullText += json.content;
        onChunk(fullText);
      }
    }
  }

  return fullText;
}

/** 结束分析 systemPrompt 的输出格式约定段（两处调用方共用） */
export const SUMMARY_FORMAT_INSTRUCTION = `请严格按以下格式输出，不要使用JSON，不要输出任何其他内容：

【概括】
对已完成训练过程的概括（按环节顺序综述）
【评价】
对学生当前表现的评价
【建议】
进一步的训练建议
【得分】
综合得分（仅输出一个0-100的整数）`;

/**
 * 环节总结（继续弹窗）的输出格式约定段——精简版。
 * 各段严格限字数：学生每过一个环节都会看一次，必须短而实。
 */
export const STAGE_SUMMARY_FORMAT_INSTRUCTION = `请严格按以下格式输出，不要使用JSON，不要输出任何其他内容：

【概括】
对本环节学习过程的概括（不超过60字）
【评价】
对学生本环节表现的评价（不超过100字，须结合具体内容，禁止空泛套话）
【建议】
针对性训练建议（不超过60字）
【得分】
综合得分（仅输出一个0-100的整数）`;

export interface FetchSummarySectionsParams {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  /** 每个 chunk 到达时回调（传入累积全文），用于流式渲染 */
  onChunk: (fullText: string) => void;
}

/**
 * 流式获取并解析四段总结。组合 streamSummary + parseSummarySections，
 * 调用方拿到结构化结果；onChunk 用于边收边渲染。
 */
export async function fetchSummarySections(params: FetchSummarySectionsParams): Promise<SummarySections> {
  const fullText = await streamSummary(params);
  return parseSummarySections(fullText);
}
