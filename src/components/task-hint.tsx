'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { getTaskHint } from '@/lib/task-hints';
import { X, CheckSquare, GripVertical, ListTodo } from 'lucide-react';

const AUTO_CLOSE_MS = 20000;

interface DragState {
  dragging: boolean;
  moved: boolean;
}

export function TaskHint() {
  const pathname = usePathname();
  const hint = getTaskHint(pathname);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHintTitleRef = useRef<string | null>(null);

  // ---- Draggable position (persisted per session) ----
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<DragState>({ dragging: false, moved: false });
  const offsetRef = useRef({ x: 0, y: 0 });
  const posRef = useRef<{ x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (hint) {
      if (prevHintTitleRef.current !== hint.title) {
        prevHintTitleRef.current = hint.title;
        setVisible(true);
      }
    } else {
      prevHintTitleRef.current = null;
      setVisible(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (visible && !dragRef.current.dragging) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setVisible(false);
      }, AUTO_CLOSE_MS);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [visible]);

  // ---- Drag handlers (pointer events; direct DOM writes during drag, commit once on release) ----
  const clampPos = useCallback((x: number, y: number): { x: number; y: number } => {
    const w = boxRef.current?.offsetWidth ?? 320;
    const h = boxRef.current?.offsetHeight ?? 200;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1440;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 900;
    // position stored as top-left coords; keep fully on-screen with 8px margin
    return {
      x: Math.min(Math.max(x, 8), Math.max(vw - w - 8, 8)),
      y: Math.min(Math.max(y, 8), Math.max(vh - h - 8, 8)),
    };
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return; // let close button work
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    offsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    dragRef.current = { dragging: true, moved: false };
    // 立即切换为 left/top 定位（清除 right/bottom），后续移动直接写 style，不触发 React 渲染
    box.style.right = 'auto';
    box.style.bottom = 'auto';
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.willChange = 'left, top';
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (timerRef.current) clearTimeout(timerRef.current); // pause auto-close while dragging
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    const box = boxRef.current;
    if (!box) return;
    const next = clampPos(e.clientX - offsetRef.current.x, e.clientY - offsetRef.current.y);
    dragRef.current.moved = true;
    posRef.current = next; // 镜像最新位置，防拖拽期间偶发重渲染导致回跳
    box.style.left = `${next.x}px`;
    box.style.top = `${next.y}px`;
  }, [clampPos]);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    dragRef.current.dragging = false;
    const box = boxRef.current;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (box) {
      box.style.willChange = '';
      // 松手时一次性提交最终位置到 React（整个拖拽过程仅此一次重渲染）
      setPos(clampPos(parseFloat(box.style.left), parseFloat(box.style.top)));
    }
    // restart auto-close countdown after drag
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), AUTO_CLOSE_MS);
  }, [clampPos]);

  if (!hint) return null;

  // 收起态：右下角一个小按钮。原先关闭后提示就彻底消失、无法找回，用户只能离开页面再回来才能再看一次；
  // 同时这个按钮很小，不会像展开的卡片那样盖住卷宗等内容。
  if (!visible) {
    return (
      <button
        type="button"
        onClick={() => setVisible(true)}
        aria-label={`查看「${hint.title}」的任务提示`}
        title="本环节任务提示"
        className="fixed bottom-[8.5rem] right-6 z-[60] flex h-9 w-9 items-center justify-center rounded-full border bg-card/95 text-muted-foreground shadow-md backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ListTodo className="h-4 w-4" />
      </button>
    );
  }

  const live = dragRef.current.dragging && posRef.current ? posRef.current : pos;
  const style: React.CSSProperties = live
    ? { left: live.x, top: live.y }
    // 默认停靠在 AI 助手悬浮球正上方（球顶96px+光圈阴影~15px+间隙25px=136px），垂直错开永不遮挡悬浮球
    : { right: '1.5rem', bottom: '8.5rem' };

  return (
    <div
      ref={boxRef}
      className="fixed z-[60] max-w-sm animate-in slide-in-from-bottom-5 duration-300"
      style={style}
    >
      <div
        className="rounded-lg border bg-card/95 backdrop-blur-md shadow-lg p-4 space-y-2.5 cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground/40 shrink-0" aria-hidden />
          <CheckSquare className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-bold text-foreground">{hint.title}</span>
          <button
            onClick={() => setVisible(false)}
            className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
            aria-label="关闭提示"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {hint.tasks.map((task, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary/50" aria-hidden />
              <span className="text-xs leading-relaxed text-muted-foreground">{task}</span>
            </div>
          ))}
        </div>
        <div className="pt-1.5 border-t">
          <span className="text-[11px] text-muted-foreground/70">
            20 秒后收起，可随时从右下角圆点重新打开；标题处可拖动
          </span>
        </div>
      </div>
    </div>
  )
}
