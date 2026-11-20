/**
 * 仲裁训练路线（见 docs/arbitration-design.md 第6节）
 *
 * 内部角色：judge=首席仲裁员，prosecutor=申请人代理人，defender=被申请人代理人。
 *
 *   首席仲裁员：案情研读 → 庭审调查 → 辩论 → 撰写裁决书 → 闭庭分析
 *   申请人    ：案情研读 → 撰写仲裁申请书 → 庭审调查 → 辩论 → 闭庭分析
 *   被申请人  ：案情研读 → 撰写答辩状     → 庭审调查 → 辩论 → 闭庭分析
 */
import type { UserRole } from './types';

export type ArbitrationStep =
  | 'case-detail'
  | 'writing'
  | 'investigation'
  | 'debate'
  | 'award'
  | 'closing';

export type ArbitrationDoc = 'claim' | 'answer' | 'award';

/** 角色对应的撰写文书：申请人=仲裁申请书，被申请人=答辩状，首席=裁决书 */
export const ROLE_WRITING_DOC: Record<UserRole, ArbitrationDoc> = {
  prosecutor: 'claim',
  defender: 'answer',
  judge: 'award',
};

export const ARB_ROUTES = {
  hearing: (phase: 'investigation' | 'debate') => `/student/arbitration-hearing?phase=${phase}`,
  writing: (doc: ArbitrationDoc) => `/student/arbitration-writing?doc=${doc}`,
  closing: '/student/arbitration-closing',
} as const;

/** 当前步骤完成后的下一站 */
export function getArbitrationNextRoute(role: UserRole | null | undefined, current: ArbitrationStep): string {
  const r: UserRole = role ?? 'defender';
  switch (current) {
    case 'case-detail':
      // 首席仲裁员没有庭前文书，直接进入庭审；两方代理人先写文书
      return r === 'judge' ? ARB_ROUTES.hearing('investigation') : ARB_ROUTES.writing(ROLE_WRITING_DOC[r]);
    case 'writing':
      return ARB_ROUTES.hearing('investigation');
    case 'investigation':
      return ARB_ROUTES.hearing('debate');
    case 'debate':
      // 首席仲裁员辩论后合议并撰写裁决书；代理人直接闭庭
      return r === 'judge' ? ARB_ROUTES.writing('award') : ARB_ROUTES.closing;
    case 'award':
      return ARB_ROUTES.closing;
    case 'closing':
      return '/student/select';
  }
}
