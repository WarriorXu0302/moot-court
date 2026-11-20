import type { StageDef, FlowRole, FlowPhase } from './types';

/**
 * 国际仲裁庭审流程定义（见 docs/arbitration-design.md 第6节）。
 *
 * 说话人命名：首席仲裁员 / 申请人代理人 / 被申请人代理人 / 边裁甲 / 边裁乙 /
 * 证人 / 专家证人 / 仲裁秘书。这些名称同时作为 TTS 音色键与立绘/气泡标签。
 *
 * 约束（沿用 AGENTS.md）：
 * - 所有"AI 向另一角色发问"的 ai 阶段必须配 responder，否则被问者永远沉默
 * - 各角色视角下 type 不同：用户扮演的角色对应阶段为 interactive
 * - **responder 不得是用户本人扮演的角色**：AI 会替学生作答。需要学生回答 AI 的提问时，
 *   拆成"AI 提问（ai，无 responder）"+"学生回答（interactive）"两个阶段（2026-11 实测踩坑）
 *
 * ⚠ 阶段表为初稿，须由课题组按 CIETAC / ICC 实际程序校准后定稿。
 */

const CHIEF = '首席仲裁员';
const CLAIMANT = '申请人代理人';
const RESPONDENT = '被申请人代理人';

// ===== 庭审调查（举证质证阶段） =====

/** 首席仲裁员视角 */
const CHIEF_INVESTIGATION: StageDef[] = [
  { id: 'opening_remarks', label: '首席仲裁员宣布开庭，核实仲裁庭组成与回避', type: 'interactive', speaker: CHIEF, hint: '请首席仲裁员宣布开庭，介绍仲裁庭组成，询问各方对仲裁员组成有无异议' },
  { id: 'jurisdiction_objection', label: '被申请人提出管辖权异议', type: 'ai', speaker: RESPONDENT, responder: CLAIMANT },
  { id: 'tribunal_ruling_juris', label: '首席仲裁员就管辖权问题归纳争议并作程序安排', type: 'interactive', speaker: CHIEF, hint: '请就管辖权异议归纳争议点，说明仲裁庭将如何处理（先行裁定或并入实体审理）' },
  { id: 'claimant_opening', label: '申请人代理人开庭陈述', type: 'ai', speaker: CLAIMANT },
  { id: 'respondent_opening', label: '被申请人代理人开庭陈述', type: 'ai', speaker: RESPONDENT },
  { id: 'evidence_claimant', label: '申请人代理人举证', type: 'ai', speaker: CLAIMANT },
  { id: 'cross_claimant_evidence', label: '被申请人代理人对申请人证据质证', type: 'ai', speaker: RESPONDENT },
  { id: 'witness_exam', label: '申请人代理人询问事实证人', type: 'ai', speaker: CLAIMANT, responder: '证人' },
  { id: 'witness_cross', label: '被申请人代理人交叉询问事实证人', type: 'ai', speaker: RESPONDENT, responder: '证人' },
  { id: 'expert_exam', label: '被申请人代理人询问专家证人', type: 'ai', speaker: RESPONDENT, responder: '专家证人' },
  { id: 'tribunal_questions', label: '仲裁庭向当事人提问', type: 'interactive', speaker: CHIEF, responder: CLAIMANT, hint: '请就尚不清楚的事实或法律问题向当事人代理人提问' },
  { id: 'evidence_respondent', label: '被申请人代理人举证及申请人质证', type: 'ai', speaker: RESPONDENT },
  { id: 'closing_procedure', label: '首席仲裁员宣布庭审调查结束', type: 'interactive', speaker: CHIEF, hint: '请宣布庭审调查结束，说明下一步辩论程序' },
];

/** 申请人代理人视角 */
const CLAIMANT_INVESTIGATION: StageDef[] = [
  { id: 'opening_remarks', label: '仲裁庭宣布开庭', type: 'ai', speaker: CHIEF },
  { id: 'jurisdiction_objection', label: '被申请人提出管辖权异议', type: 'ai', speaker: RESPONDENT },
  { id: 'claimant_jurisdiction_reply', label: '申请人代理人答复管辖权异议', type: 'interactive', speaker: CLAIMANT, responder: CHIEF, hint: '请就被申请人的管辖权异议作出答复，论证仲裁协议有效且仲裁庭有管辖权' },
  { id: 'tribunal_ruling_juris', label: '仲裁庭作程序安排', type: 'ai', speaker: CHIEF },
  { id: 'claimant_opening', label: '申请人代理人开庭陈述', type: 'interactive', speaker: CLAIMANT, responder: CHIEF, hint: '请陈述仲裁请求、事实与理由（请求权基础、事实、法律依据）' },
  { id: 'respondent_opening', label: '被申请人代理人开庭陈述', type: 'ai', speaker: RESPONDENT },
  { id: 'evidence_claimant', label: '申请人代理人举证', type: 'interactive', speaker: CLAIMANT, responder: CHIEF, hint: '请逐项出示证据，说明证明目的' },
  { id: 'cross_claimant_evidence', label: '被申请人代理人对申请人证据质证', type: 'ai', speaker: RESPONDENT },
  { id: 'witness_exam', label: '申请人代理人询问己方事实证人', type: 'interactive', speaker: CLAIMANT, responder: '证人', hint: '请对己方证人作直接询问（开放式问题，不得诱导）' },
  { id: 'witness_cross', label: '被申请人代理人交叉询问事实证人', type: 'ai', speaker: RESPONDENT, responder: '证人' },
  { id: 'expert_exam', label: '被申请人代理人询问专家证人', type: 'ai', speaker: RESPONDENT, responder: '专家证人' },
  { id: 'tribunal_questions', label: '仲裁庭向申请人代理人提问', type: 'ai', speaker: CHIEF },
  { id: 'claimant_answers_tribunal', label: '申请人代理人回答仲裁庭提问', type: 'interactive', speaker: CLAIMANT, responder: CHIEF, hint: '请回答仲裁庭刚才的提问' },
  { id: 'evidence_respondent', label: '被申请人代理人举证', type: 'ai', speaker: RESPONDENT },
  { id: 'claimant_cross_respondent', label: '申请人代理人对被申请人证据质证', type: 'interactive', speaker: CLAIMANT, responder: CHIEF, hint: '请从真实性、合法性、关联性三方面对被申请人证据发表质证意见' },
  { id: 'closing_procedure', label: '仲裁庭宣布庭审调查结束', type: 'ai', speaker: CHIEF },
];

/** 被申请人代理人视角 */
const RESPONDENT_INVESTIGATION: StageDef[] = [
  { id: 'opening_remarks', label: '仲裁庭宣布开庭', type: 'ai', speaker: CHIEF },
  { id: 'jurisdiction_objection', label: '被申请人代理人提出管辖权异议', type: 'interactive', speaker: RESPONDENT, responder: CLAIMANT, hint: '请就仲裁协议效力、仲裁庭管辖权提出异议并陈述理由' },
  { id: 'tribunal_ruling_juris', label: '仲裁庭作程序安排', type: 'ai', speaker: CHIEF },
  { id: 'claimant_opening', label: '申请人代理人开庭陈述', type: 'ai', speaker: CLAIMANT },
  { id: 'respondent_opening', label: '被申请人代理人开庭陈述', type: 'interactive', speaker: RESPONDENT, responder: CHIEF, hint: '请陈述答辩意见：事实抗辩、法律抗辩，如有反请求一并提出' },
  { id: 'evidence_claimant', label: '申请人代理人举证', type: 'ai', speaker: CLAIMANT },
  { id: 'cross_claimant_evidence', label: '被申请人代理人对申请人证据质证', type: 'interactive', speaker: RESPONDENT, responder: CHIEF, hint: '请从真实性、合法性、关联性三方面对申请人证据发表质证意见' },
  { id: 'witness_exam', label: '申请人代理人询问事实证人', type: 'ai', speaker: CLAIMANT, responder: '证人' },
  { id: 'witness_cross', label: '被申请人代理人交叉询问事实证人', type: 'interactive', speaker: RESPONDENT, responder: '证人', hint: '请对对方证人作交叉询问（可使用封闭式、诱导式问题，围绕证言矛盾与不可靠之处）' },
  { id: 'expert_exam', label: '被申请人代理人询问专家证人', type: 'interactive', speaker: RESPONDENT, responder: '专家证人', hint: '请就专家的资质、方法论与结论依据发问，必要时质疑其独立性' },
  { id: 'tribunal_questions', label: '仲裁庭向被申请人代理人提问', type: 'ai', speaker: CHIEF },
  { id: 'respondent_answers_tribunal', label: '被申请人代理人回答仲裁庭提问', type: 'interactive', speaker: RESPONDENT, responder: CHIEF, hint: '请回答仲裁庭刚才的提问' },
  { id: 'evidence_respondent', label: '被申请人代理人举证', type: 'interactive', speaker: RESPONDENT, responder: CHIEF, hint: '请逐项出示证据，说明证明目的' },
  { id: 'claimant_cross_respondent', label: '申请人代理人对被申请人证据质证', type: 'ai', speaker: CLAIMANT },
  { id: 'closing_procedure', label: '仲裁庭宣布庭审调查结束', type: 'ai', speaker: CHIEF },
];

// ===== 辩论阶段（结案陈词） =====

/** 首席仲裁员视角 */
const CHIEF_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '首席仲裁员宣布进入辩论（结案陈词）', type: 'interactive', speaker: CHIEF, hint: '请宣布进入辩论阶段，说明发言顺序与时间安排' },
  { id: 'claimant_closing', label: '申请人代理人结案陈词', type: 'ai', speaker: CLAIMANT },
  { id: 'respondent_closing', label: '被申请人代理人结案陈词', type: 'ai', speaker: RESPONDENT },
  { id: 'announce_free', label: '首席仲裁员宣布自由辩论开始', type: 'interactive', speaker: CHIEF, hint: '请宣布自由辩论开始，并提示围绕争议焦点展开' },
  { id: 'free_debate', label: '自由辩论', type: 'interactive', speaker: CHIEF, hint: '可根据情况介入并引导双方围绕焦点辩论，或点击下一环节跳过' },
  { id: 'costs_claimant', label: '申请人代理人就仲裁费用承担发表意见', type: 'ai', speaker: CLAIMANT },
  { id: 'costs_respondent', label: '被申请人代理人就仲裁费用承担发表意见', type: 'ai', speaker: RESPONDENT },
  { id: 'announce_end', label: '首席仲裁员宣布辩论结束', type: 'interactive', speaker: CHIEF, hint: '请宣布辩论结束，说明仲裁庭将进行合议及裁决作出的方式' },
];

/** 申请人代理人视角 */
const CLAIMANT_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '仲裁庭宣布进入辩论', type: 'ai', speaker: CHIEF },
  { id: 'claimant_closing', label: '申请人代理人结案陈词', type: 'interactive', speaker: CLAIMANT, hint: '请围绕争议焦点作结案陈词：管辖权、事实、法律适用、请求金额' },
  { id: 'respondent_closing', label: '被申请人代理人结案陈词', type: 'ai', speaker: RESPONDENT },
  { id: 'announce_free', label: '仲裁庭宣布自由辩论开始', type: 'ai', speaker: CHIEF },
  { id: 'free_debate', label: '自由辩论', type: 'interactive', speaker: CLAIMANT, responder: RESPONDENT, hint: '请针对被申请人的观点作出回应与反驳' },
  { id: 'costs_claimant', label: '申请人代理人就仲裁费用承担发表意见', type: 'interactive', speaker: CLAIMANT, hint: '请就仲裁费用与代理费用的承担发表意见' },
  { id: 'costs_respondent', label: '被申请人代理人就仲裁费用承担发表意见', type: 'ai', speaker: RESPONDENT },
  { id: 'announce_end', label: '仲裁庭宣布辩论结束', type: 'ai', speaker: CHIEF },
];

/** 被申请人代理人视角 */
const RESPONDENT_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '仲裁庭宣布进入辩论', type: 'ai', speaker: CHIEF },
  { id: 'claimant_closing', label: '申请人代理人结案陈词', type: 'ai', speaker: CLAIMANT },
  { id: 'respondent_closing', label: '被申请人代理人结案陈词', type: 'interactive', speaker: RESPONDENT, hint: '请围绕争议焦点作结案陈词：管辖权异议、事实抗辩、法律抗辩、反请求' },
  { id: 'announce_free', label: '仲裁庭宣布自由辩论开始', type: 'ai', speaker: CHIEF },
  { id: 'free_debate', label: '自由辩论', type: 'interactive', speaker: RESPONDENT, responder: CLAIMANT, hint: '请针对申请人的观点作出回应与反驳' },
  { id: 'costs_claimant', label: '申请人代理人就仲裁费用承担发表意见', type: 'ai', speaker: CLAIMANT },
  { id: 'costs_respondent', label: '被申请人代理人就仲裁费用承担发表意见', type: 'interactive', speaker: RESPONDENT, hint: '请就仲裁费用与代理费用的承担发表意见' },
  { id: 'announce_end', label: '仲裁庭宣布辩论结束', type: 'ai', speaker: CHIEF },
];

/** 内部角色映射：judge=首席仲裁员，prosecutor=申请人代理人，defender=被申请人代理人 */
export const ARBITRATION_FLOWS: Record<FlowPhase, Record<FlowRole, StageDef[]>> = {
  investigation: {
    judge: CHIEF_INVESTIGATION,
    prosecutor: CLAIMANT_INVESTIGATION,
    defender: RESPONDENT_INVESTIGATION,
  },
  debate: {
    judge: CHIEF_DEBATE,
    prosecutor: CLAIMANT_DEBATE,
    defender: RESPONDENT_DEBATE,
  },
};
