/**
 * 训练路线的"第几步 / 共几步"。
 *
 * 学生端原来没有任何位置感：每个环节页只显示自己的名字，学生不知道后面还有几步、自己做到哪了。
 * 这里按「案件类型 × 角色」列出完整路线，由标题栏根据当前路径（含 phase/doc 查询参数）定位。
 *
 * 路线须与实际跳转保持一致：仲裁见 arbitration-route.ts，刑事见各页面 router.push。
 */
import type { UserRole } from './types';
import type { CaseType } from './case-type';

export interface TrainingStep {
  label: string;
  /** 路径；带 ? 的还需匹配查询参数 */
  path: string;
}

const ARBITRATION: Record<UserRole, TrainingStep[]> = {
  prosecutor: [
    { label: '案情研读', path: '/student/case-detail' },
    { label: '撰写仲裁申请书', path: '/student/arbitration-writing?doc=claim' },
    { label: '庭审调查', path: '/student/arbitration-hearing?phase=investigation' },
    { label: '庭审辩论', path: '/student/arbitration-hearing?phase=debate' },
    { label: '闭庭与分析', path: '/student/arbitration-closing' },
  ],
  defender: [
    { label: '案情研读', path: '/student/case-detail' },
    { label: '撰写答辩状', path: '/student/arbitration-writing?doc=answer' },
    { label: '庭审调查', path: '/student/arbitration-hearing?phase=investigation' },
    { label: '庭审辩论', path: '/student/arbitration-hearing?phase=debate' },
    { label: '闭庭与分析', path: '/student/arbitration-closing' },
  ],
  judge: [
    { label: '案情研读', path: '/student/case-detail' },
    { label: '庭审调查', path: '/student/arbitration-hearing?phase=investigation' },
    { label: '庭审辩论', path: '/student/arbitration-hearing?phase=debate' },
    { label: '合议并撰写裁决书', path: '/student/arbitration-writing?doc=award' },
    { label: '闭庭与分析', path: '/student/arbitration-closing' },
  ],
};

const CRIMINAL: Record<UserRole, TrainingStep[]> = {
  defender: [
    { label: '案例研读', path: '/student/case-detail' },
    { label: '认罪认罚协商', path: '/student/sentencing-negotiation' },
    { label: '撰写辩护词', path: '/student/defense-writing' },
    { label: '法庭调查', path: '/student/court-investigation' },
    { label: '法庭辩论', path: '/student/court-debate' },
    { label: '最后陈述与宣判', path: '/student/final-statement' },
  ],
  prosecutor: [
    { label: '案例研读', path: '/student/case-detail' },
    { label: '认罪认罚协商', path: '/student/sentencing-negotiation' },
    { label: '撰写起诉书', path: '/student/indictment-writing' },
    { label: '撰写公诉意见书', path: '/student/prosecution-writing' },
    { label: '法庭调查', path: '/student/prosecutor-investigation' },
    { label: '法庭辩论', path: '/student/prosecutor-debate' },
    { label: '最后陈述与宣判', path: '/student/final-statement' },
  ],
  judge: [
    { label: '案例研读', path: '/student/case-detail' },
    { label: '起诉审查', path: '/student/indictment-review' },
    { label: '庭审提纲', path: '/student/trial-outline-writing' },
    { label: '开庭', path: '/student/judge-opening' },
    { label: '法庭调查', path: '/student/judge-investigation' },
    { label: '法庭辩论', path: '/student/judge-debate' },
    { label: '最后陈述', path: '/student/judge-final-statement' },
    { label: '评议', path: '/student/judge-deliberation' },
    { label: '宣判与闭庭', path: '/student/judge-verdict' },
  ],
};

/** 涉外民商事诉讼：与仲裁同一套页面与路线，只是文书与环节名不同 */
const CIVIL: Record<UserRole, TrainingStep[]> = {
  prosecutor: [
    { label: '案情研读', path: '/student/case-detail' },
    { label: '撰写民事起诉状', path: '/student/arbitration-writing?doc=claim' },
    { label: '法庭调查', path: '/student/arbitration-hearing?phase=investigation' },
    { label: '法庭辩论', path: '/student/arbitration-hearing?phase=debate' },
    { label: '宣判与分析', path: '/student/arbitration-closing' },
  ],
  defender: [
    { label: '案情研读', path: '/student/case-detail' },
    { label: '撰写答辩状', path: '/student/arbitration-writing?doc=answer' },
    { label: '法庭调查', path: '/student/arbitration-hearing?phase=investigation' },
    { label: '法庭辩论', path: '/student/arbitration-hearing?phase=debate' },
    { label: '宣判与分析', path: '/student/arbitration-closing' },
  ],
  judge: [
    { label: '案情研读', path: '/student/case-detail' },
    { label: '法庭调查', path: '/student/arbitration-hearing?phase=investigation' },
    { label: '法庭辩论', path: '/student/arbitration-hearing?phase=debate' },
    { label: '合议并撰写判决书', path: '/student/arbitration-writing?doc=award' },
    { label: '宣判与分析', path: '/student/arbitration-closing' },
  ],
};

export function getTrainingSteps(caseType: CaseType, role: UserRole): TrainingStep[] {
  return (caseType === 'arbitration' ? ARBITRATION : caseType === 'civil' ? CIVIL : CRIMINAL)[role];
}

/** 当前步骤下标；不在路线上返回 -1 */
export function findStepIndex(steps: TrainingStep[], pathname: string, search: URLSearchParams): number {
  return steps.findIndex((s) => {
    const [p, q] = s.path.split('?');
    if (p !== pathname) return false;
    if (!q) return true;
    return Array.from(new URLSearchParams(q)).every(([k, v]) => search.get(k) === v);
  });
}
