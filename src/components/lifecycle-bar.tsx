"use client";

import { CaseLifecycleTimeline } from "@/components/case-lifecycle-timeline";
import { useAppStore } from "@/lib/store";

/**
 * 共享生命周期栏 — 从 store 读取 lifecycle 数据和加载状态
 * 显隐由标题栏的「生命周期」按钮控制（store.lifecycleVisible）
 */
export function LifecycleBar() {
  const lifecycle = useAppStore((s) => s.lifecycle);
  const lifecycleLoading = useAppStore((s) => s.lifecycleLoading);
  const lifecycleVisible = useAppStore((s) => s.lifecycleVisible);

  if (!lifecycleVisible) return null;

  return <CaseLifecycleTimeline lifecycle={lifecycle} loading={lifecycleLoading} />;
}
