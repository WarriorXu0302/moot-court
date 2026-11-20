'use client';

// ===== Global audio player & TTS queue system =====
//
// Two playback modes:
// 1. enqueueTts  — AI continuous speech: queue and play one-by-one
// 2. interruptTts — user-triggered speech: stop current TTS, clear queue, play immediately
//
// Both modes coexist: user interrupt clears the AI queue and starts fresh.

let currentAudio: HTMLAudioElement | null = null;

// --- TTS queue (prefetch pipeline) ---
// 合成与播放解耦：入队后立即按并发窗口预合成（fetch /api/tts），
// 播放循环严格按序消费已就绪的音频。播放第 N 句时第 N+1..N+3 句正在并行合成，
// 消除"整段串行: 合成→播放→合成→播放"的壁钟累加卡顿。
type TtsTask = {
  text: string;
  speaker?: string;
  uid: string;
  resolve: () => void;
  status: 'pending' | 'synthesizing' | 'ready' | 'error';
  audioUri?: string;
  abort?: AbortController;
};

let ttsQueue: TtsTask[] = [];
let isPlayingTts = false;
const MAX_CONCURRENT_SYNTH = 3;

// Callback for UI to track who is speaking via TTS
let ttsSpeakerCallback: ((speaker: string | null) => void) | null = null;

export function setTtsSpeakerCallback(cb: ((speaker: string | null) => void) | null) {
  ttsSpeakerCallback = cb;
}

// Stop the currently playing audio
export function stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
}

export async function playAudio(url: string): Promise<void> {
  stopCurrentAudio();
  const audio = new Audio(url);
  currentAudio = audio;
  try {
    await audio.play();
    await new Promise<void>((resolve) => {
      audio.onended = () => {
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
      audio.onerror = () => {
        if (currentAudio === audio) currentAudio = null;
        resolve();
      };
    });
  } catch {
    if (currentAudio === audio) currentAudio = null;
  }
}

// Voice mapping for courtroom characters
const VOICE_MAP: Record<string, string> = {
  // 仲裁角色（须在通用键之前，且"被申请人代理人"须先于"申请人代理人"，"专家证人"须先于"证人"——getSpeakerVoice 按顺序做 includes 匹配）
  被申请人代理人: 'zh_female_vv_uranus_bigtts',
  申请人代理人: 'zh_male_taocheng_uranus_bigtts',
  首席仲裁员: 'zh_male_m191_uranus_bigtts',
  边裁甲: 'zh_male_taocheng_uranus_bigtts',
  边裁乙: 'zh_female_vv_uranus_bigtts',
  专家证人: 'zh_male_dayi_saturn_bigtts',
  仲裁秘书: 'zh_female_xiaohe_uranus_bigtts',
  审判长: 'zh_male_m191_uranus_bigtts',
  审判员: 'zh_male_m191_uranus_bigtts',
  法官: 'zh_male_m191_uranus_bigtts',
  公诉人: 'zh_male_taocheng_uranus_bigtts',
  辩护人: 'zh_female_vv_uranus_bigtts',
  律师: 'zh_female_vv_uranus_bigtts',
  被告人: 'zh_male_dayi_saturn_bigtts',
  被告: 'zh_male_dayi_saturn_bigtts',
  被害人: 'zh_female_xiaohe_uranus_bigtts',
  证人: 'zh_female_xiaohe_uranus_bigtts',
  书记员: 'zh_female_xiaohe_uranus_bigtts',
  陪审员甲: 'zh_male_taocheng_uranus_bigtts',
  陪审员乙: 'zh_female_vv_uranus_bigtts',
};

export function getSpeakerVoice(speaker?: string): string {
  if (!speaker) return 'zh_female_xiaohe_uranus_bigtts';
  for (const key of Object.keys(VOICE_MAP)) {
    if (speaker.includes(key)) return VOICE_MAP[key];
  }
  return 'zh_female_xiaohe_uranus_bigtts';
}

// Aliases for backward compatibility
export const stopAudio = stopCurrentAudio;
export const playAudioUri = playAudio;

// Internal: synthesize one sentence via TTS API, returns audioUri or null on failure
async function fetchTtsUri(text: string, speaker: string | undefined, uid: string, signal?: AbortSignal): Promise<string | null> {
  try {
    // 20s 合成超时兜底：防止 /api/tts 请求挂起导致任务永远停在 synthesizing、并发窗口被占满、队列永不 drain（页面假死）
    const res = await Promise.race([
      fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, uid, speaker: getSpeakerVoice(speaker) }),
        signal,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('tts-synth-timeout')), 20000)),
    ]);
    const data = await res.json();
    return data.audioUri || null;
  } catch {
    return null; // abort / network / timeout / API errors — caller treats as task error
  }
}

// Internal: fetch TTS audio and play it (does not manage queue)
async function fetchAndPlayTts(text: string, speaker?: string, uid = 'court-sim-user'): Promise<void> {
  const uri = await fetchTtsUri(text, speaker, uid);
  if (uri) await playAudio(uri);
}

// --- Prefetch pipeline: synthesis scheduler ---
// Keeps up to MAX_CONCURRENT_SYNTH tasks in-flight, scanning from the head so
// the earliest sentences become ready first. Called on enqueue / task completion.
function scheduleSynthesis() {
  let inFlight = 0;
  for (const t of ttsQueue) {
    if (t.status === 'synthesizing') inFlight++;
  }
  for (const task of ttsQueue) {
    if (inFlight >= MAX_CONCURRENT_SYNTH) break;
    if (task.status !== 'pending') continue;
    task.status = 'synthesizing';
    inFlight++;
    const ctrl = new AbortController();
    task.abort = ctrl;
    void (async () => {
      const uri = await fetchTtsUri(task.text, task.speaker, task.uid, ctrl.signal);
      if (task.status !== 'synthesizing') return; // interrupted meanwhile
      if (uri) {
        task.audioUri = uri;
        task.status = 'ready';
      } else {
        task.status = 'error';
      }
      task.abort = undefined;
      scheduleSynthesis(); // refill the window
      schedulePlayback();  // head task may just have become ready/error
    })();
  }
}

// --- Prefetch pipeline: ordered playback loop ---
// Plays ready tasks strictly in queue order; skips failed ones without blocking.
function schedulePlayback() {
  if (isPlayingTts) return;
  const head = ttsQueue[0];
  if (!head) return;
  if (head.status === 'pending' || head.status === 'synthesizing') return; // wait for synthesis callback
  if (head.status === 'error') {
    ttsQueue.shift();
    head.resolve();
    if (ttsQueue.length === 0 && ttsSpeakerCallback) ttsSpeakerCallback(null);
    schedulePlayback();
    return;
  }
  // head.status === 'ready'
  isPlayingTts = true;
  if (ttsSpeakerCallback) ttsSpeakerCallback(head.speaker || null);
  void (async () => {
    try {
      await playAudio(head.audioUri!);
    } finally {
      isPlayingTts = false;
      const finished = ttsQueue.shift();
      finished?.resolve();
      if (ttsQueue.length === 0 && ttsSpeakerCallback) ttsSpeakerCallback(null);
      schedulePlayback();  // next ready task
      scheduleSynthesis(); // window may now include newly enqueued tasks
    }
  })();
}

/**
 * Enqueue TTS for AI continuous speech.
 * Returns a Promise that resolves when THIS task's playback finishes.
 * Synthesis starts immediately (parallel prefetch window); playback is sequential.
 */
export function enqueueTts(text: string, speaker?: string, uid = 'court-sim-user'): Promise<void> {
  return new Promise<void>((resolve) => {
    ttsQueue.push({ text, speaker, uid, resolve, status: 'pending' });
    scheduleSynthesis();
    schedulePlayback();
  });
}

/**
 * Interrupt current TTS and clear the queue.
 * Use when user triggers a new action (e.g., sends a message, clicks next stage).
 * Aborts in-flight synthesis and resolves all pending queued tasks immediately.
 */
export function interruptTts(): void {
  stopCurrentAudio();
  const pending = ttsQueue;
  ttsQueue = [];
  isPlayingTts = false;
  pending.forEach((task) => {
    if (task.status === 'synthesizing') {
      task.status = 'error'; // make the async synth callback a no-op
      task.abort?.abort();
    }
    task.resolve();
  });
  if (ttsSpeakerCallback) ttsSpeakerCallback(null);
}

/**
 * User-triggered TTS: interrupt current queue and play immediately.
 * This is for user-initiated speech that should cut off any ongoing AI TTS.
 */
export async function speakTextImmediate(text: string, speaker?: string, uid = 'court-sim-user'): Promise<void> {
  interruptTts();
  if (ttsSpeakerCallback) ttsSpeakerCallback(speaker || null);
  try {
    await fetchAndPlayTts(text, speaker, uid);
  } finally {
    if (ttsSpeakerCallback) ttsSpeakerCallback(null);
  }
}

// Backward-compatible speakText — now uses the queue internally
export async function speakText(text: string, speaker?: string, uid = 'court-sim-user'): Promise<void> {
  await enqueueTts(text, speaker, uid);
}

// Check if TTS is currently playing
export function isTtsPlaying(): boolean {
  return isPlayingTts || ttsQueue.length > 0;
}

/**
 * 分句 TTS 流水线：流式输出过程中按句子边界即时送入 TTS 队列，
 * 让语音合成/播放与文字流式渲染并行，避免"文字显示完、语音还没合成"的卡顿。
 * 内部截断 LIFECYCLE 标签（含流式中的半截标签），标签内容不入队。
 */
export interface TtsSentenceFeeder {
  /** 流式中反复调用，传当前累积原文（可含 LIFECYCLE 标签，内部安全截断） */
  push(fullText: string): void;
  /** 流式结束调用，把剩余尾句送入队列 */
  flush(finalText: string): void;
}

export function createTtsSentenceFeeder(speaker: string | undefined, uid: string): TtsSentenceFeeder {
  const SENTENCE_ENDS = new Set(['。', '！', '？', '；', '!', '?', ';', '\n']);
  const LIFECYCLE_TAG = '<LIFECYCLE>';
  let fed = 0; // 已入队字符位置（基于原始全文坐标）
  let blocked = false; // 遇到完整 LIFECYCLE 标签后停止入队

  // 可安全用于 TTS 的文本上限：LIFECYCLE 标签起点（含流式中的半截标签前缀）
  function safeLimit(text: string): number {
    const idx = text.indexOf(LIFECYCLE_TAG);
    if (idx >= 0) return idx;
    const maxTail = Math.min(LIFECYCLE_TAG.length - 1, text.length);
    for (let k = maxTail; k >= 1; k--) {
      if (LIFECYCLE_TAG.startsWith(text.slice(-k))) return text.length - k;
    }
    return text.length;
  }

  function push(fullText: string): void {
    if (blocked) return;
    const limit = safeLimit(fullText);
    if (limit < fullText.length && fullText.indexOf(LIFECYCLE_TAG) >= 0) blocked = true;
    // 把 [fed, limit) 内所有完整句入队（TTS 队列串行播放，入队不阻塞）
    let start = fed;
    for (let i = fed; i < limit; i++) {
      if (SENTENCE_ENDS.has(fullText[i])) {
        const sentence = fullText.slice(start, i + 1).trim();
        start = i + 1;
        if (sentence.length >= 2) {
          enqueueTts(sentence, speaker, uid).catch(() => {});
        }
      }
    }
    fed = start;
  }

  function flush(finalText: string): void {
    const limit = safeLimit(finalText);
    const rest = finalText.slice(fed, limit).trim();
    fed = limit;
    if (rest) enqueueTts(rest, speaker, uid).catch(() => {});
  }

  return { push, flush };
}

/**
 * Wait for the TTS queue to be fully drained.
 * Returns immediately if queue is empty and nothing is playing.
 */
export function waitForTtsQueue(): Promise<void> {
  if (ttsQueue.length === 0 && !isPlayingTts) return Promise.resolve();
  return new Promise((resolve) => {
    const check = () => {
      if (ttsQueue.length === 0 && !isPlayingTts) {
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}

/**
 * Wait until the TTS queue backlog drops to maxBacklog items or fewer.
 * Unlike waitForTtsQueue (fully drained), this lets the next stage's text
 * streaming start while the trailing sentences of the previous stage are
 * still being played — voice lags text by at most ~maxBacklog sentences,
 * but the UI never sits idle waiting for long audio playback.
 */
export function waitForTtsQueueDrain(maxBacklog = 2): Promise<void> {
  const drained = () => ttsQueue.length <= maxBacklog;
  if (drained()) return Promise.resolve();
  return new Promise((resolve) => {
    // 90s 兜底：若音频播放/合成意外挂起（浏览器既不触发 onended 也不触发 onerror 等边缘情况），
    // 强制清场放行，避免阶段推进永久阻塞、页面假死
    const bailout = setTimeout(() => {
      interruptTts();
      resolve();
    }, 90000);
    const check = () => {
      if (drained()) {
        clearTimeout(bailout);
        resolve();
      } else {
        setTimeout(check, 100);
      }
    };
    check();
  });
}
