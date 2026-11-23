'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { getTaskHint } from '@/lib/task-hints';
import { useAppStore } from '@/lib/store';
import { useDraggableFab } from '@/hooks/use-draggable-fab';
import { X, CheckSquare, GripVertical, ListTodo } from 'lucide-react';

const AUTO_CLOSE_MS = 20000;

interface DragState {
  dragging: boolean;
  moved: boolean;
}

export function TaskHint() {
  const pathname = usePathname();
  const caseType = useAppStore((st) => st.selectedCase?.caseType);
  // 收起态圆点可拖动，位置记在本地
  const dot = useDraggableFab<HTMLButtonElement>('task-hint');
  const hint = getTaskHint(pathname, caseType);
  const [visible, setVisible] = useState(false);
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

  // 收起后在圆点旁提示"在这里重新打开"，前 3 次收起都提示（之后用户已知道位置）
  const [reopenTip, setReopenTip] = useState(false);
  const closeToDot = useCallback(() => {
    setVisible(false);
    let n = 0;
    try { n = Number(localStorage.getItem('task-hint-reopen-tips') || '0'); } catch { /* ignore */ }
    if (n < 3) {
      setReopenTip(true);
      try { localStorage.setItem('task-hint-reopen-tips', String(n + 1)); } catch { /* ignore */ }
      setTimeout(() => setReopenTip(false), 6000);
    }
  }, []);

  // 自动收起倒计时：每秒更新显示的秒数（原先文案写死"20 秒"，数字不动）；
  // 鼠标停在卡片上或正在拖动时暂停，读完再走
  const [secondsLeft, setSecondsLeft] = useState(AUTO_CLOSE_MS / 1000);
  const hoverRef = useRef(false);
  useEffect(() => {
    if (!visible) return;
    setSecondsLeft(AUTO_CLOSE_MS / 1000);
    const id = setInterval(() => {
      if (dragRef.current.dragging || hoverRef.current) return;
      setSecondsLeft((n) => n - 1);
    }, 1000);
    return () => clearInterval(id);
  }, [visible]);
  useEffect(() => {
    // 收起时把倒计时复位：否则下次点圆点重新打开的同一轮渲染里读到的还是 0，卡片会立刻又被收起
    if (visible && secondsLeft <= 0) { setSecondsLeft(AUTO_CLOSE_MS / 1000); closeToDot(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, visible]);


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
  }, [clampPos]);

  // 页面上有弹窗（Dialog / AlertDialog / Sheet）打开时，提示框自动收起、圆点降到弹窗遮罩之下，
  // 不再盖住用户正在读的弹窗内容。Radix 弹窗挂在 body 下，带 role=dialog|alertdialog 与 data-state=open。
  const [modalOpen, setModalOpen] = useState(false);
  useEffect(() => {
    const check = () => setModalOpen(!!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
    check();
    const mo = new MutationObserver(check);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state'] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => { if (modalOpen) setVisible(false); }, [modalOpen]);

  if (!hint) return null;

  // 收起态：右下角一个小按钮。原先关闭后提示就彻底消失、无法找回，用户只能离开页面再回来才能再看一次；
  // 同时这个按钮很小，不会像展开的卡片那样盖住卷宗等内容。

  if (!visible) {
    return (
      <button
        type="button"
        ref={dot.ref}
        {...dot.handlers}
        style={dot.style}
        onClick={dot.guardClick(() => { setReopenTip(false); setVisible(true); })}
        aria-label={`查看「${hint.title}」的任务提示（可拖动）`}
        title="本环节任务提示；按住可拖到别处"
        className="fixed bottom-[8.5rem] right-6 z-40 flex h-9 w-9 touch-none select-none cursor-grab active:cursor-grabbing items-center justify-center rounded-full border bg-card/95 text-muted-foreground shadow-md backdrop-blur transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ListTodo className="h-4 w-4" />
        {reopenTip && (
          <>
            <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-primary/30" aria-hidden />
            <span role="status" className="pointer-events-none absolute right-full top-1/2 mr-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-lg">
              任务提示收到这里了，点这个圆点可重新打开 →
            </span>
          </>
        )}
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
      className="fixed z-40 max-w-sm animate-in slide-in-from-bottom-5 duration-300"
      style={style}
    >
      <div
        // select-none：拖动时不再选中卡片里的文字（原先一拖就蓝色高亮并弹出浏览器划词工具栏）
        className="rounded-lg border bg-card/95 backdrop-blur-md shadow-lg p-4 space-y-2.5 cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerEnter={() => { hoverRef.current = true; }}
        onPointerLeave={() => { hoverRef.current = false; }}
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
            onClick={closeToDot}
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
            {secondsLeft} 秒后收起到右下角圆点（鼠标停在这里会暂停），点圆点可重新打开；按住卡片可拖动
          </span>
        </div>
      </div>
    </div>
  )
}
