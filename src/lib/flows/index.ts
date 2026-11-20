import { CRIMINAL_FLOWS } from './criminal';
import { ARBITRATION_FLOWS } from './arbitration';
import { CIVIL_FLOWS } from './civil';
import type { FlowCaseType, FlowPhase, FlowRole, StageDef } from './types';

export type { StageDef, FlowCaseType, FlowPhase, FlowRole } from './types';

const FLOWS: Record<FlowCaseType, Record<FlowPhase, Record<FlowRole, StageDef[]>>> = {
  criminal: CRIMINAL_FLOWS,
  arbitration: ARBITRATION_FLOWS,
  civil: CIVIL_FLOWS,
};

/**
 * 取庭审流程定义。返回模块级稳定常量（同参数始终同一引用），
 * 页面可在模块顶层调用：`const STAGES = getFlow('criminal', 'judge', 'investigation')`。
 */
export function getFlow(caseType: FlowCaseType, role: FlowRole, phase: FlowPhase): StageDef[] {
  return FLOWS[caseType][phase][role];
}
