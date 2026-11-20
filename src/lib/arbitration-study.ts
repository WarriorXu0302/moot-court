/**
 * 仲裁案例的"案例研习"辅助：9 个思考题生成 + 庭前生命周期节点。
 *
 * 与刑事版（question-generator.ts / lifecycle-utils.ts）并列，页面按 caseType 选用。
 * 失败时一律回落到固定兜底题与固定节点，保证 UI 不卡住。
 */
import type { CaseData, CaseLifecycle, LifecycleNode, UserRole } from './types';
import { getRoleLabel, type AdversarialCaseType } from './case-type';
import { CIVIL_ROLE_FOCUS, CIVIL_FALLBACK, CIVIL_PRE_NODES, CIVIL_ROLE_PRE, CIVIL_PAGE_STAGE } from './civil-study';
import { describeArbitrationMeta } from './arbitration-case-utils';
import { useAppStore } from './store';

// ===== 思考题 =====

const ROLE_FOCUS: Record<UserRole, string> = {
  prosecutor: '申请人角度，重点关注仲裁请求的请求权基础、仲裁协议效力与管辖依据、证据链完整性、损失与金额计算、如何应对对方的管辖权异议',
  defender: '被申请人角度，重点关注管辖权异议（仲裁协议存在、效力、范围、准据法）、事实抗辩、证据瑕疵、法律抗辩、是否具备反请求空间',
  judge: '首席仲裁员角度，重点关注仲裁庭管辖权、争议焦点归纳、程序公平与正当程序、证据采信、法律适用（仲裁协议准据法与实体准据法）、裁决主文的可执行性',
};

const FALLBACK: Record<UserRole, string[]> = {
  prosecutor: [
    '1. 本案仲裁协议是如何约定的？是否存在效力瑕疵风险？',
    '2. 本案仲裁协议效力应适用哪国法律？依据是什么？',
    '3. 申请人的各项仲裁请求，请求权基础分别是什么？',
    '4. 支持仲裁请求的关键证据有哪些？能否形成完整证据链？',
    '5. 请求金额如何计算？计算依据是否充分？',
    '6. 对方可能提出哪些管辖权异议？如何答复？',
    '7. 本案有哪些事实证人与专家证人？各自要证明什么？',
    '8. 对方证据有哪些可以质证的点？',
    '9. 仲裁费用与代理费用应由谁承担？理由是什么？',
  ],
  defender: [
    '1. 本案仲裁协议是如何约定的？是否可以主张其无效或不适用？',
    '2. 本案仲裁协议效力应适用哪国法律？对被申请人是否有利？',
    '3. 申请人的仲裁请求，哪些在事实上站不住脚？',
    '4. 申请人证据在真实性、合法性、关联性上有哪些问题？',
    '5. 申请人的金额计算有哪些可质疑之处？',
    '6. 本案有哪些法律抗辩可以提出？',
    '7. 是否存在反请求的空间？请求权基础是什么？',
    '8. 对方证人与专家证人的证言有哪些矛盾或不可靠之处？',
    '9. 仲裁费用与代理费用应如何主张？',
  ],
  judge: [
    '1. 仲裁庭对本案是否有管辖权？仲裁协议效力应适用哪国法律？',
    '2. 本案的争议焦点有哪些？应如何归纳？',
    '3. 各争议焦点的证明责任应如何分配？',
    '4. 双方证据中，哪些可以采信，哪些存疑？',
    '5. 本案实体问题应适用什么法律？依据是什么？',
    '6. 事实证人与专家证人的证言可信度如何评估？',
    '7. 庭审中应如何保障双方的程序权利和平等陈述机会？',
    '8. 裁决主文应如何表述才明确且可执行？',
    '9. 仲裁费用应如何在双方之间分担？',
  ],
};

const toType = (t: unknown): AdversarialCaseType => (t === 'civil' ? 'civil' : 'arbitration');

export function getArbitrationFallbackQuestions(role: UserRole, caseType: unknown = 'arbitration'): string[] {
  return toType(caseType) === 'civil' ? CIVIL_FALLBACK[role] : FALLBACK[role];
}

export async function generateArbitrationQuestions(caseData: CaseData, role: UserRole): Promise<string[]> {
  const civil = toType(caseData.caseType) === 'civil';
  const fallback = civil ? CIVIL_FALLBACK[role] : FALLBACK[role];
  const system = `你是${civil ? '国际私法' : '国际仲裁与国际民事诉讼法'}教授，请根据以下案件资料，为${getRoleLabel(toType(caseData.caseType), role)}角色生成9个有针对性的思考题。

要求：
1. 问题必须紧密结合本案具体材料（当事人名称、合同条款、证据名称、争议焦点等），不能是泛泛的通用问题
2. 从${civil ? CIVIL_ROLE_FOCUS[role] : ROLE_FOCUS[role]}出发设计问题
3. 覆盖${civil ? '涉外性与定性、冲突规范与准据法、外国法查明、事实认定与证据、管辖与程序' : '管辖权与仲裁协议、事实认定、证据分析、法律适用、程序'}等维度
4. 每个问题有明确的分析指向
5. 只输出问题列表，每行一个，用数字编号，不要输出其他内容

输出格式：
1. 本案中[具体内容]...
（共9个问题）`;
  const ctx = `案件名称: ${caseData.name || ''}
案件概要: ${caseData.profile || ''}
${describeArbitrationMeta(caseData)}
案件基本资料: ${caseData.case || ''}
${civil ? '诉讼文书卷' : '仲裁文书卷'}: ${caseData.plead || ''}
证人与专家陈述: ${caseData.record || ''}
证据材料: ${caseData.evidence || ''}
法律依据: ${caseData.law || ''}`;

  try {
    const res = await fetch('/api/llm/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: ctx }], temperature: 0.4, caching: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body?.getReader();
    if (!reader) throw new Error('No reader');
    const decoder = new TextDecoder();
    let buffer = '';
    let full = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') break;
        try { const p = JSON.parse(data) as { content?: string }; if (p.content) full += p.content; } catch { /* skip */ }
      }
    }
    const qs = full
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+[.、)]\s*/.test(l))
      .map((l) => l.replace(/^\d+[.、)]\s*/, '').trim())
      .filter((l) => l.length > 0);
    if (qs.length >= 5) return qs.slice(0, 9).map((q, i) => `${i + 1}. ${q}`);
    return fallback;
  } catch {
    return fallback;
  }
}

// ===== 生命周期 =====

/**
 * 仲裁案件"庭前已完成"节点（固定内容，不调用 LLM）。
 * 法律依据只写通行原则，不写具体条文号——避免与课题"AI 幻觉防控"目标冲突；
 * 具体条文以所选仲裁规则文本为准，由课题组审核补充。
 */
const PRE_NODES: Record<string, LifecycleNode> = {
  签订仲裁协议: {
    stage: '签订仲裁协议',
    legalActions: '双方当事人在合同中订立仲裁条款或事后达成仲裁协议，约定将争议提交仲裁解决，并可约定仲裁机构、仲裁地、仲裁规则和仲裁协议适用的法律',
    documents: '含仲裁条款的合同或独立的仲裁协议书，是仲裁庭取得管辖权的基础文件',
    legalBasis: '仲裁以当事人合意为基础；仲裁协议具有独立性，其效力不当然随主合同的变更、解除或无效而丧失（具体条文以所适用的仲裁规则和法律为准）',
    completed: true,
  },
  争议发生: {
    stage: '争议发生',
    legalActions: '合同履行过程中双方就付款、交付、质量或违约责任等产生分歧，经协商未果，一方决定通过仲裁主张权利',
    documents: '往来函件、邮件、催款通知、违约通知等，用于固定争议产生的经过和各方立场',
    legalBasis: '当事人应在仲裁协议约定的范围内提起仲裁，争议事项须属于仲裁协议约定的事项且依法可以仲裁',
    completed: true,
  },
  提交仲裁申请: {
    stage: '提交仲裁申请',
    legalActions: '申请人向仲裁协议约定的仲裁机构递交仲裁申请书及证据材料，缴纳仲裁费用，仲裁程序由此启动',
    documents: '仲裁申请书（载明当事人、仲裁请求、事实与理由）、证据清单、授权委托书、仲裁协议副本',
    legalBasis: '仲裁申请书应包含具体的仲裁请求和事实理由，并附仲裁协议和证据（具体要求以所适用的仲裁规则为准）',
    completed: true,
  },
  受理与答辩: {
    stage: '受理与答辩',
    legalActions: '仲裁机构审查后受理案件并向被申请人送达仲裁通知，被申请人在规定期限内提交答辩，可同时提出管辖权异议或反请求',
    documents: '仲裁通知、答辩状（可含管辖权异议与反请求）',
    legalBasis: '被申请人有权就仲裁协议的存在、效力和范围提出异议；反请求应符合所适用仲裁规则的提出条件（具体期限以规则为准）',
    completed: true,
  },
  组成仲裁庭: {
    stage: '组成仲裁庭',
    legalActions: '双方当事人各自选定或委托仲裁机构指定一名仲裁员，并共同选定或由仲裁机构指定首席仲裁员，仲裁员披露与当事人的关系，当事人可申请回避',
    documents: '仲裁员选定通知、仲裁员声明书（披露独立性与公正性）',
    legalBasis: '仲裁员应当独立、公正；当事人对仲裁员的独立性有合理怀疑的，可以申请回避',
    completed: true,
  },
};

const ROLE_PRE: Record<UserRole, string[]> = {
  // 申请人：已走完签订协议、争议发生；提交申请书是他要写的第一份文书
  prosecutor: ['签订仲裁协议', '争议发生'],
  // 被申请人：申请人已提交申请书，仲裁机构尚待受理并通知答辩——"受理与答辩"由他撰写答辩状后才算完成，故不预置
  defender: ['签订仲裁协议', '争议发生', '提交仲裁申请'],
  // 首席：仲裁庭已组成，直接进入庭审
  judge: ['签订仲裁协议', '争议发生', '提交仲裁申请', '受理与答辩', '组成仲裁庭'],
};

export function getArbitrationInitialLifecycle(role: UserRole | null, caseType: unknown = 'arbitration'): CaseLifecycle {
  const civil = toType(caseType) === 'civil';
  const keys = (civil ? CIVIL_ROLE_PRE : ROLE_PRE)[role ?? 'defender'];
  const nodes = civil ? CIVIL_PRE_NODES : PRE_NODES;
  return { nodes: keys.map((k) => nodes[k]).filter(Boolean) };
}

/** 进入仲裁 / 涉外诉讼案例详情页时写入初始生命周期（已有则不覆盖） */
export function setArbitrationInitialLifecycle(role: UserRole | null, caseType: unknown = 'arbitration'): void {
  const store = useAppStore.getState();
  if (store.lifecycle && store.lifecycle.nodes && store.lifecycle.nodes.length > 0) return;
  store.setLifecycle(getArbitrationInitialLifecycle(role, caseType));
}

// ===== 页面 → 阶段映射（供 advanceLifecycleForPage 之外的仲裁页使用） =====

export const ARB_PAGE_STAGE: Record<string, LifecycleNode> = {
  'case-detail': {
    stage: '案件查阅',
    legalActions: '学生查阅仲裁案件材料，了解合同、仲裁协议、争议经过和证据，为后续角色工作做好准备',
    documents: '案件材料汇总（案件基本资料、仲裁文书卷、证人与专家陈述、证据材料、法律依据）',
    legalBasis: '当事人和仲裁庭应当充分了解案件材料，这是正当程序的前提',
    completed: true,
  },
  'writing-claim': {
    stage: '提交仲裁申请',
    legalActions: '申请人代理人撰写并提交仲裁申请书，明确仲裁请求、事实与理由及证据清单，启动仲裁程序',
    documents: '仲裁申请书、证据清单',
    legalBasis: '仲裁申请书应包含具体的仲裁请求和事实理由，并附仲裁协议和证据（具体要求以所适用的仲裁规则为准）',
    completed: true,
  },
  'writing-answer': {
    stage: '受理与答辩',
    legalActions: '被申请人代理人撰写并提交答辩状，就仲裁请求逐项答辩，可提出管辖权异议与反请求',
    documents: '答辩状（含管辖权异议、反请求）',
    legalBasis: '被申请人有权就仲裁协议的存在、效力和范围提出异议（具体期限以所适用的仲裁规则为准）',
    completed: true,
  },
  'hearing-investigation': {
    stage: '庭审调查',
    legalActions: '仲裁庭开庭，处理管辖权异议，双方陈述、举证质证，询问事实证人与专家证人，仲裁庭提问',
    documents: '庭审笔录、证据清单及质证意见',
    legalBasis: '仲裁庭应平等对待当事人，给予各方陈述案情和提出主张的合理机会',
    completed: true,
  },
  'hearing-debate': {
    stage: '庭审辩论',
    legalActions: '双方围绕争议焦点作结案陈词与自由辩论，并就仲裁费用的承担发表意见',
    documents: '庭审笔录、结案陈词',
    legalBasis: '当事人有权就事实和法律适用充分发表意见',
    completed: true,
  },
  'writing-award': {
    stage: '合议与裁决',
    legalActions: '仲裁庭合议并作出裁决，首席仲裁员撰写裁决书，载明争议焦点、事实认定、法律适用、裁决主文和仲裁费用',
    documents: '裁决书',
    legalBasis: '裁决是终局的；当事人不服只能依法申请撤销或在执行阶段提出不予执行（具体条文以所适用法律为准）',
    completed: true,
  },
  closing: {
    stage: '闭庭',
    legalActions: '仲裁庭宣布裁决结果并闭庭，仲裁程序终结',
    documents: '裁决书送达回证',
    legalBasis: '裁决书自作出之日起发生法律效力',
    completed: true,
  },
};

/** 标记仲裁某步骤完成（按 stage 名称去重，已有则置 completed，没有则追加） */
export function advanceArbitrationLifecycle(key: keyof typeof ARB_PAGE_STAGE): void {
  const caseType = toType(useAppStore.getState().selectedCase?.caseType);
  const node = (caseType === 'civil' ? CIVIL_PAGE_STAGE : ARB_PAGE_STAGE)[key];
  if (!node) return;
  const store = useAppStore.getState();
  const cur = store.lifecycle;
  if (cur && Array.isArray(cur.nodes)) {
    const idx = cur.nodes.findIndex((n) => n.stage === node.stage);
    if (idx >= 0) {
      const nodes = [...cur.nodes];
      nodes[idx] = { ...nodes[idx], completed: true };
      store.setLifecycle({ nodes });
    } else {
      store.setLifecycle({ nodes: [...cur.nodes, node] });
    }
  } else {
    store.setLifecycle({ nodes: [node] });
  }
}
