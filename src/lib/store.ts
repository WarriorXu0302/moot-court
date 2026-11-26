'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ThemeName, FontName, FontSize, UserRole, User, LearningRecordEntry, StageDialogueEntry, ChatMessage, CaseData, CaseLifecycle, Annotation } from './types';

/** 文书类型中文名（行为轨迹展示用） */
const DOC_TYPE_LABELS: Record<string, string> = {
  defense: '辩护词',
  indictment: '刑事起诉书',
  prosecution: '公诉意见书',
  plan: '庭审提纲',
  finalJudge: '刑事判决书',
  judge: '判决书',
};

interface AppState {
  // Theme settings
  theme: ThemeName;
  font: FontName;
  fontSize: FontSize;
  ttsEnabled: boolean;
  voiceMode: boolean; // true = voice interaction, false = text interaction

  // 登录态是否已从 localStorage 恢复完毕（不持久化）。页面守卫必须等它为 true 再判断 user，
  // 否则 hydration 那一帧 user 还是初始值 null，会把已登录用户误判为未登录并弹回首页。
  hydrated: boolean;

  // User
  user: User | null;
  selectedRole: UserRole | null;
  selectedCase: CaseData | null;

  // Learning records (per session)
  learningRecords: LearningRecordEntry[];

  // 实时采集：各环节对话快照 + 用户行为轨迹（计入学习记录，供结束分析遍历全部环节）
  stageDialogues: StageDialogueEntry[];
  behaviorLog: ChatMessage[];

  // Documents
  documents: Record<string, string>; // docType -> content

  // Page flow state for defender route
  defenderStep: number;

  // Case lifecycle timeline (AI-generated, updated during conversation)
  lifecycle: CaseLifecycle | null;
  lifecycleLoading: boolean;
  lifecycleVisible: boolean;
  /** 偏好：案情研读页答完一道思考题后是否自动切到下一题（默认否，需手动点「下一题」） */
  questionAutoAdvance: boolean;

  // Case file annotations (persist across page navigation within session)
  caseAnnotations: Annotation[];
  /**
   * 庭审各阶段的进度快照（key = 阶段名，如"庭审调查"）：从下一步点「上一步」回来时恢复笔录与环节位置，
   * 原先回到庭审页一切从头开始，之前的发言痕迹全部丢失。只存内存，随本次训练结束清空。
   */
  hearingProgress: Record<string, { messages: ChatMessage[]; stageIdx: number }>;
  saveHearingProgress: (key: string, p: { messages: ChatMessage[]; stageIdx: number }) => void;

  // Document evaluation progress (AI样例解锁依据): `${caseId}:${docType}` -> { evalCount, bestScore }
  docProgress: Record<string, { evalCount: number; bestScore: number }>;

  // 本次学习开始时间（毫秒时间戳）：选择案例点击「进入训练」时记录，结束分析时计算学习时长并清除
  trainingStartTime: number | null;

  // Actions
  setTheme: (t: ThemeName) => void;
  setFont: (f: FontName) => void;
  setFontSize: (s: FontSize) => void;
  setTtsEnabled: (v: boolean) => void;
  setVoiceMode: (v: boolean) => void;
  setUser: (u: User | null) => void;
  login: (u: Partial<User> & { id: string }) => void;
  logout: () => void;
  setSelectedRole: (r: UserRole | null) => void;
  setSelectedCase: (c: CaseData | null) => void;
  addLearningRecord: (r: LearningRecordEntry) => void;
  upsertStageDialogue: (pageName: string, conversations: ChatMessage[]) => void;
  appendBehavior: (action: string, detail?: string) => void;
  setDocument: (type: string, content: string) => void;
  setDefenderStep: (s: number) => void;
  setLifecycle: (l: CaseLifecycle | null) => void;
  setLifecycleLoading: (v: boolean) => void;
  toggleLifecycleVisible: () => void;
  setQuestionAutoAdvance: (v: boolean) => void;
  setLifecycleVisible: (v: boolean) => void;
  addCaseAnnotation: (a: Annotation) => void;
  removeCaseAnnotation: (id: string) => void;
  clearCaseAnnotations: () => void;
  recordDocEval: (caseId: string, docType: string, score: number | null) => void;
  setTrainingStartTime: (t: number | null) => void;
  resetSession: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      theme: 'light-gray',
      font: 'yahei',
      fontSize: 'medium',
      ttsEnabled: true,
      voiceMode: true,

      hydrated: false,
      user: null,
      selectedRole: null,
      selectedCase: null,
      learningRecords: [],
      stageDialogues: [],
      behaviorLog: [],
      documents: {},
      defenderStep: 0,
      lifecycle: null,
      lifecycleLoading: false,
      lifecycleVisible: true,
      questionAutoAdvance: false,
      caseAnnotations: [],
      hearingProgress: {},
      docProgress: {},
      trainingStartTime: null,

      setTheme: (t) => set({ theme: t }),
      setFont: (f) => set({ font: f }),
      setFontSize: (s) => set({ fontSize: s }),
      setTtsEnabled: (v) => set({ ttsEnabled: v }),
      setVoiceMode: (v) => set({ voiceMode: v }),
      setUser: (u) => set({ user: u }),
      login: (u) => set({
        user: {
          id: u.id,
          studentId: u.studentId || '',
          nickname: u.nickname || '未知用户',
          avatar: u.avatar || '',
          avatarColor: u.avatarColor || '',
          role: u.role || 'student',
          isGuest: u.isGuest ?? false,
          fid: u.fid || '',
          createdAt: u.createdAt || new Date().toISOString(),
        }
      }),
      logout: () => set({ user: null, selectedRole: null, selectedCase: null, documents: {}, learningRecords: [], stageDialogues: [], behaviorLog: [], docProgress: {}, trainingStartTime: null, hearingProgress: {} }),
      setSelectedRole: (r) => set({ selectedRole: r }),
      setSelectedCase: (c) => set((state) => {
        // Clear documents when switching to a different case to prevent stale data
        const isSameCase = state.selectedCase?.id === c?.id;
        return {
          selectedCase: c,
          // 切换案例 = 开始新训练：清空学习记录、对话快照与行为轨迹
          ...(isSameCase ? {} : { documents: {}, learningRecords: [], stageDialogues: [], behaviorLog: [], hearingProgress: {} }),
        };
      }),
      addLearningRecord: (r) => set((s) => ({ learningRecords: [...s.learningRecords, r] })),
      upsertStageDialogue: (pageName, conversations) => set((s) => {
        const existing = s.stageDialogues.find((d) => d.pageName === pageName);
        // 仅在消息更多或等长时更新快照，防止乱序覆盖已采集内容
        if (existing) {
          if (conversations.length < existing.conversations.length) return {};
          return {
            stageDialogues: s.stageDialogues.map((d) => d.pageName === pageName
              ? { ...d, conversations, updatedAt: Date.now() }
              : d),
          };
        }
        if (conversations.length === 0) return {};
        return {
          stageDialogues: [...s.stageDialogues, { pageName, conversations, createdAt: Date.now(), updatedAt: Date.now() }],
        };
      }),
      appendBehavior: (action, detail) => set((s) => ({
        behaviorLog: [...s.behaviorLog, {
          id: `behavior-${Date.now()}-${s.behaviorLog.length}`,
          role: 'narrator' as const,
          speaker: '行为',
          content: detail ? `${action}（${detail}）` : action,
          timestamp: Date.now(),
        }],
      })),
      setDocument: (type, content) => set((s) => ({
        documents: { ...s.documents, [type]: content },
        // 用户保存文书也是训练行为，计入行为轨迹
        behaviorLog: [...s.behaviorLog, {
          id: `behavior-doc-${Date.now()}-${s.behaviorLog.length}`,
          role: 'narrator' as const,
          speaker: '行为',
          content: `保存文书「${DOC_TYPE_LABELS[type] || type}」（${content.length}字）`,
          timestamp: Date.now(),
        }],
      })),
      setDefenderStep: (s) => set({ defenderStep: s }),
      setLifecycle: (l) => set({ lifecycle: l }),
      setLifecycleLoading: (v) => set({ lifecycleLoading: v }),
      toggleLifecycleVisible: () => set((s) => ({ lifecycleVisible: !s.lifecycleVisible })),
      setQuestionAutoAdvance: (v) => set({ questionAutoAdvance: v }),
      setLifecycleVisible: (v) => set({ lifecycleVisible: v }),
      addCaseAnnotation: (a) => set((s) => ({ caseAnnotations: [...s.caseAnnotations, a] })),
      saveHearingProgress: (key, p) => set((s) => ({ hearingProgress: { ...s.hearingProgress, [key]: p } })),
      removeCaseAnnotation: (id) => set((s) => ({ caseAnnotations: s.caseAnnotations.filter((a) => a.id !== id) })),
      clearCaseAnnotations: () => set({ caseAnnotations: [] }),
      recordDocEval: (caseId, docType, score) => set((s) => {
        const key = `${caseId}:${docType}`;
        const prev = s.docProgress[key] || { evalCount: 0, bestScore: 0 };
        const next = {
          evalCount: prev.evalCount + 1,
          bestScore: typeof score === 'number' && score > prev.bestScore ? score : prev.bestScore,
        };
        return { docProgress: { ...s.docProgress, [key]: next } };
      }),
      setTrainingStartTime: (t) => set({ trainingStartTime: t }),
      resetSession: () => set({
        learningRecords: [],
        stageDialogues: [],
        behaviorLog: [],
        documents: {},
        defenderStep: 0,
        lifecycle: null,
        lifecycleLoading: false,
        lifecycleVisible: true,
        caseAnnotations: [],
        hearingProgress: {},
        selectedRole: null,
        selectedCase: null,
      }),
    }),
    {
      name: 'court-sim-storage',
      // v1（2026-11 视觉改版）：字号档位整体下调、默认主题改为卷宗白。
      // 旧存档里的 theme=warm / fontSize=large 是旧默认值而非用户主动选择，迁移到新默认；其他值保留。
      version: 1,
      migrate: (persisted, fromVersion) => {
        const st = (persisted ?? {}) as Record<string, unknown>;
        if (fromVersion < 1) {
          if (st.theme === 'warm') st.theme = 'light-gray';
          if (st.fontSize === 'large') st.fontSize = 'medium';
        }
        return st as never;
      },
      storage: createJSONStorage(() => {
        if (typeof window !== 'undefined') {
          return localStorage;
        }
        return {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
        };
      }),
      partialize: (state) => ({
        theme: state.theme,
        font: state.font,
        fontSize: state.fontSize,
        ttsEnabled: state.ttsEnabled,
        voiceMode: state.voiceMode,
        user: state.user,
        documents: state.documents,
        docProgress: state.docProgress,
        trainingStartTime: state.trainingStartTime,
        questionAutoAdvance: state.questionAutoAdvance,
      }),
    }
  )
);

// 恢复完成后置位 hydrated。
//
// 为什么不写在 persist 的 onRehydrateStorage 回调里：localStorage 是同步存储，恢复在 create()
// 内部就完成了，回调触发时 useAppStore 还没赋值（暂时性死区），回调里引用它会抛错且被 zustand 吞掉。
//
// 为什么还要兜底：存档损坏（JSON 解析失败）时 zustand 只走 catch 分支，既不调用
// onFinishHydration 也不置位 hasHydrated；若只监听 onFinishHydration，守卫会永远等不到
// ready，用户卡死在空白页。所以：能同步判定就同步置位，否则监听完成事件，并用一个 0ms 定时器
// 兜底——恢复是同步完成的，定时器触发时仍未置位就说明走了失败分支，此时视为"无存档"放行。
// 服务端渲染没有 window，hydrated 保持初始值 false。
if (typeof window !== 'undefined') {
  const markHydrated = () => {
    if (!useAppStore.getState().hydrated) useAppStore.setState({ hydrated: true });
  };
  if (useAppStore.persist.hasHydrated()) {
    markHydrated();
  } else {
    useAppStore.persist.onFinishHydration(markHydrated);
    setTimeout(markHydrated, 0);
  }
}

/**
 * 页面守卫用：返回 { ready, user }。
 * ready=false 表示 localStorage 尚未恢复，此时 user 不可信，守卫应当什么都不做（既不放行也不跳转）。
 */
export function useAuthReady(): { ready: boolean; user: User | null } {
  const ready = useAppStore((s) => s.hydrated);
  const user = useAppStore((s) => s.user);
  return { ready, user };
}
