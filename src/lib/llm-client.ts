import { LLMClient as SdkLLMClient, Config } from 'coze-coding-dev-sdk';

/**
 * 统一的服务端 LLM 客户端。
 *
 * - 配置了 LLM_API_KEY + LLM_BASE_URL + LLM_MODEL 时，走 OpenAI 兼容接口（/v1/chat/completions，SSE 流式）；
 * - 任一缺失则回落到平台 SDK（豆包），行为与改造前完全一致，不会因为没配置而中断服务。
 *
 * 对外只暴露 `stream(messages, options)`，返回带 `.content` 的异步迭代器——与 SDK 的 `LLMClient.stream`
 * 同形状，所以各调用点只需替换构造方式，业务逻辑不用动。
 *
 * 密钥只在服务端读取，永远不会返回给浏览器。
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  /** 仅 SDK 回落时使用；自定义接口一律用 LLM_MODEL，避免前端传来的豆包模型名被原样转发而 403 */
  model?: string;
  temperature?: number;
  [extra: string]: unknown;
}

export interface StreamChunk {
  content?: string;
}

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** 读取自定义 LLM 配置；三项缺一则返回 null（表示回落到 SDK）。 */
export function getCustomLlmConfig(): LlmConfig | null {
  const apiKey = process.env.LLM_API_KEY?.trim();
  const baseUrl = process.env.LLM_BASE_URL?.trim().replace(/\/+$/, '');
  const model = process.env.LLM_MODEL?.trim();
  if (!apiKey || !baseUrl || !model) return null;
  return { apiKey, baseUrl, model };
}

export function isCustomLlmEnabled(): boolean {
  return getCustomLlmConfig() !== null;
}

/** 单次请求的整体超时：模型首字可能要 5 秒以上，长文生成更久，给足余量但不无限等。 */
const REQUEST_TIMEOUT_MS = 280_000;

async function* streamOpenAiCompatible(
  cfg: LlmConfig,
  messages: ChatMessage[],
  options: StreamOptions,
): AsyncGenerator<StreamChunk> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        temperature: options.temperature ?? 0.7,
      }),
      signal: controller.signal,
    });

    if (!res.ok || !res.body) {
      // 只透出状态码与服务端给出的错误信息，不回显请求头/密钥
      let detail = '';
      try {
        const j = (await res.json()) as { error?: { message?: string } };
        detail = j?.error?.message ? `：${j.error.message}` : '';
      } catch {
        /* 响应不是 JSON */
      }
      throw new Error(`LLM 接口返回 ${res.status}${detail}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔；一个 chunk 可能含多个事件，也可能只含半个
      const events = buffer.split('\n');
      buffer = events.pop() ?? '';
      for (const line of events) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') return;
        let json: { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // 半截 JSON：等下一块
        }
        if (json.error?.message) throw new Error(`LLM 流式错误：${json.error.message}`);
        const piece = json.choices?.[0]?.delta?.content;
        if (piece) yield { content: piece };
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

export class LLMClient {
  private readonly sdk: SdkLLMClient | null;
  private readonly custom: LlmConfig | null;

  /** @param forwardHeaders 回落 SDK 时需要的平台转发头；走自定义接口时忽略 */
  constructor(forwardHeaders?: Record<string, string>) {
    this.custom = getCustomLlmConfig();
    this.sdk = this.custom ? null : new SdkLLMClient(new Config(), forwardHeaders);
  }

  stream(messages: ChatMessage[], options: StreamOptions = {}): AsyncIterable<StreamChunk> {
    if (this.custom) return streamOpenAiCompatible(this.custom, messages, options);
    // 回落：保持原有的 SDK 参数（模型默认值、关闭 thinking 等）
    return this.sdk!.stream(
      messages as never,
      { model: 'doubao-seed-2-0-pro-260215', thinking: 'disabled', streaming: true, ...options } as never,
    ) as unknown as AsyncIterable<StreamChunk>;
  }
}
