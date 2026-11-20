'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { interruptTts } from '@/lib/audio';

// ===== 统一语音输入 Hook =====
//
// 链路：MediaRecorder 录音 → decodeAudioData → 重采样为 16kHz 单声道 WAV
//      → base64 → POST /api/asr（coze-coding-dev-sdk ASRClient）
//
// 为什么不用浏览器 SpeechRecognition：
//   Chrome 的 Web Speech API 把音频送到 Google 语音服务器识别，国内不可达。
//
// 为什么要转 WAV：
//   ASRClient 只接受 WAV/MP3/M4A/OGG OPUS，而 MediaRecorder 在 Chrome 下
//   默认产出 webm/opus，不在支持列表内。这里统一在浏览器侧解码后重编码为 WAV。
//
// 注意：ASRClient 是整段识别、非流式，所以交互是「点击录音 → 点击停止 → 出文字」，
//      没有 interimResults 那种边说边上屏的效果。
//
// 用法：
//   const { isRecording, isTranscribing, toggle } = useSpeechInput({
//     uid: 'court-sim-user',
//     onResult: (text) => handleSendMessage(text),   // ← 一定要传参，别依赖 input state
//     onError: (msg) => toast.error(msg),
//   });

const TARGET_SAMPLE_RATE = 16000;

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

export type SpeechInputStatus = 'idle' | 'recording' | 'transcribing';

export interface UseSpeechInputOptions {
  /** 识别成功回调。务必用参数接收文本，不要回读组件里的 input state。 */
  onResult: (text: string) => void;
  /** 失败回调（不支持/无权限/太短/没识别到/接口报错）。建议接 sonner toast。 */
  onError?: (message: string) => void;
  /** 传给 /api/asr 的用户标识 */
  uid?: string;
  /** 超过此时长自动停止并识别，默认 60s */
  maxDurationMs?: number;
  /** 短于此时长直接丢弃（误触保护），默认 500ms */
  minDurationMs?: number;
  /** 开始录音前打断正在播放的 TTS，默认 true（避免麦克风收到外放的 AI 配音） */
  interruptTtsOnStart?: boolean;
}

export interface UseSpeechInputResult {
  status: SpeechInputStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  /** 浏览器是否具备录音能力（挂载后才为真，避免 hydration 不一致） */
  isSupported: boolean;
  start: () => Promise<void>;
  /** 停止并识别 */
  stop: () => void;
  /** 停止并丢弃（用户主动取消） */
  cancel: () => void;
  /** 录音中则停止识别，空闲则开始 */
  toggle: () => void;
}

// ---------- 音频工具函数 ----------

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Float32 PCM → 16bit 单声道 WAV */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk 长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('音频编码失败'));
        return;
      }
      // 去掉 `data:audio/wav;base64,` 前缀，服务端要的是纯 base64
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('音频编码失败'));
    reader.readAsDataURL(blob);
  });
}

/** 任意录音 Blob → 16kHz 单声道 WAV 的 base64 */
async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();

  const AudioCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtor) throw new Error('当前浏览器不支持音频处理');

  const ctx = new AudioCtor();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer);
  } finally {
    void ctx.close();
  }

  // 用 OfflineAudioContext 做重采样 + 声道下混
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return blobToBase64(encodeWav(rendered.getChannelData(0), TARGET_SAMPLE_RATE));
}

// ---------- Hook ----------

export function useSpeechInput(
  options: UseSpeechInputOptions,
): UseSpeechInputResult {
  const [status, setStatus] = useState<SpeechInputStatus>('idle');
  const [isSupported, setIsSupported] = useState(false);

  // 所有 options 走 ref：回调里读到的永远是最新的 onResult / onError，
  // 不会出现「录音时捕获的旧闭包」这类问题。
  const optionsRef = useRef(options);
  const statusRef = useRef<SpeechInputStatus>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelledRef = useRef(false);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 挂载后再判断，避免 SSR / hydration 不一致
  useEffect(() => {
    setIsSupported(
      typeof MediaRecorder !== 'undefined' &&
        typeof navigator !== 'undefined' &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        !!pickMimeType(),
    );
  }, []);

  const updateStatus = useCallback((next: SpeechInputStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  /** 释放麦克风，去掉浏览器标签页上的录音红点 */
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const handleStop = useCallback(async () => {
    clearTimer();
    releaseStream();

    const chunks = chunksRef.current;
    chunksRef.current = [];
    const elapsed = Date.now() - startedAtRef.current;

    if (cancelledRef.current) {
      updateStatus('idle');
      return;
    }

    const minMs = optionsRef.current.minDurationMs ?? 500;
    if (chunks.length === 0 || elapsed < minMs) {
      updateStatus('idle');
      optionsRef.current.onError?.('说话时间太短，请重试');
      return;
    }

    updateStatus('transcribing');
    try {
      const base64Data = await blobToWavBase64(
        new Blob(chunks, { type: chunks[0].type }),
      );

      const res = await fetch('/api/asr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: optionsRef.current.uid ?? 'court-sim-user',
          base64Data,
        }),
      });

      const data: { text?: string; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      // 识别过程中用户点了取消
      if (cancelledRef.current) return;

      const text = (data.text ?? '').trim();
      if (!text) {
        optionsRef.current.onError?.('没有识别到内容，请重试');
        return;
      }
      optionsRef.current.onResult(text);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : '语音识别失败，请重试';
      optionsRef.current.onError?.(message);
    } finally {
      updateStatus('idle');
    }
  }, [clearTimer, releaseStream, updateStatus]);

  const stop = useCallback(() => {
    if (statusRef.current !== 'recording') return;
    clearTimer();
    recorderRef.current?.stop(); // → onstop → handleStop
  }, [clearTimer]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    if (statusRef.current === 'recording') {
      recorderRef.current?.stop();
    }
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (statusRef.current !== 'idle') return;

    if (
      typeof MediaRecorder === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      optionsRef.current.onError?.('当前浏览器不支持录音，请使用 Chrome 或 Edge');
      return;
    }

    const mimeType = pickMimeType();
    if (!mimeType) {
      optionsRef.current.onError?.('当前浏览器不支持录音编码，请更换浏览器');
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch {
      optionsRef.current.onError?.(
        '无法访问麦克风，请在浏览器地址栏授予麦克风权限后重试',
      );
      return;
    }

    // 打断 AI 配音，避免外放的 TTS 被麦克风收进去
    if (optionsRef.current.interruptTtsOnStart !== false) {
      interruptTts();
    }

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    streamRef.current = stream;
    chunksRef.current = [];
    cancelledRef.current = false;
    startedAtRef.current = Date.now();

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      clearTimer();
      releaseStream();
      chunksRef.current = [];
      updateStatus('idle');
      optionsRef.current.onError?.('录音出错，请重试');
    };
    recorder.onstop = () => {
      void handleStop();
    };

    recorder.start();
    updateStatus('recording');

    const maxMs = optionsRef.current.maxDurationMs ?? 60_000;
    timerRef.current = window.setTimeout(() => {
      if (statusRef.current === 'recording') {
        recorderRef.current?.stop();
      }
    }, maxMs);
  }, [clearTimer, handleStop, releaseStream, updateStatus]);

  const toggle = useCallback(() => {
    if (statusRef.current === 'recording') {
      stop();
    } else if (statusRef.current === 'idle') {
      void start();
    }
    // transcribing 期间忽略点击
  }, [start, stop]);

  // 卸载时收尾：丢弃结果并释放麦克风
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state === 'recording') recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return {
    status,
    isRecording: status === 'recording',
    isTranscribing: status === 'transcribing',
    isSupported,
    start,
    stop,
    cancel,
    toggle,
  };
}
