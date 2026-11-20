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
}
