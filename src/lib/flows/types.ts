/**
 * 庭审流程定义类型（2026-11 流程数据化，见 docs/arbitration-design.md 第5节）
 *
 * 约束（沿用 AGENTS.md）：
 * - 所有"AI 角色向另一角色发问"的 ai 阶段必须配 responder，否则被问角色永远沉默
 * - 新增发问类阶段必须同步配置 responder
 */

/** 案件类型。与 src/lib/case-type.ts 的 CaseType 一致 */
export type FlowCaseType = 'criminal' | 'arbitration' | 'civil';

/** 内部角色（与 UserRole 一致，展示层再按案件类型映射） */
export type FlowRole = 'judge' | 'prosecutor' | 'defender';

/** 庭审阶段分组 */
export type FlowPhase = 'investigation' | 'debate';

export interface StageDef {
  id: string;
  label: string;
  /** ai：AI 自动发言；interactive：等待用户操作 */
  type: 'ai' | 'interactive';
  speaker: string;
  /** 发问类阶段：speaker 发言后由哪个角色回答 */
  responder?: string;
  /** interactive 阶段给用户的操作提示 */
  hint?: string;
  /**
   * 发问类 ai 环节的问答轮数（默认 1）：发问方每轮只问一个问题、对方回答，最多 rounds 轮，
   * 发问方说"询问完毕"即提前结束。原先一次发言里连问七八个问题、证人一口气答完，像书面问卷（模拟器审阅）。
   */
  rounds?: number;
  /** 学生发问的 interactive 环节最多可问几次（默认 1）：每问一次 responder 回答一次，学生可随时点「下一环节」结束 */
  multiTurn?: number;
}
