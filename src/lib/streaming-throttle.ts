/**
 * 流式文本 setState 节流器
 *
 * 背景：SSE 流式循环中每个 chunk（1-3 字）直接 setStreamingText 会导致
 * React 每 chunk 全量重渲染（含 ReactMarkdown 重解析），文本越长主线程越卡。
 * 本工具将 setState 频率节流到固定节奏（默认 50ms ≈ 20fps），
 * 人眼观感完全流畅，渲染成本降为原来的 1/5 ~ 1/10。
 */
export interface ThrottledStreamSetter {
  /** 流式循环中调用：提交最新完整文本（按节奏渲染） */
  push: (fullText: string) => void;
  /** 流式结束时调用：立即渲染最终文本并清理定时器（幂等） */
  flushNow: () => void;
  /** 组件卸载/中断时调用：丢弃未渲染内容并清理定时器 */
  cancel: () => void;
}

export function createThrottledStreamSetter(
  setter: (text: string) => void,
  intervalMs = 50,
): ThrottledStreamSetter {
  let pending: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;

  const flush = () => {
    timer = null;
    lastFlushAt = Date.now();
    if (pending !== null) {
      const text = pending;
      pending = null;
      setter(text);
    }
  };

  return {
    push(fullText: string) {
      pending = fullText;
      if (timer) return; // 已有定时器在排队，届时会渲染最新 pending
      const elapsed = Date.now() - lastFlushAt;
      if (elapsed >= intervalMs) {
        flush();
      } else {
        timer = setTimeout(flush, intervalMs - elapsed);
      }
    },
    flushNow() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      flush();
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
