import type { StageDef, FlowRole, FlowPhase } from './types';

/**
 * 涉外民商事诉讼庭审流程（一审普通程序，合议庭审理）。
 *
 * 说话人：审判长 / 原告代理人 / 被告代理人 / 证人 / 外国法查明专家 / 书记员。
 * 这些名称同时作为 TTS 音色键与气泡标签。
 *
 * 与仲裁流程相同的硬约束（见 flows/arbitration.ts 顶部）：
 * - "AI 向另一角色发问"的 ai 阶段必须配 responder
 * - responder 不得是用户本人扮演的角色；需要学生回答时拆成"AI 提问"+"学生回答（interactive）"
 *
 * 涉外案件的训练重点放在：管辖、定性、准据法确定、外国法查明。所以庭审调查中单列
 * "法律适用意见"与"外国法查明专家"环节，而不是只走国内民事案件的举证质证。
 */

const JUDGE = '审判长';
const PLAINTIFF = '原告代理人';
const DEFENDANT = '被告代理人';
const EXPERT = '外国法查明专家';

// ===== 法庭调查 =====

const JUDGE_INVESTIGATION: StageDef[] = [
  { id: 'opening_remarks', label: '审判长宣布开庭，核对当事人，告知诉讼权利义务与回避', type: 'interactive', speaker: JUDGE, hint: '请宣布开庭，核对双方当事人及代理人身份，告知诉讼权利义务，询问是否申请回避' },
  { id: 'plaintiff_claims', label: '原告代理人陈述诉讼请求与事实理由', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_answer', label: '被告代理人答辩（含管辖异议）', type: 'ai', speaker: DEFENDANT },
  { id: 'focus', label: '审判长归纳争议焦点（含涉外定性与准据法）', type: 'interactive', speaker: JUDGE, hint: '请归纳本案争议焦点：涉外性认定、法律关系定性、准据法确定、实体争点' },
  { id: 'law_plaintiff', label: '原告代理人发表法律适用意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'law_defendant', label: '被告代理人发表法律适用意见', type: 'ai', speaker: DEFENDANT },
  { id: 'evidence_plaintiff', label: '原告代理人举证，被告代理人质证', type: 'ai', speaker: PLAINTIFF, responder: DEFENDANT },
  { id: 'evidence_defendant', label: '被告代理人举证，原告代理人质证', type: 'ai', speaker: DEFENDANT, responder: PLAINTIFF },
  { id: 'witness_exam', label: '原告代理人询问证人', type: 'ai', speaker: PLAINTIFF, responder: '证人' },
  { id: 'expert_exam', label: '被告代理人询问外国法查明专家', type: 'ai', speaker: DEFENDANT, responder: EXPERT },
  { id: 'court_questions', label: '审判长向当事人发问', type: 'interactive', speaker: JUDGE, responder: PLAINTIFF, hint: '请就尚不清楚的事实或法律适用问题向当事人代理人发问' },
  { id: 'closing_investigation', label: '审判长宣布法庭调查结束', type: 'interactive', speaker: JUDGE, hint: '请宣布法庭调查结束，说明下一步进入法庭辩论' },
];

const PLAINTIFF_INVESTIGATION: StageDef[] = [
  { id: 'opening_remarks', label: '审判长宣布开庭，核对当事人', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_claims', label: '原告代理人陈述诉讼请求与事实理由', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请陈述诉讼请求（具体、可执行）及所依据的事实与理由' },
  { id: 'defendant_answer', label: '被告代理人答辩（含管辖异议）', type: 'ai', speaker: DEFENDANT },
  { id: 'focus', label: '审判长归纳争议焦点', type: 'ai', speaker: JUDGE },
  { id: 'law_plaintiff', label: '原告代理人发表法律适用意见', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请论证本案的涉外性、法律关系定性与应适用的准据法（冲突规范依据、连结点）' },
  { id: 'law_defendant', label: '被告代理人发表法律适用意见', type: 'ai', speaker: DEFENDANT },
  { id: 'evidence_plaintiff', label: '原告代理人举证', type: 'interactive', speaker: PLAINTIFF, responder: DEFENDANT, hint: '请逐项出示证据，说明证据来源与证明目的；域外证据注意公证认证' },
  { id: 'evidence_defendant', label: '被告代理人举证', type: 'ai', speaker: DEFENDANT },
  { id: 'plaintiff_cross', label: '原告代理人对被告证据质证', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请从真实性、合法性、关联性三方面发表质证意见' },
  { id: 'witness_exam', label: '原告代理人询问证人', type: 'interactive', speaker: PLAINTIFF, responder: '证人', hint: '请对证人作询问（开放式问题，不得诱导）' },
  { id: 'expert_exam', label: '被告代理人询问外国法查明专家', type: 'ai', speaker: DEFENDANT, responder: EXPERT },
  { id: 'court_questions', label: '审判长向原告代理人发问', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_answers_court', label: '原告代理人回答法庭发问', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请回答审判长刚才的发问' },
  { id: 'closing_investigation', label: '审判长宣布法庭调查结束', type: 'ai', speaker: JUDGE },
];

const DEFENDANT_INVESTIGATION: StageDef[] = [
  { id: 'opening_remarks', label: '审判长宣布开庭，核对当事人', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_claims', label: '原告代理人陈述诉讼请求与事实理由', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_answer', label: '被告代理人答辩（含管辖异议）', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请发表答辩意见：管辖异议（如有）、事实抗辩、法律抗辩' },
  { id: 'focus', label: '审判长归纳争议焦点', type: 'ai', speaker: JUDGE },
  { id: 'law_plaintiff', label: '原告代理人发表法律适用意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'law_defendant', label: '被告代理人发表法律适用意见', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请论证本案法律关系定性与应适用的准据法，回应原告的法律适用主张' },
  { id: 'evidence_plaintiff', label: '原告代理人举证', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_cross', label: '被告代理人对原告证据质证', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请从真实性、合法性、关联性三方面发表质证意见；域外证据注意形式要件' },
  { id: 'evidence_defendant', label: '被告代理人举证', type: 'interactive', speaker: DEFENDANT, responder: PLAINTIFF, hint: '请逐项出示证据，说明证据来源与证明目的' },
  { id: 'witness_exam', label: '原告代理人询问证人', type: 'ai', speaker: PLAINTIFF, responder: '证人' },
  { id: 'expert_exam', label: '被告代理人询问外国法查明专家', type: 'interactive', speaker: DEFENDANT, responder: EXPERT, hint: '请就外国法的内容、查明途径与专家意见的依据发问' },
  { id: 'court_questions', label: '审判长向被告代理人发问', type: 'ai', speaker: JUDGE },
  { id: 'defendant_answers_court', label: '被告代理人回答法庭发问', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请回答审判长刚才的发问' },
  { id: 'closing_investigation', label: '审判长宣布法庭调查结束', type: 'ai', speaker: JUDGE },
];

// ===== 法庭辩论 =====

const JUDGE_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布法庭辩论开始', type: 'interactive', speaker: JUDGE, hint: '请宣布法庭辩论开始，提示双方围绕争议焦点发表意见' },
  { id: 'plaintiff_argument', label: '原告代理人发表辩论意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_argument', label: '被告代理人发表辩论意见', type: 'ai', speaker: DEFENDANT },
  { id: 'free_debate', label: '第二轮辩论', type: 'interactive', speaker: JUDGE, hint: '可引导双方就准据法或实体争点进一步辩论，或点击下一环节跳过' },
  { id: 'plaintiff_final', label: '原告代理人最后陈述意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_final', label: '被告代理人最后陈述意见', type: 'ai', speaker: DEFENDANT },
  { id: 'announce_end', label: '审判长询问调解意愿并宣布休庭', type: 'interactive', speaker: JUDGE, hint: '请询问双方是否愿意调解，宣布休庭，合议庭将评议后择期宣判' },
];

const PLAINTIFF_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布法庭辩论开始', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_argument', label: '原告代理人发表辩论意见', type: 'interactive', speaker: PLAINTIFF, hint: '请围绕争议焦点发表辩论意见：涉外定性、准据法、实体权利义务、诉讼请求' },
  { id: 'defendant_argument', label: '被告代理人发表辩论意见', type: 'ai', speaker: DEFENDANT },
  { id: 'free_debate', label: '第二轮辩论', type: 'interactive', speaker: PLAINTIFF, responder: DEFENDANT, hint: '请针对被告的辩论意见作出回应' },
  { id: 'plaintiff_final', label: '原告代理人最后陈述意见', type: 'interactive', speaker: PLAINTIFF, hint: '请简要陈述最终意见' },
  { id: 'defendant_final', label: '被告代理人最后陈述意见', type: 'ai', speaker: DEFENDANT },
  { id: 'announce_end', label: '审判长宣布休庭', type: 'ai', speaker: JUDGE },
];

const DEFENDANT_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布法庭辩论开始', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_argument', label: '原告代理人发表辩论意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_argument', label: '被告代理人发表辩论意见', type: 'interactive', speaker: DEFENDANT, hint: '请围绕争议焦点发表辩论意见：管辖、定性、准据法、实体抗辩' },
  { id: 'free_debate', label: '第二轮辩论', type: 'interactive', speaker: DEFENDANT, responder: PLAINTIFF, hint: '请针对原告的辩论意见作出回应' },
  { id: 'plaintiff_final', label: '原告代理人最后陈述意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_final', label: '被告代理人最后陈述意见', type: 'interactive', speaker: DEFENDANT, hint: '请简要陈述最终意见' },
  { id: 'announce_end', label: '审判长宣布休庭', type: 'ai', speaker: JUDGE },
];

/** 内部角色映射：judge=审判长，prosecutor=原告代理人，defender=被告代理人 */
export const CIVIL_FLOWS: Record<FlowPhase, Record<FlowRole, StageDef[]>> = {
  investigation: { judge: JUDGE_INVESTIGATION, prosecutor: PLAINTIFF_INVESTIGATION, defender: DEFENDANT_INVESTIGATION },
  debate: { judge: JUDGE_DEBATE, prosecutor: PLAINTIFF_DEBATE, defender: DEFENDANT_DEBATE },
};
