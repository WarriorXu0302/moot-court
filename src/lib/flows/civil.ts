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
 * - 学生发言（interactive）环节的下一环节如果正好是对方发言，就不给学生环节配对方作 responder，
 *   否则对方会连说两段（见 hearing-engine.responderForUserTurn）
 *
 * 程序顺序按民事诉讼一审开庭的通行做法（2026-11 依学生反馈与 scripts/hearing-sim.ts 审阅细化）：
 *   开庭准备：书记员查明到庭、宣布法庭纪律 → 审判长宣布开庭、案由、合议庭组成、告知权利义务、询问回避 → 双方确认身份与回避
 *   法庭调查：诉辩陈述 → 归纳争议焦点（双方可补充）→ 法律适用意见（涉外案件训练重点）→ 举证质证 →
 *             告知证人权利义务 → 询问证人（双方）→ 外国法查明专家 → 法庭发问 → 调查结束
 *   法庭辩论：第一轮 → 审判长主持第二轮 → 审判长宣布辩论终结并征询最后意见 → 最后意见 → 询问调解 → 休庭
 */

const JUDGE = '审判长';
const PLAINTIFF = '原告代理人';
const DEFENDANT = '被告代理人';
const EXPERT = '外国法查明专家';
const CLERK = '书记员';
const WITNESS = '证人';

// ===== 法庭调查 =====

const JUDGE_INVESTIGATION: StageDef[] = [
  { id: 'clerk_opening', label: '书记员查明当事人到庭情况，宣布法庭纪律', type: 'ai', speaker: CLERK },
  { id: 'opening_remarks', label: '审判长宣布开庭，宣布案由与合议庭组成，告知诉讼权利义务，询问回避', type: 'interactive', speaker: JUDGE, hint: '请宣布开庭，宣布案由和合议庭组成人员、书记员，核对双方代理人身份，告知诉讼权利义务，询问是否申请回避' },
  { id: 'identity_plaintiff', label: '原告代理人确认出庭身份、发表回避意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'identity_defendant', label: '被告代理人确认出庭身份、发表回避意见', type: 'ai', speaker: DEFENDANT },
  { id: 'plaintiff_claims', label: '原告代理人陈述诉讼请求与事实理由', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_answer', label: '被告代理人答辩（含管辖异议）', type: 'ai', speaker: DEFENDANT },
  { id: 'focus', label: '审判长归纳争议焦点（含涉外定性与准据法）', type: 'interactive', speaker: JUDGE, hint: '请归纳本案争议焦点：涉外性认定、法律关系定性、准据法确定、实体争点，并询问双方有无补充' },
  { id: 'focus_plaintiff', label: '原告代理人对争议焦点发表意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'focus_defendant', label: '被告代理人对争议焦点发表意见', type: 'ai', speaker: DEFENDANT },
  { id: 'law_plaintiff', label: '原告代理人发表法律适用意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'law_defendant', label: '被告代理人发表法律适用意见', type: 'ai', speaker: DEFENDANT },
  { id: 'evidence_plaintiff', label: '原告代理人举证，被告代理人质证', type: 'ai', speaker: PLAINTIFF, responder: DEFENDANT },
  { id: 'evidence_defendant', label: '被告代理人举证，原告代理人质证', type: 'ai', speaker: DEFENDANT, responder: PLAINTIFF },
  { id: 'witness_notice', label: '审判长传证人出庭，告知证人如实作证的义务及作伪证的法律后果', type: 'interactive', speaker: JUDGE, responder: WITNESS, hint: '请传证人出庭，核实证人身份，告知其应当如实作证及作伪证的法律后果' },
  { id: 'witness_exam', label: '原告代理人询问证人', type: 'ai', speaker: PLAINTIFF, rounds: 3, responder: WITNESS },
  { id: 'witness_cross', label: '被告代理人询问证人', type: 'ai', speaker: DEFENDANT, rounds: 3, responder: WITNESS },
  { id: 'expert_notice', label: '审判长请外国法查明专家到庭，核实其专业背景与意见范围', type: 'interactive', speaker: JUDGE, responder: EXPERT, hint: '请专家到庭，请其说明专业背景、受谁委托或由谁指定、与双方有无利害关系、本次意见的范围' },
  { id: 'expert_exam', label: '被告代理人询问外国法查明专家', type: 'ai', speaker: DEFENDANT, rounds: 3, responder: EXPERT },
  { id: 'court_questions', label: '审判长向当事人发问，原告代理人回答', type: 'interactive', speaker: JUDGE, responder: PLAINTIFF, hint: '请就尚不清楚的事实或法律适用问题向当事人代理人发问（一次一问）' },
  { id: 'closing_check', label: '审判长询问双方有无新的证据或补充意见', type: 'interactive', speaker: JUDGE, hint: '请询问双方有无新的证据或需要补充的调查意见' },
  { id: 'closing_check_plaintiff', label: '原告代理人答复有无补充', type: 'ai', speaker: PLAINTIFF },
  { id: 'closing_check_defendant', label: '被告代理人答复有无补充', type: 'ai', speaker: DEFENDANT },
  { id: 'closing_investigation', label: '审判长宣布法庭调查结束', type: 'interactive', speaker: JUDGE, hint: '请根据双方的答复（有补充申请的先作出处理），宣布法庭调查结束，说明下一步进入法庭辩论' },
];

const PLAINTIFF_INVESTIGATION: StageDef[] = [
  { id: 'clerk_opening', label: '书记员查明当事人到庭情况，宣布法庭纪律', type: 'ai', speaker: CLERK },
  { id: 'opening_remarks', label: '审判长宣布开庭，宣布案由与合议庭组成，告知诉讼权利义务，询问回避', type: 'ai', speaker: JUDGE },
  { id: 'identity_plaintiff', label: '原告代理人确认出庭身份、发表回避意见', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请说明代理人身份与代理权限，对被告出庭人员有无异议，是否申请合议庭成员、书记员回避' },
  { id: 'identity_defendant', label: '被告代理人确认出庭身份、发表回避意见', type: 'ai', speaker: DEFENDANT, responder: JUDGE },
  { id: 'plaintiff_claims', label: '原告代理人陈述诉讼请求与事实理由', type: 'interactive', speaker: PLAINTIFF, hint: '请陈述诉讼请求（具体、可执行）及所依据的事实与理由' },
  { id: 'defendant_answer', label: '被告代理人答辩（含管辖异议）', type: 'ai', speaker: DEFENDANT },
  { id: 'focus', label: '审判长归纳争议焦点', type: 'ai', speaker: JUDGE },
  { id: 'focus_plaintiff', label: '原告代理人对争议焦点发表意见', type: 'interactive', speaker: PLAINTIFF, hint: '请说明对审判长归纳的争议焦点有无异议或补充（简短即可）' },
  { id: 'focus_defendant', label: '被告代理人对争议焦点发表意见', type: 'ai', speaker: DEFENDANT, responder: JUDGE },
  { id: 'law_plaintiff', label: '原告代理人发表法律适用意见', type: 'interactive', speaker: PLAINTIFF, hint: '请论证本案的涉外性、法律关系定性与应适用的准据法（冲突规范依据、连结点）' },
  { id: 'law_defendant', label: '被告代理人发表法律适用意见', type: 'ai', speaker: DEFENDANT },
  { id: 'evidence_plaintiff', label: '原告代理人举证，被告代理人质证', type: 'interactive', speaker: PLAINTIFF, responder: DEFENDANT, hint: '请逐项出示证据，说明证据名称、来源与证明目的；域外证据说明公证认证情况' },
  { id: 'evidence_defendant', label: '被告代理人举证', type: 'ai', speaker: DEFENDANT },
  { id: 'plaintiff_cross', label: '原告代理人对被告证据质证', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请从真实性、合法性、关联性三方面逐项发表质证意见' },
  { id: 'witness_notice', label: '审判长传证人出庭，告知证人如实作证的义务及作伪证的法律后果', type: 'ai', speaker: JUDGE, responder: WITNESS },
  { id: 'witness_exam', label: '原告代理人询问证人', type: 'interactive', speaker: PLAINTIFF, multiTurn: 3, responder: WITNESS, hint: '请对证人发问（开放式问题，一次一问，不得诱导）' },
  { id: 'witness_cross', label: '被告代理人询问证人', type: 'ai', speaker: DEFENDANT, rounds: 3, responder: WITNESS },
  { id: 'expert_notice', label: '审判长请外国法查明专家到庭，核实其专业背景与意见范围', type: 'ai', speaker: JUDGE, responder: EXPERT },
  { id: 'expert_exam', label: '被告代理人询问外国法查明专家', type: 'ai', speaker: DEFENDANT, rounds: 3, responder: EXPERT },
  { id: 'court_questions', label: '审判长向原告代理人发问', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_answers_court', label: '原告代理人回答法庭发问', type: 'interactive', speaker: PLAINTIFF, responder: JUDGE, hint: '请回答审判长刚才的发问' },
  { id: 'closing_check', label: '审判长询问双方有无新的证据或补充意见', type: 'ai', speaker: JUDGE },
  { id: 'closing_check_plaintiff', label: '原告代理人答复有无补充', type: 'interactive', speaker: PLAINTIFF, hint: '请说明有无新的证据或需要补充的调查意见（没有就简短说明）' },
  { id: 'closing_check_defendant', label: '被告代理人答复有无补充', type: 'ai', speaker: DEFENDANT },
  { id: 'closing_investigation', label: '审判长宣布法庭调查结束', type: 'ai', speaker: JUDGE },
];

const DEFENDANT_INVESTIGATION: StageDef[] = [
  { id: 'clerk_opening', label: '书记员查明当事人到庭情况，宣布法庭纪律', type: 'ai', speaker: CLERK },
  { id: 'opening_remarks', label: '审判长宣布开庭，宣布案由与合议庭组成，告知诉讼权利义务，询问回避', type: 'ai', speaker: JUDGE },
  { id: 'identity_plaintiff', label: '原告代理人确认出庭身份、发表回避意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'identity_defendant', label: '被告代理人确认出庭身份、发表回避意见', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请说明代理人身份与代理权限，对原告出庭人员有无异议，是否申请合议庭成员、书记员回避' },
  { id: 'plaintiff_claims', label: '原告代理人陈述诉讼请求与事实理由', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_answer', label: '被告代理人答辩（含管辖异议）', type: 'interactive', speaker: DEFENDANT, hint: '请发表答辩意见：管辖异议（如有）、事实抗辩、法律抗辩' },
  { id: 'focus', label: '审判长归纳争议焦点', type: 'ai', speaker: JUDGE },
  { id: 'focus_plaintiff', label: '原告代理人对争议焦点发表意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'focus_defendant', label: '被告代理人对争议焦点发表意见', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请说明对审判长归纳的争议焦点有无异议或补充（简短即可）' },
  { id: 'law_plaintiff', label: '原告代理人发表法律适用意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'law_defendant', label: '被告代理人发表法律适用意见', type: 'interactive', speaker: DEFENDANT, hint: '请论证本案法律关系定性与应适用的准据法，回应原告的法律适用主张' },
  { id: 'evidence_plaintiff', label: '原告代理人举证', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_cross', label: '被告代理人对原告证据质证', type: 'interactive', speaker: DEFENDANT, hint: '请从真实性、合法性、关联性三方面逐项发表质证意见；域外证据注意形式要件' },
  { id: 'evidence_defendant', label: '被告代理人举证，原告代理人质证', type: 'interactive', speaker: DEFENDANT, responder: PLAINTIFF, hint: '请逐项出示证据，说明证据名称、来源与证明目的' },
  { id: 'witness_notice', label: '审判长传证人出庭，告知证人如实作证的义务及作伪证的法律后果', type: 'ai', speaker: JUDGE, responder: WITNESS },
  { id: 'witness_exam', label: '原告代理人询问证人', type: 'ai', speaker: PLAINTIFF, rounds: 3, responder: WITNESS },
  { id: 'witness_cross', label: '被告代理人询问证人', type: 'interactive', speaker: DEFENDANT, multiTurn: 3, responder: WITNESS, hint: '请对证人发问，围绕证言中不清楚或矛盾之处，一次一问' },
  { id: 'expert_notice', label: '审判长请外国法查明专家到庭，核实其专业背景与意见范围', type: 'ai', speaker: JUDGE, responder: EXPERT },
  { id: 'expert_exam', label: '被告代理人询问外国法查明专家', type: 'interactive', speaker: DEFENDANT, multiTurn: 3, responder: EXPERT, hint: '请就外国法的内容、查明途径与专家意见的依据发问' },
  { id: 'court_questions', label: '审判长向被告代理人发问', type: 'ai', speaker: JUDGE },
  { id: 'defendant_answers_court', label: '被告代理人回答法庭发问', type: 'interactive', speaker: DEFENDANT, responder: JUDGE, hint: '请回答审判长刚才的发问' },
  { id: 'closing_check', label: '审判长询问双方有无新的证据或补充意见', type: 'ai', speaker: JUDGE },
  { id: 'closing_check_plaintiff', label: '原告代理人答复有无补充', type: 'ai', speaker: PLAINTIFF },
  { id: 'closing_check_defendant', label: '被告代理人答复有无补充', type: 'interactive', speaker: DEFENDANT, hint: '请说明有无新的证据或需要补充的调查意见（没有就简短说明）' },
  { id: 'closing_investigation', label: '审判长宣布法庭调查结束', type: 'ai', speaker: JUDGE },
];

// ===== 法庭辩论 =====

const JUDGE_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布法庭辩论开始', type: 'interactive', speaker: JUDGE, hint: '请宣布法庭辩论开始，提示双方围绕争议焦点发表意见，并请原告代理人先发言' },
  { id: 'plaintiff_argument', label: '原告代理人发表辩论意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_argument', label: '被告代理人发表辩论意见', type: 'ai', speaker: DEFENDANT },
  { id: 'second_round', label: '审判长主持第二轮辩论', type: 'interactive', speaker: JUDGE, hint: '请主持第二轮辩论：指出双方仍需回应的焦点，请原告代理人先发言，提醒不要重复第一轮意见' },
  { id: 'plaintiff_second', label: '原告代理人第二轮辩论', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_second', label: '被告代理人第二轮辩论', type: 'ai', speaker: DEFENDANT },
  { id: 'close_debate', label: '审判长宣布辩论终结，征询双方最后意见', type: 'interactive', speaker: JUDGE, hint: '请宣布法庭辩论终结，按原告、被告的顺序征询双方最后意见' },
  { id: 'plaintiff_final', label: '原告代理人发表最后意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_final', label: '被告代理人发表最后意见', type: 'ai', speaker: DEFENDANT },
  { id: 'mediation', label: '审判长询问双方是否愿意调解', type: 'interactive', speaker: JUDGE, hint: '请询问双方是否愿意在法庭主持下调解' },
  { id: 'mediation_plaintiff', label: '原告代理人表明调解意愿', type: 'ai', speaker: PLAINTIFF },
  { id: 'mediation_defendant', label: '被告代理人表明调解意愿', type: 'ai', speaker: DEFENDANT },
  { id: 'announce_end', label: '审判长宣布休庭', type: 'interactive', speaker: JUDGE, hint: '请宣布休庭，说明合议庭将评议后择期宣判，并提示双方核对庭审笔录' },
];

const PLAINTIFF_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布法庭辩论开始', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_argument', label: '原告代理人发表辩论意见', type: 'interactive', speaker: PLAINTIFF, hint: '请围绕争议焦点发表辩论意见：管辖、涉外定性、准据法、实体权利义务、诉讼请求' },
  { id: 'defendant_argument', label: '被告代理人发表辩论意见', type: 'ai', speaker: DEFENDANT },
  { id: 'second_round', label: '审判长主持第二轮辩论', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_second', label: '原告代理人第二轮辩论', type: 'interactive', speaker: PLAINTIFF, hint: '请针对被告的辩论意见作出回应，不要重复第一轮已说过的内容' },
  { id: 'defendant_second', label: '被告代理人第二轮辩论', type: 'ai', speaker: DEFENDANT },
  { id: 'close_debate', label: '审判长宣布辩论终结，征询双方最后意见', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_final', label: '原告代理人发表最后意见', type: 'interactive', speaker: PLAINTIFF, hint: '请简要陈述最后意见（坚持或变更哪些请求）' },
  { id: 'defendant_final', label: '被告代理人发表最后意见', type: 'ai', speaker: DEFENDANT },
  { id: 'mediation', label: '审判长询问双方是否愿意调解', type: 'ai', speaker: JUDGE },
  { id: 'mediation_plaintiff', label: '原告代理人表明调解意愿', type: 'interactive', speaker: PLAINTIFF, hint: '请表明是否同意在法庭主持下调解；同意的，可说明调解的大致方案' },
  { id: 'mediation_defendant', label: '被告代理人表明调解意愿', type: 'ai', speaker: DEFENDANT },
  { id: 'announce_end', label: '审判长宣布休庭', type: 'ai', speaker: JUDGE },
];

const DEFENDANT_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布法庭辩论开始', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_argument', label: '原告代理人发表辩论意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_argument', label: '被告代理人发表辩论意见', type: 'interactive', speaker: DEFENDANT, hint: '请围绕争议焦点发表辩论意见：管辖、定性、准据法、实体抗辩' },
  { id: 'second_round', label: '审判长主持第二轮辩论', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_second', label: '原告代理人第二轮辩论', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_second', label: '被告代理人第二轮辩论', type: 'interactive', speaker: DEFENDANT, hint: '请针对原告的辩论意见作出回应，不要重复第一轮已说过的内容' },
  { id: 'close_debate', label: '审判长宣布辩论终结，征询双方最后意见', type: 'ai', speaker: JUDGE },
  { id: 'plaintiff_final', label: '原告代理人发表最后意见', type: 'ai', speaker: PLAINTIFF },
  { id: 'defendant_final', label: '被告代理人发表最后意见', type: 'interactive', speaker: DEFENDANT, hint: '请简要陈述最后意见' },
  { id: 'mediation', label: '审判长询问双方是否愿意调解', type: 'ai', speaker: JUDGE },
  { id: 'mediation_plaintiff', label: '原告代理人表明调解意愿', type: 'ai', speaker: PLAINTIFF },
  { id: 'mediation_defendant', label: '被告代理人表明调解意愿', type: 'interactive', speaker: DEFENDANT, hint: '请表明是否同意在法庭主持下调解' },
  { id: 'announce_end', label: '审判长宣布休庭', type: 'ai', speaker: JUDGE },
];

/** 内部角色映射：judge=审判长，prosecutor=原告代理人，defender=被告代理人 */
export const CIVIL_FLOWS: Record<FlowPhase, Record<FlowRole, StageDef[]>> = {
  investigation: { judge: JUDGE_INVESTIGATION, prosecutor: PLAINTIFF_INVESTIGATION, defender: DEFENDANT_INVESTIGATION },
  debate: { judge: JUDGE_DEBATE, prosecutor: PLAINTIFF_DEBATE, defender: DEFENDANT_DEBATE },
};
