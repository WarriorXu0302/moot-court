'use client';

/**
 * 让右下角悬浮按钮（"问 AI"、任务提示圆点）可以拖动，并记住位置。
 *
 * - 拖动超过 5px 才算拖动，松手后吞掉这次 click，不会误打开面板；轻点仍是点击。
 * - 拖动期间直接写 style，不触发 React 渲染（与 task-hint 展开卡片的做法一致）；松手才提交位置。
 * - 位置存 localStorage（按 key 区分），窗口缩放后自动夹回可视区。
 * - 未拖动过时返回 null 位置，按钮保持原来的 CSS 定位（right/bottom）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type React from 'react';

type Pos = { x: number; y: number };
const MARGIN = 8;
const DRAG_THRESHOLD = 5;

function clamp(p: Pos, w: number, h: number): Pos {
  return {
    x: Math.min(Math.max(p.x, MARGIN), Math.max(window.innerWidth - w - MARGIN, MARGIN)),
    y: Math.min(Math.max(p.y, MARGIN), Math.max(window.innerHeight - h - MARGIN, MARGIN)),
  };
}

export function useDraggableFab<T extends HTMLElement>(storageKey: string) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const drag = useRef<{ startX: number; startY: number; offX: number; offY: number; moved: boolean; active: boolean }>({
    startX: 0, startY: 0, offX: 0, offY: 0, moved: false, active: false,
  });
  const suppressClick = useRef(false);

  // 读取已保存的位置（仅客户端挂载后，避免 hydration 不一致）
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`fab-pos:${storageKey}`);
      if (raw) {
        const p = JSON.parse(raw) as Pos;
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) setPos(p);
      }
    } catch { /* ignore */ }
  }, [storageKey]);

  // 窗口变小时把按钮夹回可视区
  useEffect(() => {
    if (!pos) return;
    const onResize = () => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos((p) => (p ? clamp(p, r.width, r.height) : p));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [pos]);

  const onPointerDown = useCallback((e: React.PointerEvent<T>) => {
    if (e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    drag.current = { startX: e.clientX, startY: e.clientY, offX: e.clientX - r.left, offY: e.clientY - r.top, moved: false, active: true };
    // 按下即捕获指针：快速拖动时鼠标会先离开按钮，不捕获的话后续 pointermove 不会派发给按钮（实测拖不动）。
    // 捕获后 click 仍正常派发到按钮，轻点不受影响。
    try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const d = drag.current;
    const el = ref.current;
    if (!d.active || !el) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_THRESHOLD) return;
      d.moved = true;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.willChange = 'left, top';
    }
    const r = el.getBoundingClientRect();
    const next = clamp({ x: e.clientX - d.offX, y: e.clientY - d.offY }, r.width, r.height);
    el.style.left = `${next.x}px`;
    el.style.top = `${next.y}px`;
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<T>) => {
    const d = drag.current;
    const el = ref.current;
    d.active = false;
    if (!d.moved || !el) return;
    try { el.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    el.style.willChange = '';
    const next = { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
    setPos(next);
    try { localStorage.setItem(`fab-pos:${storageKey}`, JSON.stringify(next)); } catch { /* ignore */ }
    suppressClick.current = true;
  }, [storageKey]);

  /** 包一层 onClick：刚拖完的那次 click 不执行 */
  const guardClick = useCallback(<A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    fn(...args);
  }, []);

  const style: React.CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;

  return {
    ref,
    style,
    /** 拖过之后的位置；面板打开时可据此决定展开方向 */
    pos,
    guardClick,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
