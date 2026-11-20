'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { interruptTts } from '@/lib/audio';
import { blobToWavBase64 } from '@/lib/audio-wav';

interface PressTalkOptions {
  /** 用户标识，传给 /api/asr */
  uid: string;
  /** 识别出的文本回调（页面自行决定是否发送） */
  onText: (text: string) => void;
}

/**
 * 健壮的“长按说话”录音 hook（MediaRecorder → /api/asr 整段识别）。
 *
 * 修复的问题：
 * 1. 竞态：getUserMedia 耗时数百毫秒，用户提前松手会导致录音挂起。
 *    → pendingRef 标记，取消时若流未建立，建立后立即清理。
 * 2. 数据丢失：部分浏览器 stop 前不产出 ondataavailable。
 *    → rec.start(250) 定时产出音频分片。
 * 3. 移动端长按弹上下文菜单/页面滚动中断指针流。
 *    → pressHandlers 提供 onPointerCancel + onContextMenu 阻止。
 * 4. 流泄漏：任何退出路径都 stop 全部 track。
 */
export function usePressTalk({ uid, onText }: PressTalkOptions) {
  const [isRecording, setIsRecording] = useState(false);
  const [asrLoading, setAsrLoading] = useState(false);

  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const pendingRef = useRef(false); // 用户按下但尚未建立
  const activeRef = useRef(false); // 录音真正进行中
  const cancelledRef = useRef(false); // 按下期间被取消
  const onTextRef = useRef(onText);
  onTextRef.current = onText;
  const uidRef = useRef(uid);
  uidRef.current = uid;

  const cleanupStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      streamRef.current = null;
    }
  }, []);

  const stopRecording = useCallback(() => {
    pendingRef.current = false;
    setIsRecording(false);
    if (!activeRef.current) {
      cancelledRef.current = true; // 流尚未建立，标记待清理
      cleanupStream();
      return;
    }
    activeRef.current = false;
    const rec = recRef.current;
    if (rec && rec.state !== 'inactive') {
      try {
        rec.stop();
      } catch {
        cleanupStream();
      }
    } else {
      cleanupStream();
    }
  }, [cleanupStream]);

  const startRecording = useCallback(async () => {
    if (activeRef.current || pendingRef.current) return; // 防重入
    pendingRef.current = true;
    cancelledRef.current = false;
    setIsRecording(true);
    interruptTts();
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      pendingRef.current = false;
      setIsRecording(false);
      return;
    }
    // 等待期间用户已松手：立即释放流，不开始录音
    if (!pendingRef.current) {
      stream.getTracks().forEach((t: MediaStreamTrack) => t.stop());
      return;
    }
    streamRef.current = stream;
    chunksRef.current = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream);
    } catch {
      pendingRef.current = false;
      setIsRecording(false);
      cleanupStream();
      return;
    }
    recRef.current = rec;
    rec.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      cleanupStream();
      const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || 'audio/webm' });
      chunksRef.current = [];
      if (blob.size < 200) return; // 过短，忽略
      setAsrLoading(true);
      (async () => {
        try {
          // /api/asr 不支持 webm：先转 16kHz 单声道 WAV
          const base64 = await blobToWavBase64(blob);
          const resp = await fetch('/api/asr', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uid: uidRef.current || 'guest', base64Data: base64 }),
          });
          const data = await resp.json();
          if (data && typeof data.text === 'string' && data.text.trim()) {
            onTextRef.current(data.text.trim());
          }
        } catch {
          // 识别失败静默，asrLoading 复位即可
        } finally {
          setAsrLoading(false);
        }
      })();
    };
    try {
      rec.start(250); // 定时产出分片，规避 stop 时不 flush
      activeRef.current = true;
    } catch {
      pendingRef.current = false;
      setIsRecording(false);
      cleanupStream();
    }
  }, [cleanupStream]);

  // 页面卸载兜底：停止录音并释放设备
  useEffect(() => {
    return () => {
      pendingRef.current = false;
      activeRef.current = false;
      try {
        if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop();
      } catch {
        // ignore
      }
      cleanupStream();
    };
  }, [cleanupStream]);

  /** 直接展开到按钮上：<Button {...pressHandlers} className="select-none touch-none" /> */
  const pressHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      void startRecording();
    },
    onPointerUp: (e: React.PointerEvent) => {
      e.preventDefault();
      stopRecording();
    },
    onPointerLeave: () => {
      if (activeRef.current || pendingRef.current) stopRecording();
    },
    onPointerCancel: () => {
      if (activeRef.current || pendingRef.current) stopRecording();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault(); // 阻止移动端长按弹出菜单
    },
  };

  return { isRecording, asrLoading, pressHandlers, startRecording, stopRecording };
}
