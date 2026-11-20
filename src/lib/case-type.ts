/**
 * 案件类型与展示层映射（见 docs/arbitration-design.md 第2、4节）
 *
 * 内部角色枚举 UserRole（judge/prosecutor/defender）保持不变，
 * 仲裁场景只在展示层改名，避免迁移 store / learning_sessions / training_records 历史数据。
 */
import type { UserRole } from './types';

export type CaseType = 'criminal' | 'arbitration' | 'civil';

/** 对抗式民商事类型（仲裁 / 涉外民商事诉讼）：共用 arbitration-* 页面骨架，按类型切换角色、文书与流程，见 forum-profile.ts */
export type AdversarialCaseType = 'arbitration' | 'civil';

export function isAdversarial(t: unknown): t is AdversarialCaseType {
  return t === 'arbitration' || t === 'civil';
}

export const DEFAULT_CASE_TYPE: CaseType = 'criminal';

export const CASE_TYPE_LABEL: Record<CaseType, string> = {
  criminal: '刑事案件',
  arbitration: '国际商事仲裁',
  civil: '涉外民商事诉讼',
};

export function normalizeCaseType(v: unknown): CaseType {
  return v === 'arbitration' || v === 'civil' ? v : 'criminal';
}

/** 仲裁案例专属元数据，存 cases.meta（jsonb） */
export interface ArbitrationMeta {
  rules: 'CIETAC' | 'ICC' | 'HKIAC' | 'UNCITRAL';
  /** 仲裁地 */
  seat: string;
  /** 受案法院（涉外民商事诉讼用；仲裁为空） */
  court?: string;
  /** 实体准据法 */
  governingLaw: string;
  /** 第一期仅 zh，bilingual 预留 */
  language: 'zh' | 'en' | 'bilingual';
  claimAmount: string;
  issues: { id: string; title: string; type: 'jurisdiction' | 'merits' | 'quantum' | 'procedure' }[];
  /**
   * 教师专属参考资料（标准答案与出处）。**学生接口必须剪掉此字段**（见 api/cases 的 stripTeacherOnly）：
   * 裁判要旨与法理分析就是本案的答案，学生可见则训练失去意义。
   */
  reference?: CaseReference;
}

export interface CaseReference {
  /** 出处，如《中国国际私法经典案例评析》第十六章案例2 */
  source: string;
  /** 原案案号 */
  caseNo?: string;
  /** 原案裁判要旨（标准答案） */
  holding?: string;
  /** 法理分析 */
  analysis?: string;
  /** 书中给出的法律问题（可作为争议焦点的权威表述） */
  issues?: string;
  /** 拓展案例清单 */
  extended?: string[];
  /** 哪些字段由 AI 依据案情拟制，须教师核验后再发布 */
  aiDrafted?: string[];
}

export const ARBITRATION_RULES: ArbitrationMeta['rules'][] = ['CIETAC', 'ICC', 'HKIAC', 'UNCITRAL'];

export const EMPTY_ARBITRATION_META: ArbitrationMeta = {
  rules: 'CIETAC',
  seat: '',
  governingLaw: '',
  language: 'zh',
  claimAmount: '',
  issues: [],
};

/** 解析 meta 列（可能是对象、JSON 字符串或空），非法时返回 undefined */
export function parseArbitrationMeta(raw: unknown): ArbitrationMeta | undefined {
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return undefined; }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Partial<ArbitrationMeta>;
  return {
    rules: ARBITRATION_RULES.includes(o.rules as ArbitrationMeta['rules']) ? (o.rules as ArbitrationMeta['rules']) : 'CIETAC',
    seat: typeof o.seat === 'string' ? o.seat : '',
    court: typeof o.court === 'string' ? o.court : undefined,
    governingLaw: typeof o.governingLaw === 'string' ? o.governingLaw : '',
    language: o.language === 'en' || o.language === 'bilingual' ? o.language : 'zh',
    claimAmount: typeof o.claimAmount === 'string' ? o.claimAmount : '',
    issues: Array.isArray(o.issues) ? o.issues.filter((i) => i && typeof i.title === 'string') : [],
    reference: o.reference && typeof o.reference === 'object' ? (o.reference as CaseReference) : undefined,
  };
}

/** 角色展示名：内部 judge/prosecutor/defender 按案件类型映射 */
export const ROLE_LABELS: Record<CaseType, Record<UserRole, string>> = {
  criminal: { judge: '审判长', prosecutor: '公诉人', defender: '辩护人' },
  arbitration: { judge: '首席仲裁员', prosecutor: '申请人代理人', defender: '被申请人代理人' },
  civil: { judge: '审判长', prosecutor: '原告代理人', defender: '被告代理人' },
};

export const ROLE_DESC: Record<CaseType, Record<UserRole, string>> = {
  criminal: { judge: '主持庭审', prosecutor: '指控犯罪', defender: '为被告人辩护' },
  arbitration: { judge: '主持仲裁程序、合议并作出裁决', prosecutor: '提出仲裁请求、举证论证', defender: '答辩、管辖权异议、反请求' },
  civil: { judge: '主持庭审、确定准据法并作出判决', prosecutor: '提出诉讼请求、论证法律适用', defender: '答辩、管辖异议、法律适用抗辩' },
};

/** 其他庭审参与方的展示名（AI 扮演） */
export const PARTICIPANT_LABELS: Record<CaseType, { defendant: string; victim: string; witness: string; clerk: string; extra?: string }> = {
  criminal: { defendant: '被告人', victim: '被害人', witness: '证人', clerk: '书记员' },
  arbitration: { defendant: '被申请人', victim: '证人', witness: '证人', clerk: '仲裁秘书', extra: '专家证人' },
  civil: { defendant: '被告', victim: '证人', witness: '证人', clerk: '书记员', extra: '外国法查明专家' },
};

/** 案件文书/卷宗字段在不同类型下的展示名（列名不变，仅语义不同） */
export interface CaseLabels {
  indictment: string;
  defense: string;
  prosecution: string;
  victim: string;
  plan: string;
  law: string;
  verdict: string;
  courtName: string;
}

export const CASE_LABELS: Record<CaseType, CaseLabels> = {
  criminal: {
    indictment: '刑事起诉书',
    defense: '辩护词',
    prosecution: '公诉意见书',
    victim: '被害人陈述',
    plan: '庭审提纲',
    law: '司法解释',
    verdict: '判决书',
    courtName: '法庭',
  },
  arbitration: {
    indictment: '仲裁申请书',
    defense: '答辩状（含反请求）',
    prosecution: '申请人代理意见',
    victim: '证人/专家证人陈述',
    plan: '程序时间表',
    law: '仲裁规则与法律依据',
    verdict: '裁决书',
    courtName: '仲裁庭',
  },
  civil: {
    indictment: '民事起诉状',
    defense: '答辩状',
    prosecution: '原告代理词',
    victim: '证人/专家陈述',
    plan: '庭审提纲',
    law: '冲突规范与法律依据',
    verdict: '民事判决书',
    courtName: '法庭',
  },
};

export function getCaseLabels(caseType: CaseType | undefined): CaseLabels {
  return CASE_LABELS[caseType ?? DEFAULT_CASE_TYPE];
}

export function getRoleLabel(caseType: CaseType | undefined, role: UserRole): string {
  return ROLE_LABELS[caseType ?? DEFAULT_CASE_TYPE][role];
}
