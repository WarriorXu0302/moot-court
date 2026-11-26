/**
 * 庭审 AI 发言的提示词与规则（仲裁 / 涉外民商事诉讼共用）。
 *
 * 从 arbitration-hearing/page.tsx 抽出，页面和 scripts/hearing-sim.ts（整场模拟 + 逐句检查）共用同一份逻辑：
 * 模拟器测到的就是页面真正发出去的提示词。改这里的措辞后用模拟器回归一遍。
 */
import type { CaseData, ChatMessage, UserRole } from './types';
import type { StageDef, FlowPhase } from './flows';
import type { ForumProfile } from './forum-profile';
import { findPerson } from './arbitration-case-utils';
import { isPresiding, stripPartyDirectives } from './hearing-directives';
import { parseLifecycleFromAIResponse } from './lifecycle-utils';
import { REPLY_FORMAT_VOICE } from './response-style';

/**
 * 庭审文字模式的输出形式。不用通用的 REPLY_FORMAT_TEXT：那份要求"加粗关键术语、用 1. 2. 3. 列表"，
 * 放进庭审笔录就成了"1. **有管辖权不等于必须行使管辖权。**"这种展示稿，不像当庭口头发言（模拟器审阅反复标出）。
 */
export const HEARING_REPLY_FORMAT_TEXT = `

【输出形式：庭审笔录】你的发言会作为庭审笔录显示在屏幕上，相当于书记员记下的当庭口头发言：
- 用当庭说话的口吻，句子完整自然；需要分点时用"第一、……第二、……"这样的口头表达，可以分段
- 不要使用任何 markdown 标记：不加粗、不用标题、不用"1."或"-"开头的列表、不用表格
- 不用括号描述神情、动作、语气
- 以上要求只针对发言正文；LIFECYCLE 标签协议不受影响，按原样输出`;

export function hearingReplyFormat(voiceMode: boolean): string {
  return voiceMode ? REPLY_FORMAT_VOICE : HEARING_REPLY_FORMAT_TEXT;
}

export type HearingMode = 'stage' | 'respond' | 'user-reply';

export interface HearingCtx {
  caseData: CaseData | null | undefined;
  profile: ForumProfile;
  phase: FlowPhase;
  pageName: string;
  role: UserRole;
  roleLabel: string;
  stages: StageDef[];
}

/** 只有主持人能安排程序；当事人、证人、专家不得点名或"请审判长……" */
export function presidingRules(ctx: HearingCtx, speaker: string, nextSpeaker?: string): string {
  const chair = ctx.profile.courtroom.bench[1];
  return isPresiding(speaker)
    ? `- 你是庭审主持人，可以在发言结尾按下一环节的内容点名下一位发言人（如"请${nextSpeaker ?? '各方'}……"），但不要提出与下一环节无关的要求；`
    : `- 你不是庭审主持人。庭审程序由${chair}主持：**不得**在发言中点名其他人发言，不得说"请原告/被告代理人……""请${chair}宣布……""请${chair}向……发问"之类安排程序的话；发言完毕即结束（可以说"发表完毕"）。`;
}

/**
 * 各环节的"要点清单"：这一步按真实庭审应当包含的内容（2026-11 依 scripts/hearing-sim.ts 审阅逐条补齐）。
 * key 为 StageDef.id；仲裁与诉讼共用 id 的，用 civil / arb 区分措辞。
 */
type Guide = string | { civil: string; arb: string };
const STAGE_GUIDES: Record<string, Guide> = {
  clerk_opening: '查明并报告双方当事人及代理人到庭情况（当事人以起诉状所列为准逐一报告；「庭审设定」中没有代理人的当事人，报告"未到庭"）；逐条宣读法庭纪律（不得录音录像拍照、关闭通讯工具、未经许可不得发言、不得喧哗走动等）；最后说"报告审判长，双方委托诉讼代理人均已到庭"（只报告代理人，不说当事人本人到庭）。不对案件发表意见。',
  secretary_opening: '核实并报告双方当事人及代理人到庭情况（「庭审设定」中列为未到庭的当事人，报告其未到庭）；宣读庭审纪律；最后报告首席仲裁员"双方代理人均已到庭"。不对案件发表意见。',
  opening_remarks: {
    civil: '依次：宣布开庭；宣布案由与审理程序（普通程序、合议庭审理）；宣布合议庭组成和书记员（说清人数与分工："本案由审判长、审判员两名组成合议庭，书记员担任记录"；本训练不使用真实姓名）；告知诉讼权利（申请回避、提供证据、进行辩论、请求调解、发表最后意见等）与义务（如实陈述、遵守法庭纪律等）；「庭审设定」列有未到庭当事人的，说明"被告某某经本院合法传唤未到庭，本院依法缺席审理"（不要问其他代理人能否代表它）；最后请双方依次说明出庭身份、代理权限，是否申请回避。你只问，不替当事人回答。',
    arb: '依次：宣布开庭；说明案件名称与适用的仲裁规则；介绍仲裁庭组成（首席仲裁员与两名边裁仲裁员、仲裁秘书，说清各自由谁选定或指定；本训练不使用真实姓名）；告知当事人申请回避、陈述、举证、辩论等权利与如实陈述等义务；最后请双方依次说明出庭身份、代理权限，对仲裁庭组成有无异议、是否申请回避。你只问，不替当事人回答。',
  },
  identity_plaintiff: '说明：受哪一方委托出庭（如"原告某某公司的委托诉讼代理人"）、代理权限（按上下文「庭审设定」里的代理权限和授权事项如实说明，不要说"以授权委托书为准"）；对对方出庭人员身份有无异议；是否申请合议庭成员、书记员回避。用"本人"自称，不编造姓名、律所，也不要自称"执业律师"等设定里没有的身份。',
  identity_defendant: '说明：受哪一方委托出庭、代理权限（按上下文「庭审设定」里的代理权限和授权事项如实说明，不要说"以授权委托书为准"）；对对方出庭人员身份有无异议；是否申请合议庭成员、书记员回避。用"本人"自称，不编造姓名、律所。',
  identity_claimant: '说明：受哪一方委托出庭、代理权限（按上下文「庭审设定」里的代理权限和授权事项如实说明）；对仲裁庭组成有无异议、是否申请仲裁员回避。用"本人"自称，不编造姓名、律所。',
  identity_respondent: '说明：受哪一方委托出庭、代理权限（按上下文「庭审设定」里的代理权限和授权事项如实说明）；对仲裁庭组成有无异议、是否申请仲裁员回避。用"本人"自称，不编造姓名、律所。',
  plaintiff_claims: '先逐项宣读诉讼请求（具体、可执行，有金额的写明金额），再简要说明事实与理由。',
  claimant_opening: '先逐项说明仲裁请求（具体、可执行），再说明事实与理由、法律依据。',
  defendant_answer: '先明确是否对管辖提出异议及理由，再逐项回应对方请求：承认哪些事实、否认哪些事实、理由与依据。',
  respondent_opening: '逐项回应申请人的请求：承认哪些事实、否认哪些事实、理由与依据；如有反请求一并提出。',
  jurisdiction_objection: '依次说明：异议的对象（仲裁协议的存在、效力或范围）、事实理由、法律依据、请求仲裁庭作出何种决定。',
  claimant_jurisdiction_reply: '逐点回应对方的管辖异议理由，说明仲裁协议有效、仲裁庭有管辖权的依据。',
  tribunal_ruling_juris: '归纳双方关于管辖的分歧（每点一句），说明仲裁庭的处理方式（先行决定或并入实体一并审理）。不对管辖结论表态。',
  focus: '把程序问题（管辖）与实体问题分开归纳，每个焦点一句话；被告提出管辖异议的，本次只审查管辖异议：只归纳与管辖有关的焦点，实体事实只在与管辖审查有关的限度内调查，不把实体责任列为本次焦点；最后问双方"对本庭归纳的争议焦点有无异议或补充"——由双方在下一环节回答，你不替他们回答。',
  focus_plaintiff: '简短表态：同意或不同意本庭归纳的焦点；有补充的只说补充的焦点，一两句。',
  focus_defendant: '简短表态：同意或不同意本庭归纳的焦点；有补充的只说补充的焦点，一两句。',
  law_plaintiff: '依次说明：涉外因素 → 法律关系定性及依据 → 援引的冲突规范与连结点 → 准据法结论；需要查明外国法的，说明由谁提供、通过什么途径。',
  law_defendant: '回应对方的法律适用主张，依次说明你方对定性、冲突规范与连结点、准据法的意见；需要查明外国法的，说明由谁提供、通过什么途径。',
  evidence_plaintiff: '逐份出示：证据名称、来源、证明目的（每份一两句），最后说"举证完毕"。',
  evidence_defendant: '逐份出示：证据名称、来源、证明目的（每份一两句），最后说"举证完毕"。',
  evidence_claimant: '逐份出示：证据名称、来源、证明目的（每份一两句），最后说"举证完毕"。',
  evidence_respondent: '逐份出示：证据名称、来源、证明目的（每份一两句），最后说"举证完毕"。',
  plaintiff_cross: '逐份证据按真实性、合法性、关联性表态并说明理由；对证明目的有异议的单独说明；最后说"质证完毕"。',
  defendant_cross: '逐份证据按真实性、合法性、关联性表态并说明理由；对证明目的有异议的单独说明；最后说"质证完毕"。',
  cross_claimant_evidence: '逐份证据按真实性、合法性、关联性表态并说明理由；对证明目的有异议的单独说明；最后说"质证完毕"。',
  claimant_cross_respondent: '逐份证据按真实性、合法性、关联性表态并说明理由；对证明目的有异议的单独说明；最后说"质证完毕"。',
  witness_notice: {
    civil: '传证人到庭；核实证人身份（称"证人"，不编姓名）、职业、工作单位及与双方当事人的关系；告知证人应当如实作证，作伪证的，人民法院可以根据情节予以罚款、拘留，构成犯罪的依法追究刑事责任；请证人报告身份及与双方的关系、并请证人签署保证书——由证人在下一句回答，你只问不替证人答。',
    arb: '请证人到庭；核实证人身份（称"证人"，不编姓名）及与双方当事人的关系；告知其应如实陈述所知事实、不作猜测，请证人报告身份及与双方的关系——由证人在下一句回答，你只问不替证人答。',
  },
  expert_notice: '请专家到庭，请其说明专业背景、受哪方委托或由法庭（仲裁庭）指定、与双方有无利害关系、本次意见的范围——由专家在下一句回答，你只问不替专家答。',
  witness_exam: '每轮只问一个问题（最多两个紧密相关的小问），等证人回答后再问；直接询问用开放式问题、不诱导。"询问完毕"只能在不再提问的那一轮单独说，不能和问题放在同一次发言里。',
  witness_cross: '每轮只问一个问题（最多两个紧密相关的小问），等证人回答后再问；围绕证言中不清楚或矛盾之处。"询问完毕"只能在不再提问的那一轮单独说，不能和问题放在同一次发言里。',
  expert_exam: '每轮只问一个问题，等专家回答后再问；围绕专家的专业范围、所依据的法律文本或资料、方法与结论之间的联系。"询问完毕"只能在不再提问的那一轮单独说，不能和问题放在同一次发言里。',
  court_questions: '只问一个问题，指向本案事实或法律适用中尚不清楚的一点。',
  tribunal_questions: '只问一个问题，指向本案事实或法律适用中尚不清楚的一点。',
  closing_check: { civil: '询问双方有无新的证据或需要补充的调查意见，请原告代理人先回答。只问这一句，不要宣布调查结束。', arb: '询问双方有无新的证据或需要补充的意见，请申请人代理人先回答。只问这一句，不要宣布调查结束。' },
  closing_check_plaintiff: '一两句：有无新证据或补充调查意见（一般为"没有新的证据"或简要说明一项补充）。',
  closing_check_defendant: '一两句：有无新证据或补充调查意见。',
  closing_check_claimant: '一两句：有无新证据或补充意见。',
  closing_check_respondent: '一两句：有无新证据或补充意见。',
  closing_investigation: '根据双方刚才的回答（有补充申请的先作出处理），宣布法庭调查结束，说明下一步将进入法庭辩论。不要请任何人发表辩论意见，本阶段到此结束。',
  closing_procedure: '根据双方刚才的回答（有补充申请的先作出处理），宣布庭审调查结束，说明下一步将进入辩论。不要请任何人发表辩论意见，本阶段到此结束。',
  announce_debate: '宣布辩论开始，提示双方围绕争议焦点发表意见、不要重复调查阶段已陈述的事实，请原告（申请人）代理人先发言。',
  second_round: '点明双方仍有分歧的一两个焦点，提醒不要重复第一轮意见，请原告代理人先发言。',
  plaintiff_second: '只回应对方第一轮的新观点和主持人刚提出的要求，不重复自己第一轮的内容。',
  defendant_second: '只回应对方第一轮的新观点和主持人刚提出的要求，不重复自己第一轮的内容。',
  free_claimant: '只回应对方结案陈词中的新观点和主持人刚提出的要求，不重复结案陈词。',
  free_respondent: '只回应对方刚才的观点和主持人刚提出的要求，不重复结案陈词。',
  close_debate: '宣布法庭辩论终结，请原告、被告依次发表最后意见。',
  plaintiff_final: '20-60 字：坚持或变更哪些请求。',
  defendant_final: '20-60 字：坚持哪些抗辩、请求法庭如何处理。',
  mediation: { civil: '询问双方是否愿意在法庭主持下调解。只问，不评价、不劝说。', arb: '询问双方是否愿意在仲裁庭主持下调解。只问，不评价、不劝说。' },
  mediation_plaintiff: '明确表示同意或不同意调解；同意的，简要说明可接受的方向。被问到调解授权时，按「庭审设定」里的代理权限回答：特别授权且含和解事项的可以代为调解，一般代理的说明方案需报委托人确认。',
  mediation_defendant: '明确表示同意或不同意调解；同意的，简要说明可接受的方向。被问到调解授权时，按「庭审设定」里的代理权限回答：特别授权且含和解事项的可以代为调解，一般代理的说明方案需报委托人确认。',
  mediation_claimant: '明确表示同意或不同意调解；同意的，简要说明可接受的方向。被问到调解授权时，按「庭审设定」里的代理权限回答：特别授权且含和解事项的可以代为调解，一般代理的说明方案需报委托人确认。',
  mediation_respondent: '明确表示同意或不同意调解；同意的，简要说明可接受的方向。被问到调解授权时，按「庭审设定」里的代理权限回答：特别授权且含和解事项的可以代为调解，一般代理的说明方案需报委托人确认。',
  announce_end: {
    civil: '宣布休庭，说明合议庭将进行评议、择期宣判，提示双方庭后核对并签署庭审笔录。不对结果作任何表态。',
    arb: '宣布辩论结束、休庭，说明仲裁庭将进行合议并依规则作出裁决，提示双方庭后核对并签署庭审笔录。不对结果作任何表态。',
  },
};

function guideFor(ctx: HearingCtx, stageId?: string): string {
  const g = stageId ? STAGE_GUIDES[stageId] : undefined;
  if (!g) return '';
  return typeof g === 'string' ? g : ctx.profile.courtroom.clerk === '书记员' ? g.civil : g.arb;
}

/** 被询问方（证人、专家、当事人、主持人）回应时的要点 */
function respondGuide(ctx: HearingCtx, speaker: string, stageId?: string): string {
  if (speaker === '证人') {
    if (stageId === 'witness_notice') return '按「庭审设定」报告身份（称"本人"，说工作单位、职务和任职期间）、与双方当事人的关系，表示清楚如实作证的义务、愿意签署保证书，20-80 字。被问到年龄等设定里没有的个人信息，说"相关信息见本人提交的身份证件"即可。';
    return '一问一答：只回答刚才那一个问题，2-80 字。上下文「庭审设定」列出了你能作证的事实和你不知道的事项：能作证的，直接、具体地回答（是或不是、谁、什么时候、在哪里、你做了什么）；问到设定里没有的事，说清你能确认到哪一步，例如"我能确认的是……，除此之外的情况我不能确定"，不要只回一句"不清楚"，也不要编造细节或用"以原始材料为准"回避。被追问你先前说法的依据时，按你的职务说明是怎么知道的（例如作为经办人看到合同文本、银行回单，或参加了某次会议）。设定里列为你能作证的事实，被追问时坚持，不要改口说"不能确认"。';
  }
  if (speaker.includes('专家') && stageId === 'expert_notice') return '按「庭审设定」说明专业背景、出庭依据（由谁申请或由法庭通知）、与双方的利害关系、本次意见的范围，40-100 字；设定没写的不要编造。';
  if (speaker.includes('专家')) return '只回答刚才的问题：先直接给出回答，再说明所依据的法律文本或资料；哪些是法律本身的规定、哪些是你的专业看法，用自然的说法区分（如"该条规定……；在我看来……"），不要每次都贴"法律内容/学理意见"标签；不对本案事实作认定，40-150 字。';
  if (isPresiding(speaker)) return '一两句、≤60 字，不评价对错、不复述对方说过的内容。对方提出了程序请求（调整或补充争议焦点、申请补充证据、申请证人出庭等）时，当场明确处理：准许（并说明提交期限）、不准许（简述理由）或"庭后合议决定"，不要只说"已记录"；请求的事项已经在本庭归纳的焦点或调查范围内的，直接说明"该问题已在本次审理范围内"，不要再当作待决请求。';
  if (stageId && /^evidence_/.test(stageId)) return '这是对刚才出示的证据发表质证意见：逐份按真实性、合法性、关联性表态并说明理由，最后说"质证完毕"。';
  return '';
}

/**
 * 主持人在"回应"他人时也要知道下一环节，才能正确点名。原先回应模式不带环节信息，
 * 主持人凭感觉点名，曾跳过"被申请人提出管辖权异议"直接请申请人作开庭陈述（模拟器第二轮）。
 */
function respondNext(ctx: HearingCtx, speaker: string, stageId?: string): string {
  if (!isPresiding(speaker) || !stageId) return '';
  const idx = ctx.stages.findIndex((st) => st.id === stageId);
  const next = idx >= 0 ? ctx.stages[idx + 1] : undefined;
  if (!next) return '\n本环节是本阶段最后一个环节，回应后不要再点名任何人，也不要开启下一阶段。';
  if (next.speaker === speaker) return `\n下一环节「${next.label}」仍由你进行，这里只做记录，不要点名其他人。`;
  return `\n下一环节是「${next.label}」，由${next.speaker}进行。如需点名，只能点名${next.speaker}做这件事，不要跳过或提前其他环节。`;
}

/**
 * AI 阶段发言的环节说明：告诉 AI 当前是哪个环节、下一环节由谁做什么、本环节要点。
 * 原先只说"推演庭审进展"，AI 不知道环节边界，会自行插入流程里没有的步骤。
 */
export function stageInstruction(ctx: HearingCtx, label: string, round?: { k: number; n: number }): string {
  const idx = ctx.stages.findIndex((st) => st.label === label);
  const cur = idx >= 0 ? ctx.stages[idx] : undefined;
  const next = idx >= 0 ? ctx.stages[idx + 1] : undefined;
  const nextText = next
    ? `下一环节是「${next.label}」，由${next.speaker}${next.type === 'interactive' ? `（即用户扮演的${ctx.roleLabel}）` : ''}进行。`
    : '本环节是本阶段的最后一个环节，本阶段到此结束，不要开启下一阶段的程序。';
  const guide = guideFor(ctx, cur?.id);
  const roundText = round && round.n > 1
    ? `\n- 本环节最多 ${round.n} 轮问答，这是第 ${round.k} 轮：只问一个问题，等对方回答。${round.k > 1 ? '根据对方上一次的回答继续追问，不要重复已经问过的问题；' : ''}${round.k === round.n ? '这是最后一轮，问完后说"询问完毕"。' : '已经没有要问的就只说"询问完毕"。'}`
    : '';
  const chairAsk = cur && !isPresiding(cur.speaker)
    ? `\n- 如果${ctx.profile.courtroom.bench[1]}在最近一次发言中向你提出了具体问题或要求，先回应这些问题和要求，再完成本环节。`
    : cur
      ? '\n- 如果上一位发言人刚提出了程序请求（补充证据、调整焦点、申请证人等），先用一句话当场处理（准许并给期限 / 不准许并说理由 / 已在本次审理范围内），再完成本环节。'
      : '';
  return `当前程序环节：「${label}」。你只完成这一个环节应做的事，${nextText}${guide ? `\n- 本环节要点：${guide}` : ''}${roundText}${chairAsk}
${presidingRules(ctx, cur?.speaker ?? '', next?.speaker)}
- 不要插入阶段表以外的程序步骤（如额外核实身份、额外提问后等待回答），也不要替下一位发言人回答。`;
}

export interface PromptOpts { stageId?: string; round?: { k: number; n: number } }

/** 发问方表示问完了 */
export function isQuestioningDone(text: string): boolean {
  return /(询问|发问|提问)完毕|没有(其他|别的)?问题了|没有要问的/.test(text);
}

export function buildHearingSystemPrompt(ctx: HearingCtx, speaker: string, mode: HearingMode, arg: string, opts: PromptOpts = {}): string {
  const { profile, phase, pageName, roleLabel, caseData } = ctx;
  const person = findPerson(caseData, speaker);
  const personText = person ? `\n你的角色设定：${person.set}\n你应当如实陈述或坚持的核心信息：${person.message}\n` : '';
  const intro =
    mode === 'respond'
      ? `刚才${arg}向你提问或发言（见对话记录最后一条），请你以${speaker}的身份回应。注意：你是被询问的对象，只回应刚才的提问，不要代替${arg}或其他任何角色发言，更不要自行继续提问。${respondGuide(ctx, speaker, opts.stageId) ? `\n要点：${respondGuide(ctx, speaker, opts.stageId)}` : ''}${respondNext(ctx, speaker, opts.stageId)}`
      : mode === 'user-reply'
        ? `用户（${roleLabel}）刚刚发言："${arg}"，请你以${speaker}的身份简短回应。${respondGuide(ctx, speaker, opts.stageId) ? `要点：${respondGuide(ctx, speaker, opts.stageId)}` : ''}${respondNext(ctx, speaker, opts.stageId)}注意：你只扮演${speaker}，不要代替${roleLabel}发言。**回应以陈述收尾，不要向${roleLabel}追问或要求其补充回答**——用户在本环节没有再次发言的机会，追问会让问题悬空；需要追问的内容留到后面的"${profile.tribunalQuestionStage}"环节。`
        : stageInstruction(ctx, arg, opts.round);
  const knowledge = phase === 'investigation' ? profile.investigationKnowledge : profile.debateKnowledge;
  return `你正在模拟一场${profile.hearingName}（${pageName}）。你当前扮演的角色是"${speaker}"。
${personText}
${intro}
${mode !== 'stage' ? presidingRules(ctx, speaker) : ''}

可获取的资料：案件基本资料、${profile.pleadLabel}、证人与专家陈述笔录、证据材料、法律依据（见上下文）。${speaker === '证人' || speaker.includes('专家') ? '你只知道自己亲身经历或专业范围内的事实，不知道其他人的证言。' : ''}

请注意：
- 发言须符合角色身份与庭审语境，各角色的字数与语言风格必须严格符合下方【发言风格要求】（宣读法律文书、证据清单原文时按完整篇幅，不受此限）
- 依据案件资料发言，不得编造案情之外的事实、金额、日期
- 严禁代替其他角色发言，只扮演"${speaker}"这一个角色
- 你就在真实的庭审现场：不要说"模拟""训练""实训""AI""案件资料显示""材料节选""未载明""资料没有记载"等让人出戏的话，像当事人、法官本人那样说话；不知道的事就说不知道或不能确定
- 如果用户（${roleLabel}）提出明显偏离案件事实或法律规定的主张，不必顺着答，应指出差异并引导回到合法合理的论证路径

以下是程序与法律适用相关知识，供参考（具体条文号以法律或规则原文为准，不要自行编造条文号）：

${knowledge.join('\n\n')}

${phase === 'investigation' ? profile.investigationStyle : profile.debateStyle}`;
}

/** 发给模型的 user 消息：案件上下文 + 已有笔录 + 当前阶段 */
export function buildHearingUserContent(contextData: string, messages: ChatMessage[], mode: HearingMode, prompt: string, arg: string, roleLabel: string): string {
  return (
    contextData +
    '\n\n已有对话:\n' +
    messages.map((m) => `${m.speaker}: ${m.content}`).join('\n') +
    '\n\n当前阶段: ' + (mode === 'stage' ? prompt : mode === 'respond' ? `回应${arg}` : `回应${roleLabel}`)
  );
}

/** 模型输出落地前的整理：去掉 LIFECYCLE 标签；当事人发言结尾替主持人安排程序的句子剪掉 */
/** 同一次发言里既提问又说"询问完毕"：去掉"询问完毕"，让对方先回答，下一轮再结束 */
function dropPrematureDone(t: string): string {
  if (!/[？?]/.test(t)) return t;
  return t.replace(/[。，,\s]*(?:我方)?(?:的)?(?:询问|发问|提问)完毕[。！]?\s*$/, '').trimEnd();
}

export function finalizeHearingText(speaker: string, fullText: string): string {
  // 兜底去掉 markdown 加粗与标题符号：提示词已要求不用，模型偶尔仍会写，笔录里会显示成星号或大号标题
  const t = parseLifecycleFromAIResponse(fullText).replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '');
  return isPresiding(speaker) ? t : dropPrematureDone(stripPartyDirectives(t));
}

/**
 * 学生发言后由谁回应：
 * - 阶段配了 responder → 该角色回应（如审判长记录在案、证人回答学生的发问）；
 * - 没配 responder → 不回应，直接进入下一环节。原先默认由对方代理人回应，
 *   而下一环节往往就是对方代理人发言，于是笔录上对方连说两段（2026-11 学生截图）。
 */
export function responderForUserTurn(stage: StageDef | undefined, next?: StageDef): string | null {
  const r = stage?.responder ?? null;
  // 主持人的下一环节紧接着就由他本人发言：不再单独回一句"本庭已记录"，由下一环节一并处理（模拟器第六轮：主持人连说两段）
  if (r && next && next.speaker === r && isPresiding(r)) return null;
  return r;
}
