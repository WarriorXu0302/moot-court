import type { StageDef, FlowRole, FlowPhase } from './types';

/**
 * 刑事庭审流程定义。
 * 内容逐字取自原 6 个页面内的 STAGES / DEBATE_STAGES 常量，未做任何改动。
 * 注意各角色视角下 type（ai / interactive）不同：用户扮演的角色对应阶段为 interactive。
 */

// ===== 法庭调查 =====

/** 审判长视角：13 阶段（原 judge-investigation/page.tsx） */
const JUDGE_INVESTIGATION: StageDef[] = [
  { id: 'narration_start', label: '审判长宣布法庭调查开始', type: 'interactive', speaker: '审判长', hint: '请审判长宣布法庭调查开始' },
  { id: 'prosecutor_read', label: '公诉人宣读起诉书', type: 'ai', speaker: '公诉人' },
  { id: 'defendant_statement', label: '审判长主持被告人陈述', type: 'interactive', speaker: '审判长', responder: '被告人', hint: '请审判长讯问被告人是否对起诉书指控的犯罪事实有意见' },
  { id: 'victim_statement', label: '被害人陈述', type: 'ai', speaker: '被害人' },
  { id: 'prosecutor_exam_defendant', label: '公诉人讯问被告人', type: 'ai', speaker: '公诉人', responder: '被告人' },
  { id: 'defender_exam_defendant', label: '辩护人发问被告人', type: 'ai', speaker: '辩护人', responder: '被告人' },
  { id: 'judge_exam_defendant', label: '审判长补充讯问被告人', type: 'interactive', speaker: '审判长', responder: '被告人', hint: '请审判长对被告人进行补充讯问' },
  { id: 'exam_victim', label: '控辩双方询问被害人', type: 'ai', speaker: '公诉人', responder: '被害人' },
  { id: 'judge_exam_victim', label: '审判长询问被害人', type: 'interactive', speaker: '审判长', responder: '被害人', hint: '请审判长对被害人进行补充询问' },
  { id: 'witness_examination', label: '询问证人、鉴定人', type: 'ai', speaker: '公诉人', responder: '证人' },
  { id: 'evidence_presentation', label: '出示实物证据、宣读鉴定意见', type: 'ai', speaker: '公诉人' },
  { id: 'judge_evidence_opinion', label: '审判长组织质证', type: 'interactive', speaker: '审判长', hint: '请审判长组织质证并发表意见' },
  { id: 'narration_end', label: '审判长宣布法庭调查结束', type: 'interactive', speaker: '审判长', hint: '请审判长宣布法庭调查结束' },
];

/** 辩护人视角：13 阶段（原 court-investigation/page.tsx） */
const DEFENDER_INVESTIGATION: StageDef[] = [
  { id: 'narration_start', label: '法庭调查开始', type: 'ai', speaker: '审判长' },
  { id: 'prosecutor_read', label: '公诉人宣读起诉书', type: 'ai', speaker: '公诉人' },
  { id: 'defendant_statement', label: '被告人就起诉书发表意见', type: 'ai', speaker: '被告人' },
  { id: 'victim_statement', label: '被害人陈述', type: 'ai', speaker: '被害人' },
  { id: 'examination_defendant', label: '辩护人询问被告人', type: 'interactive', speaker: '辩护人', responder: '被告人' },
  { id: 'examination_defendant_judge', label: '审判长补充询问', type: 'ai', speaker: '审判长', responder: '被告人' },
  { id: 'examination_victim', label: '辩护人询问被害人', type: 'interactive', speaker: '辩护人', responder: '被害人' },
  { id: 'witness_direct_prosecutor', label: '公诉人询问证人', type: 'ai', speaker: '公诉人', responder: '证人' },
  { id: 'witness_cross_defender', label: '辩护人交叉询问证人', type: 'interactive', speaker: '辩护人', responder: '证人' },
  { id: 'evidence_presentation', label: '审判长组织出示证据', type: 'ai', speaker: '审判长' },
  { id: 'prosecutor_opinion', label: '公诉人发表调查意见', type: 'ai', speaker: '公诉人' },
  { id: 'defender_opinion', label: '辩护人发表调查意见', type: 'interactive', speaker: '辩护人', responder: '审判长' },
  { id: 'narration_end', label: '审判长宣布调查结束', type: 'ai', speaker: '审判长' },
];

/** 公诉人视角：16 阶段（原 prosecutor-investigation/page.tsx） */
const PROSECUTOR_INVESTIGATION: StageDef[] = [
  { id: 'narration_start', label: '法庭调查开始', type: 'ai', speaker: '审判长' },
  { id: 'prosecutor_read', label: '公诉人宣读起诉书', type: 'ai', speaker: '公诉人' },
  { id: 'defendant_statement', label: '被告人就起诉书发表意见', type: 'ai', speaker: '被告人' },
  { id: 'victim_statement', label: '被害人陈述', type: 'ai', speaker: '被害人' },
  { id: 'prosecutor_examine_defendant', label: '公诉人讯问被告人', type: 'interactive', speaker: '公诉人', responder: '被告人' },
  { id: 'defender_examine_defendant', label: '辩护人询问被告人', type: 'ai', speaker: '辩护人', responder: '被告人' },
  { id: 'prosecutor_examine_victim', label: '公诉人询问被害人', type: 'interactive', speaker: '公诉人', responder: '被害人' },
  { id: 'defender_examine_victim', label: '辩护人询问被害人', type: 'ai', speaker: '辩护人', responder: '被害人' },
  { id: 'prosecutor_direct_witness', label: '公诉人直接询问己方证人', type: 'interactive', speaker: '公诉人', responder: '证人' },
  { id: 'defender_cross_witness', label: '辩护人交叉询问对方证人', type: 'ai', speaker: '辩护人', responder: '证人' },
  { id: 'defender_direct_witness', label: '辩护人直接询问己方证人', type: 'ai', speaker: '辩护人', responder: '证人' },
  { id: 'prosecutor_cross_witness', label: '公诉人交叉询问对方证人', type: 'interactive', speaker: '公诉人', responder: '证人' },
  { id: 'evidence_presentation', label: '审判长组织出示证据', type: 'ai', speaker: '审判长' },
  { id: 'prosecutor_opinion', label: '公诉人发表调查意见', type: 'interactive', speaker: '公诉人', responder: '审判长' },
  { id: 'defender_opinion', label: '辩护人发表调查意见', type: 'ai', speaker: '辩护人' },
  { id: 'narration_end', label: '审判长宣布调查结束', type: 'ai', speaker: '审判长' },
];

// ===== 法庭辩论 =====

/** 审判长视角：8 阶段（原 judge-debate/page.tsx） */
const JUDGE_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布进入法庭辩论', type: 'interactive', speaker: '审判长', hint: '请审判长宣布进入法庭辩论' },
  { id: 'prosecutor_opinion', label: '公诉人发表公诉意见', type: 'ai', speaker: '公诉人' },
  { id: 'defender_argue', label: '辩护人辩护', type: 'ai', speaker: '辩护人' },
  { id: 'announce_free', label: '审判长宣布自由辩论开始', type: 'interactive', speaker: '审判长', hint: '请审判长宣布自由辩论开始' },
  { id: 'free_debate', label: '自由辩论', type: 'interactive', speaker: '审判长', hint: '审判长可根据情况决定是否介入自由辩论，或点击下一环节跳过' },
  { id: 'victim_opinion', label: '被害人及其诉讼代理人发言', type: 'ai', speaker: '被害人' },
  { id: 'defendant_self', label: '被告人自行辩护', type: 'ai', speaker: '被告人' },
  { id: 'announce_end', label: '审判长宣布法庭辩论结束', type: 'interactive', speaker: '审判长', hint: '请审判长宣布法庭辩论结束' },
];

/** 辩护人视角：8 阶段（原 court-debate/page.tsx 的 DEBATE_STAGES） */
const DEFENDER_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布进入法庭辩论', type: 'ai', speaker: '审判长' },
  { id: 'prosecutor_opinion', label: '公诉人发表公诉意见', type: 'ai', speaker: '公诉人' },
  { id: 'defender_argue', label: '辩护人辩护', type: 'interactive', speaker: '辩护人' },
  { id: 'free_debate_judge', label: '审判长宣布自由辩论开始', type: 'ai', speaker: '审判长' },
  { id: 'free_debate', label: '自由辩论', type: 'interactive', speaker: '辩护人' },
  { id: 'victim_opinion', label: '被害人及其诉讼代理人发言', type: 'ai', speaker: '被害人' },
  { id: 'defendant_self', label: '被告人自行辩护', type: 'ai', speaker: '被告人' },
  { id: 'announce_end', label: '审判长宣布法庭辩论结束', type: 'ai', speaker: '审判长' },
];

/** 公诉人视角：8 阶段（原 prosecutor-debate/page.tsx 的 DEBATE_STAGES） */
const PROSECUTOR_DEBATE: StageDef[] = [
  { id: 'announce_debate', label: '审判长宣布进入法庭辩论', type: 'ai', speaker: '审判长' },
  { id: 'prosecutor_opinion', label: '公诉人发表公诉意见', type: 'interactive', speaker: '公诉人' },
  { id: 'defender_argue', label: '辩护人辩护', type: 'ai', speaker: '辩护人' },
  { id: 'free_debate_judge', label: '审判长宣布自由辩论开始', type: 'ai', speaker: '审判长' },
  { id: 'free_debate', label: '自由辩论', type: 'interactive', speaker: '公诉人' },
  { id: 'victim_opinion', label: '被害人及其诉讼代理人发言', type: 'ai', speaker: '被害人' },
  { id: 'defendant_self', label: '被告人自行辩护', type: 'ai', speaker: '被告人' },
  { id: 'announce_end', label: '审判长宣布法庭辩论结束', type: 'ai', speaker: '审判长' },
];

export const CRIMINAL_FLOWS: Record<FlowPhase, Record<FlowRole, StageDef[]>> = {
  investigation: {
    judge: JUDGE_INVESTIGATION,
    defender: DEFENDER_INVESTIGATION,
    prosecutor: PROSECUTOR_INVESTIGATION,
  },
  debate: {
    judge: JUDGE_DEBATE,
    defender: DEFENDER_DEBATE,
    prosecutor: PROSECUTOR_DEBATE,
  },
};
