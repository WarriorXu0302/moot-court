/**
 * 对抗式民商事案件（国际商事仲裁 / 涉外民商事诉讼）的"场景配置"。
 *
 * arbitration-hearing / arbitration-writing / arbitration-closing 三个页面原本写死仲裁用语，
 * 现在两种类型共用这三个页面，页面里所有随类型变化的措辞、知识、风格、文书都从这里取，
 * 页面本身不再出现 caseType 判断。新增类型时只需在 PROFILES 里加一项。
 */
import type { AdversarialCaseType } from './case-type';
import type { UserRole } from './types';
import type { ArbitrationDoc } from './arbitration-route';
import { ARB_INVESTIGATION_STYLE, ARB_DEBATE_STYLE, CIVIL_INVESTIGATION_STYLE, CIVIL_DEBATE_STYLE } from './arbitration-style';
import {
  ARB_OPENING_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_WITNESS_KNOWLEDGE,
  ARB_CLOSING_KNOWLEDGE, ARB_DELIBERATION_KNOWLEDGE,
} from './arbitration-knowledge';
import {
  CIVIL_PROCEDURE_KNOWLEDGE, CIVIL_CONFLICT_KNOWLEDGE, CIVIL_JURISDICTION_KNOWLEDGE, CIVIL_EVIDENCE_KNOWLEDGE, CIVIL_JUDGMENT_KNOWLEDGE,
} from './civil-knowledge';

export interface DocConfig {
  title: string;
  /** 评分标准环节 key（对应评分框架 stages[].key） */
  stageKey: string;
  /** 样例在 plead 文书卷中的标题关键词 */
  sampleKeyword: string;
  structure: string;
  evalPoints: string[];
  knowledge: string;
  who: string;
}

export interface ForumProfile {
  /** 场景名，用于提示词："一场国际商事仲裁庭审" */
  hearingName: string;
  /** 训练名："模拟仲裁训练" */
  trainingName: string;
  /** AI 教授身份 */
  professor: string;
  /** 卷宗中文书卷的叫法 */
  pleadLabel: string;
  /** 法庭/仲裁庭的自称，用于"留到后面的「仲裁庭提问」环节" */
  tribunalQuestionStage: string;
  /** 自由辩论等无 responder 时的默认回应者 */
  opponentOf: Record<UserRole, string>;
  /** 调查/辩论各阶段的知识与风格 */
  investigationKnowledge: string[];
  debateKnowledge: string[];
  investigationStyle: string;
  debateStyle: string;
  /** 评分环节 key */
  stageKeys: { investigation: string; debate: string };
  docs: Record<ArbitrationDoc, DocConfig>;
  /** 写作页的三个快捷提问 */
  quickQuestions: (docTitle: string) => string[];
  /** 庭审页语音模式的庭室布局（座位名必须与 flows 里的 speaker 一致，才能高亮当前发言人） */
  courtroom: {
    /** 审判席 / 仲裁庭席，中间为主持者 */
    bench: [string, string, string];
    clerk: string;
    left: { seat: string; caption: string };
    right: { seat: string; caption: string };
    witnesses: string[];
  };
  /** 闭庭页 */
  closing: {
    pageRecord: string;
    title: string;
    judgeLine: string;
    partyLine: string;
    judgeSummary: string;
    partySummary: string;
    analysisFocus: string;
    reportTitle: string;
  };
}

const ARBITRATION: ForumProfile = {
  hearingName: '国际商事仲裁庭审',
  trainingName: '模拟仲裁训练',
  professor: '国际仲裁与国际民事诉讼法教授',
  pleadLabel: '仲裁文书卷',
  tribunalQuestionStage: '仲裁庭提问',
  opponentOf: { prosecutor: '被申请人代理人', defender: '申请人代理人', judge: '申请人代理人' },
  investigationKnowledge: [ARB_OPENING_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_WITNESS_KNOWLEDGE],
  debateKnowledge: [ARB_CLOSING_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE],
  investigationStyle: ARB_INVESTIGATION_STYLE,
  debateStyle: ARB_DEBATE_STYLE,
  stageKeys: { investigation: 'arb-investigation', debate: 'arb-debate' },
  docs: {
    claim: {
      title: '仲裁申请书',
      stageKey: 'arb-claim-writing',
      sampleKeyword: '申请书',
      structure: '当事人基本情况 → 仲裁请求（具体、可执行、含金额与费用）→ 仲裁协议及管辖依据 → 事实与理由（请求权基础、事实经过、法律依据）→ 证据清单 → 此致/申请人/日期',
      evalPoints: ['当事人信息与代理权限是否完整准确', '仲裁请求是否具体明确、金额计算是否有依据', '仲裁协议与管辖依据是否充分，准据法论证是否到位', '事实陈述与证据对应是否清晰', '法律依据是否准确，是否存在编造条文或判例', '文书格式与语言是否规范'],
      knowledge: [ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE].join('\n\n'),
      who: '申请人代理人',
    },
    answer: {
      title: '答辩状（含反请求）',
      stageKey: 'arb-answer-writing',
      sampleKeyword: '答辩',
      structure: '答辩人基本情况 → 对仲裁请求的答辩意见 → 管辖权异议（如有）→ 事实抗辩 → 法律抗辩 → 反请求（如有）→ 证据清单 → 此致/答辩人/日期',
      evalPoints: ['是否针对申请人的每项仲裁请求逐一答辩', '管辖权异议是否抓住仲裁协议的存在、效力、范围、准据法', '事实抗辩与证据是否对应', '法律抗辩是否准确，是否存在编造条文或判例', '反请求（如有）是否有独立的请求权基础与金额依据', '文书格式与语言是否规范'],
      knowledge: [ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE].join('\n\n'),
      who: '被申请人代理人',
    },
    award: {
      title: '裁决书',
      stageKey: 'arb-award-writing',
      sampleKeyword: '裁决',
      structure: '当事人及代理人 → 仲裁程序概述 → 案件事实与各方主张 → 争议焦点 → 仲裁庭意见（管辖权 / 事实认定 / 法律适用）→ 裁决主文 → 仲裁费用承担 → 作出地点与日期 → 仲裁员签名',
      evalPoints: ['争议焦点归纳是否准确、完整', '管辖权问题是否先行说理', '事实认定是否基于证据，证明责任分配是否正确', '法律适用是否准确（仲裁协议准据法、实体准据法）', '裁决主文是否明确、可执行，与仲裁请求对应，无超裁漏裁', '仲裁费用承担是否有理由，裁决书格式是否规范'],
      knowledge: [ARB_DELIBERATION_KNOWLEDGE, ARB_JURISDICTION_KNOWLEDGE, ARB_EVIDENCE_KNOWLEDGE, ARB_OPENING_KNOWLEDGE].join('\n\n'),
      who: '首席仲裁员',
    },
  },
  quickQuestions: (t) => [`${t}应该包括哪些部分？`, '本案的管辖权争点应该怎么组织论证？', '请帮我检查请求事项写得是否具体可执行'],
  courtroom: {
    bench: ['边裁甲', '首席仲裁员', '边裁乙'],
    clerk: '仲裁秘书',
    left: { seat: '申请人代理人', caption: '申请人' },
    right: { seat: '被申请人代理人', caption: '被申请人' },
    witnesses: ['证人', '专家证人'],
  },
  closing: {
    pageRecord: '仲裁闭庭',
    title: '仲裁庭审结束',
    judgeLine: '首席仲裁员宣布裁决已作出，本案仲裁程序终结，现在闭庭。',
    partyLine: '仲裁庭将就本案合议并作出裁决。本次模拟庭审到此结束，现在闭庭。',
    judgeSummary: '首席仲裁员宣布裁决并闭庭',
    partySummary: '听取仲裁庭宣布裁决结果并闭庭',
    analysisFocus: '管辖权论证、证据运用与质证、法律适用（含仲裁协议准据法）、程序意识、文书质量、以及对 AI 生成法律依据的核查意识',
    reportTitle: '模拟仲裁训练分析',
  },
};

const CIVIL: ForumProfile = {
  hearingName: '涉外民商事诉讼一审庭审',
  trainingName: '涉外民商事诉讼模拟训练',
  professor: '国际私法与国际民事诉讼法教授',
  pleadLabel: '诉讼文书卷',
  tribunalQuestionStage: '审判长发问',
  opponentOf: { prosecutor: '被告代理人', defender: '原告代理人', judge: '原告代理人' },
  investigationKnowledge: [CIVIL_PROCEDURE_KNOWLEDGE, CIVIL_CONFLICT_KNOWLEDGE, CIVIL_JURISDICTION_KNOWLEDGE, CIVIL_EVIDENCE_KNOWLEDGE],
  debateKnowledge: [CIVIL_CONFLICT_KNOWLEDGE, CIVIL_JURISDICTION_KNOWLEDGE, CIVIL_EVIDENCE_KNOWLEDGE],
  investigationStyle: CIVIL_INVESTIGATION_STYLE,
  debateStyle: CIVIL_DEBATE_STYLE,
  stageKeys: { investigation: 'civil-investigation', debate: 'civil-debate' },
  docs: {
    claim: {
      title: '民事起诉状',
      stageKey: 'civil-claim-writing',
      sampleKeyword: '起诉',
      structure: '原告、被告基本情况 → 诉讼请求（具体、可执行）→ 管辖依据 → 事实与理由（涉外因素、法律关系定性、准据法及其冲突规范依据、实体请求权基础）→ 证据清单 → 此致/具状人/日期',
      evalPoints: ['当事人信息是否完整准确（域外主体的主体资格证明）', '诉讼请求是否具体明确、可执行', '管辖依据是否充分', '涉外性、定性与准据法论证是否准确，冲突规范与连结点是否找对', '实体法依据是否准确，是否存在编造条文或判例', '文书格式与语言是否规范'],
      knowledge: [CIVIL_CONFLICT_KNOWLEDGE, CIVIL_JURISDICTION_KNOWLEDGE, CIVIL_EVIDENCE_KNOWLEDGE].join('\n\n'),
      who: '原告代理人',
    },
    answer: {
      title: '答辩状',
      stageKey: 'civil-answer-writing',
      sampleKeyword: '答辩',
      structure: '答辩人基本情况 → 管辖异议（如有）→ 对诉讼请求的逐项答辩 → 法律适用抗辩（定性、准据法、强制性规定或公共秩序保留）→ 事实抗辩 → 证据清单 → 此致/答辩人/日期',
      evalPoints: ['是否针对原告每项诉讼请求逐一答辩', '管辖异议（如有）理由是否充分', '定性与准据法抗辩是否有冲突法依据', '事实抗辩与证据是否对应', '法律依据是否准确，是否存在编造条文或判例', '文书格式与语言是否规范'],
      knowledge: [CIVIL_CONFLICT_KNOWLEDGE, CIVIL_JURISDICTION_KNOWLEDGE, CIVIL_EVIDENCE_KNOWLEDGE].join('\n\n'),
      who: '被告代理人',
    },
    award: {
      title: '民事判决书',
      stageKey: 'civil-judgment-writing',
      sampleKeyword: '判决',
      structure: '当事人及代理人 → 案由与审理经过 → 原告诉称 → 被告辩称 → 本院查明 → 本院认为（管辖 → 涉外性与定性 → 冲突规范与准据法、外国法查明 → 实体争点）→ 判决主文 → 诉讼费用负担 → 上诉权利告知',
      evalPoints: ['争议焦点归纳是否准确、完整', '"本院认为"是否先就法律适用说理（涉外性、定性、冲突规范、准据法）', '外国法查明（如涉及）的途径与结论是否交代清楚', '事实认定是否基于证据，证明责任分配是否正确', '判决主文是否明确、可执行，与诉讼请求对应', '诉讼费用负担与上诉告知是否规范，格式是否规范'],
      knowledge: [CIVIL_JUDGMENT_KNOWLEDGE, CIVIL_CONFLICT_KNOWLEDGE, CIVIL_EVIDENCE_KNOWLEDGE].join('\n\n'),
      who: '审判长',
    },
  },
  quickQuestions: (t) => [`${t}应该包括哪些部分？`, '本案的准据法应该怎么论证？', '请帮我检查诉讼请求写得是否具体可执行'],
  courtroom: {
    bench: ['审判员', '审判长', '审判员'],
    clerk: '书记员',
    left: { seat: '原告代理人', caption: '原告' },
    right: { seat: '被告代理人', caption: '被告' },
    witnesses: ['证人', '外国法查明专家'],
  },
  closing: {
    pageRecord: '宣判',
    title: '庭审结束',
    judgeLine: '审判长宣告判决，告知当事人上诉权利与期限，现在闭庭。',
    partyLine: '合议庭将评议后宣判。本次模拟庭审到此结束，现在闭庭。',
    judgeSummary: '审判长宣告判决并闭庭',
    partySummary: '听取法庭宣判并闭庭',
    analysisFocus: '涉外性认定与定性、冲突规范与准据法论证、外国法查明、证据运用与质证、程序意识、文书质量、以及对 AI 生成法律依据的核查意识',
    reportTitle: '涉外民商事诉讼训练分析',
  },
};

const PROFILES: Record<AdversarialCaseType, ForumProfile> = { arbitration: ARBITRATION, civil: CIVIL };

export function getForumProfile(caseType: unknown): ForumProfile {
  return caseType === 'civil' ? PROFILES.civil : PROFILES.arbitration;
}

export function adversarialType(caseType: unknown): AdversarialCaseType {
  return caseType === 'civil' ? 'civil' : 'arbitration';
}
