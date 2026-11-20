'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store';
import type { ChatMessage } from '@/lib/types';

/**
 * 环节对话采集 Hook——把本环节的实时对话快照写入全局学习记录（stageDialogues），
 * 并在进入环节时记录一条行为轨迹。
 *
 * 用法（业务页内一行）：
 *   useStageDialogueLogger('案例详情查看', messages);
 *   useStageDialogueLogger('辩护词撰写·量刑协商通话', phoneMessages); // 可选的子对话
 *
 * 结束分析 / 保存学习记录时会遍历这些对话快照，确保任何未完成点评的环节对话也不丢失。
 */
export function useStageDialogueLogger(pageName: string, messages: ChatMessage[]) {
  const upsertStageDialogue = useAppStore((s) => s.upsertStageDialogue);
  const appendBehavior = useAppStore((s) => s.appendBehavior);
  const enteredRef = useRef(false);

  // 进入环节 → 行为轨迹（一次）
  useEffect(() => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    appendBehavior(`进入「${pageName}」环节`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 对话变化 → 实时快照（引用防护：同一数组引用不重复写入，
  // 防止调用方传内联字面量数组时 effect 每次渲染都触发）
  const lastMessagesRef = useRef<ChatMessage[] | null>(null);
  useEffect(() => {
    if (lastMessagesRef.current === messages) return;
    lastMessagesRef.current = messages;
    upsertStageDialogue(pageName, messages);
  }, [pageName, messages, upsertStageDialogue]);
}
