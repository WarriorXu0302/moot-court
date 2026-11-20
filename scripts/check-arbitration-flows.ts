// 仲裁流程静态校验（AGENTS.md 硬约束）。用法：pnpm exec tsx scripts/check-arbitration-flows.ts
import { getFlow, type StageDef } from '../src/lib/flows/index';
import { getSpeakerVoice } from '../src/lib/audio';
import { getArbitrationNextRoute } from '../src/lib/arbitration-route';
import { ARBITRATION_SCORING_FRAMEWORK } from '../src/lib/arbitration-scoring';
import { ROLE_LABELS } from '../src/lib/case-type';
import type { UserRole } from '../src/lib/types';

let bad = 0;
const fail = (m: string) => { console.log('FAIL', m); bad++; };

const ROLES: UserRole[] = ['judge', 'prosecutor', 'defender'];
const PHASES = ['investigation', 'debate'] as const;
const KNOWN_SPEAKERS = new Set(['首席仲裁员', '申请人代理人', '被申请人代理人', '证人', '专家证人', '边裁甲', '边裁乙', '仲裁秘书']);
// 发问类阶段：向另一角色提问、对方必须回答的 ai 阶段必须带 responder（AGENTS.md 硬约束）。
// 管辖权异议、自由辩论是"陈述/辩论"而非发问，不在此列：
// 申请人视角里异议是 AI 单向陈述，随后由用户的 interactive 阶段（claimant_jurisdiction_reply）承接。
const QUESTIONING = /witness_exam|witness_cross|expert_exam|tribunal_questions/;

for (const role of ROLES) {
  for (const phase of PHASES) {
    const flow: StageDef[] = getFlow('arbitration', role, phase);
    const tag = `${role}/${phase}`;
    const userLabel = ROLE_LABELS.arbitration[role];
    const ids = new Set<string>();
    let userStages = 0;
    flow.forEach((s, i) => {
      if (ids.has(s.id)) fail(`${tag} 阶段 id 重复: ${s.id}`);
      ids.add(s.id);
      if (!KNOWN_SPEAKERS.has(s.speaker)) fail(`${tag}#${i} 未知 speaker: ${s.speaker}`);
      if (s.responder && !KNOWN_SPEAKERS.has(s.responder)) fail(`${tag}#${i} 未知 responder: ${s.responder}`);
      if (s.responder && s.responder === s.speaker) fail(`${tag}#${i} responder 与 speaker 相同: ${s.speaker}`);
      // AI 阶段的 responder 若是用户本人，AI 会替学生作答（2026-11 实测：仲裁庭提问后 AI 以"申请人代理人"身份代答）
      if (s.type === 'ai' && s.responder === userLabel) fail(`${tag}#${i} ai 阶段的 responder 是用户本人(${userLabel})，会被 AI 代答: ${s.id}`);
      if (s.type === 'interactive') {
        userStages++;
        if (s.speaker !== userLabel) fail(`${tag}#${i} interactive 阶段 speaker=${s.speaker}，应为用户角色 ${userLabel}`);
        if (!s.hint) fail(`${tag}#${i} interactive 阶段缺 hint`);
      } else {
        if (s.speaker === userLabel) fail(`${tag}#${i} ai 阶段由用户角色(${userLabel})发言`);
        // 被问的是学生本人时，由紧随其后的 interactive 阶段作答（不能让 AI 代答），这种情况不需要 responder
        const answeredByUser = flow[i + 1]?.type === 'interactive';
        if (QUESTIONING.test(s.id) && !s.responder && !answeredByUser) fail(`${tag}#${i} 发问类 ai 阶段缺 responder: ${s.id}`);
      }
    });
    if (userStages === 0) fail(`${tag} 用户没有任何可操作阶段`);
    // 音色必须各不相同的关键角色
    console.log(`ok   ${tag}: ${flow.length} 阶段，用户操作 ${userStages} 个`);
  }
}

// 音色映射：被申请人代理人必须先于申请人代理人匹配；专家证人先于证人
const voices: Record<string, string> = {};
for (const sp of KNOWN_SPEAKERS) voices[sp] = getSpeakerVoice(sp);
if (voices['被申请人代理人'] === voices['申请人代理人']) fail('申请人/被申请人代理人音色相同（includes 匹配顺序错误）');
if (voices['专家证人'] === voices['证人']) fail('专家证人/证人音色相同（includes 匹配顺序错误）');
console.log('voices:', JSON.stringify(voices));

// 路线闭环：从案例研习起，沿 next 走完必须到达 /student/select
for (const role of ROLES) {
  const seq: string[] = [];
  let step: Parameters<typeof getArbitrationNextRoute>[1] = 'case-detail';
  for (let n = 0; n < 8; n++) {
    const route = getArbitrationNextRoute(role, step);
    seq.push(route);
    if (route === '/student/select') break;
    if (route.includes('arbitration-writing')) step = route.includes('doc=award') ? 'award' : 'writing';
    else if (route.includes('phase=investigation')) step = 'investigation';
    else if (route.includes('phase=debate')) step = 'debate';
    else if (route.includes('closing')) step = 'closing';
  }
  if (seq[seq.length - 1] !== '/student/select') fail(`${role} 路线未闭环: ${seq.join(' → ')}`);
  else console.log(`ok   route ${role}: ${seq.join(' → ')}`);
}

// 评分框架：环节 key 唯一，权重和 100
const keys = new Set<string>();
for (const st of ARBITRATION_SCORING_FRAMEWORK.stages) {
  if (keys.has(st.key)) fail(`评分环节 key 重复: ${st.key}`);
  keys.add(st.key);
}
const w = ARBITRATION_SCORING_FRAMEWORK.overallDimensions.reduce((a, d) => a + d.weight, 0);
if (w !== 100) fail(`总标准权重和=${w}，应为100`);
for (const need of ['case-detail', 'arb-claim-writing', 'arb-answer-writing', 'arb-investigation', 'arb-debate', 'arb-award-writing']) {
  if (!keys.has(need)) fail(`评分框架缺环节 ${need}`);
}

console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
process.exit(bad ? 1 : 0);
