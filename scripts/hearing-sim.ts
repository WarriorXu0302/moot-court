/**
 * 庭审整场模拟 + 逐句检查（仲裁 / 涉外民商事诉讼）。
 *
 * 用法：pnpm exec tsx scripts/hearing-sim.ts --case=天卓 --role=prosecutor --phase=investigation [--student=good|weak] [--out=目录] [--no-review]
 *   role：prosecutor=原告/申请人代理人，defender=被告/被申请人代理人，judge=审判长/首席仲裁员
 *   phase：investigation | debate | both（both 时辩论阶段接着调查阶段的笔录走，与页面一致：页面换阶段后笔录清空，
 *          但 AI 读的是同一份案件资料；这里辩论单独起笔录，和页面相同）
 *
 * 流程引擎与页面 arbitration-hearing 一致：ai 环节 → 发言人发言（+ responder 回答）；interactive 环节 → 学生发言
 * （这里由 AI 扮演学生）→ responderForUserTurn 指定的角色回应。提示词全部来自 src/lib/hearing-engine.ts。
 *
 * 输出：<out>/<tag>.json（笔录 + 问题）与 <tag>.md（人读报告）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { LLMClient } from '../src/lib/llm-client';
import { rowToCaseData } from '../src/lib/case-row';
import { getFlow, type FlowPhase, type StageDef } from '../src/lib/flows';
import { getForumProfile, adversarialType } from '../src/lib/forum-profile';
import { getRoleLabel } from '../src/lib/case-type';
import { buildArbitrationContext } from '../src/lib/arbitration-case-utils';
import { buildHearingSystemPrompt, buildHearingUserContent, finalizeHearingText, responderForUserTurn, hearingReplyFormat, isQuestioningDone, type HearingCtx, type HearingMode, type PromptOpts } from '../src/lib/hearing-engine';
import { isPresiding } from '../src/lib/hearing-directives';
import type { CaseData, ChatMessage, UserRole } from '../src/lib/types';

const argv = process.argv.slice(2);
const flag = (k: string, d = '') => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const CASE_Q = flag('case', '天卓');
const ROLE = flag('role', 'prosecutor') as UserRole;
const PHASES: FlowPhase[] = flag('phase', 'investigation') === 'both' ? ['investigation', 'debate'] : [flag('phase', 'investigation') as FlowPhase];
const STUDENT = flag('student', 'good') as 'good' | 'weak';
const OUT = flag('out', '/var/tmp/hearing-sim');
const REVIEW = !argv.includes('--no-review');

export interface Line {
  idx: number;
  stageIdx: number;
  stage: string;
  speaker: string;
  kind: 'stage' | 'respond' | 'user-reply' | 'student';
  text: string;
  ms: number;
}

async function complete(system: string, user: string, temperature: number): Promise<string> {
  const llm = new LLMClient();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text = '';
    try {
      for await (const ch of llm.stream([{ role: 'system', content: system }, { role: 'user', content: user }], { temperature })) text += ch.content ?? '';
      if (text.trim()) return text;
    } catch (e) {
      if (attempt === 3) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
  return '';
}

/** AI 扮演学生：good=按提示认真完成本环节；weak=简略、有遗漏，用来检查 AI 角色对差回答的反应 */
async function studentSays(ctx: HearingCtx, stage: StageDef, contextData: string, msgs: ChatMessage[], turn = 1): Promise<string> {
  const persona = STUDENT === 'good'
    ? '你是一名认真准备过的法学院学生，熟悉案情和相关法律，发言具体、有条理，紧扣本环节任务，篇幅与真实庭审中代理人发言相当（一般 80-300 字），不说与本环节无关的话。'
    : '你是一名准备不足的法学院学生：发言简短（20-60 字），只说到一两点，偶尔把概念用得不准，但不胡编案情。';
  const system = `你在参加一场模拟${ctx.profile.hearingName}训练，扮演${ctx.roleLabel}。${persona}
只输出你作为${ctx.roleLabel}当庭说的话本身，不要加角色名前缀、不要解释、不要用 markdown。`;
  const multi = stage.multiTurn && stage.multiTurn > 1
    ? `\n本环节你最多可发问 ${stage.multiTurn} 次，这是第 ${turn} 次：只问一个问题；${turn > 1 ? '根据对方上一次的回答追问，' : ''}问够了就只说"询问完毕"。`
    : '';
  const user = `${contextData}\n\n已有庭审笔录：\n${msgs.map((m) => `${m.speaker}: ${m.content}`).join('\n')}\n\n现在轮到你发言。本环节：「${stage.label}」。任务提示：${stage.hint ?? ''}${multi}`;
  return (await complete(system, user, 0.6)).trim();
}

async function aiSays(ctx: HearingCtx, contextData: string, msgs: ChatMessage[], speaker: string, mode: HearingMode, prompt: string, arg: string, opts: PromptOpts = {}): Promise<string> {
  const system = buildHearingSystemPrompt(ctx, speaker, mode, arg, opts) + hearingReplyFormat(false);
  const user = buildHearingUserContent(contextData, msgs, mode, prompt, arg, ctx.roleLabel);
  return finalizeHearingText(speaker, await complete(system, user, 0.7));
}

async function runPhase(caseData: CaseData, phase: FlowPhase): Promise<{ ctx: HearingCtx; lines: Line[] }> {
  const caseType = adversarialType(caseData.caseType);
  const profile = getForumProfile(caseType);
  const roleLabel = getRoleLabel(caseType, ROLE);
  const stages = getFlow(caseType, ROLE, phase);
  const pageName = phase === 'debate' ? '庭审辩论' : '庭审调查';
  const ctx: HearingCtx = { caseData, profile, phase, pageName, role: ROLE, roleLabel, stages };
  const contextData = buildArbitrationContext(caseData, {});
  const msgs: ChatMessage[] = [];
  const lines: Line[] = [];
  const push = (stageIdx: number, speaker: string, kind: Line['kind'], text: string, ms: number) => {
    msgs.push({ id: String(msgs.length), role: kind === 'student' ? 'user' : 'assistant', content: text, timestamp: Date.now(), speaker });
    lines.push({ idx: lines.length, stageIdx, stage: stages[stageIdx].label, speaker, kind, text, ms });
    process.stdout.write(`  [${stageIdx + 1}/${stages.length}] ${speaker}（${kind}）${text.length}字\n`);
  };
  for (let i = 0; i < stages.length; i++) {
    const st = stages[i];
    if (st.type === 'ai') {
      const n = st.rounds ?? 1;
      for (let k = 1; k <= n; k++) {
        let t0 = Date.now();
        const said = await aiSays(ctx, contextData, msgs, st.speaker, 'stage', st.label, st.label, { stageId: st.id, round: n > 1 ? { k, n } : undefined });
        push(i, st.speaker, 'stage', said, Date.now() - t0);
        const finished = n > 1 && isQuestioningDone(said);
        if (st.responder && st.responder !== roleLabel && !(finished && !/[？?]/.test(said))) {
          t0 = Date.now();
          push(i, st.responder, 'respond', await aiSays(ctx, contextData, msgs, st.responder, 'respond', `AI_RESPOND:${st.speaker}`, st.speaker, { stageId: st.id }), Date.now() - t0);
        }
        if (finished || !said) break;
      }
    } else {
      const n = st.multiTurn ?? 1;
      for (let k = 1; k <= n; k++) {
        let t0 = Date.now();
        const said = await studentSays(ctx, st, contextData, msgs, k);
        push(i, roleLabel, 'student', said, Date.now() - t0);
        const done = n > 1 && isQuestioningDone(said);
        const responder = responderForUserTurn(st, stages[i + 1]);
        if (responder && !(done && !/[？?]/.test(said))) {
          t0 = Date.now();
          push(i, responder, 'user-reply', await aiSays(ctx, contextData, msgs, responder, 'user-reply', `USER_SAYS:${said}`, said, { stageId: st.id }), Date.now() - t0);
        }
        if (done) break;
      }
    }
  }
  return { ctx, lines };
}

// ===== 检查 =====

export interface Issue { idx: number; speaker: string; category: string; severity: '高' | '中' | '低'; detail: string; source: 'rule' | 'review' }

const LATIN_OK = /^(ICC|CIETAC|HKIAC|UNCITRAL|SIAC|LCIA|WTO|CISG|UCP|ISP|FOB|CIF|CFR|EXW|DDP|DAP|USD|HKD|RMB|PRC|AS|DD|LTD|LIMITED|INC|CO|PTE|SA|AG|GMBH|LLC|PLC|BVI)$/i;

export function ruleCheck(lines: Line[], caseText: string, chair: string): Issue[] {
  const out: Issue[] = [];
  const add = (l: Line, category: string, severity: Issue['severity'], detail: string) => out.push({ idx: l.idx, speaker: l.speaker, category, severity, detail, source: 'rule' });
  lines.forEach((l, k) => {
    if (l.kind === 'student') return;
    const t = l.text;
    if (!t.trim()) add(l, '空发言', '高', 'AI 未产出任何内容');
    if (!isPresiding(l.speaker) && /请(?:审判长|首席仲裁员|仲裁庭|合议庭|法庭|本庭|贵院|贵庭|原告|被告|申请人|被申请人|对方)[^。！？\n]{0,30}(?:发言|陈述|举证|质证|发问|询问|宣布|回答|说明|发表|确认)/.test(t)) add(l, '角色越位', '高', '非主持人在安排程序：' + (t.match(/请[^。！？\n]{0,40}/)?.[0] ?? ''));
    for (const w of t.match(/[A-Za-z][A-Za-z.'-]{2,}/g) ?? []) {
      if (!LATIN_OK.test(w) && !caseText.includes(w)) { add(l, '中英混杂', '中', `出现英文词「${w}」`); break; }
    }
    if (/[（(](?:微笑|点头|停顿|起身|翻阅|示意|看向|沉默|叹气|举手|站起|坐下)[^）)]{0,10}[）)]/.test(t)) add(l, '括号动作', '中', '出现括号描述动作/神态');
    if (/XXX|×××|某某某|\[.*?\]/.test(t)) add(l, '占位符', '中', '出现 XXX / ××× / 方括号占位');
    if (/^(?:审判长|首席仲裁员|原告代理人|被告代理人|申请人代理人|被申请人代理人|证人|书记员)[：:]/m.test(t)) add(l, '角色混写', '高', '发言内含其他角色名前缀，疑似一人分饰多角');
    if (l.kind === 'user-reply' && /[？?]\s*$/.test(t)) add(l, '悬空追问', '中', '回应学生时以问句收尾，学生没有再次发言的机会');
    const len = t.replace(/\s/g, '').length;
    const limit = isPresiding(l.speaker) ? (l.kind === 'user-reply' ? 90 : /归纳|焦点|安排|程序安排/.test(l.stage) ? 320 : 220)
      : /证人$/.test(l.speaker) || l.speaker === '证人' ? 160
      : /专家/.test(l.speaker) ? 260
      : l.kind === 'user-reply' ? 160 : 520;
    if (len > limit * 1.25) add(l, '篇幅过长', len > limit * 2 ? '中' : '低', `${len} 字，参考上限约 ${limit} 字`);
    if (isPresiding(l.speaker) && /(?:本院|本庭|仲裁庭)(?:认为|决定|裁定|认定)[^。]{0,30}(?:成立|不成立|驳回|支持|有效|无效|有管辖权|无管辖权)/.test(t)) add(l, '泄露结论', '高', `${chair}在庭审中对实体/管辖结论表态`);
    const prev = lines[k - 1];
    if (prev && prev.speaker === l.speaker && prev.kind !== 'student' && l.kind !== 'respond' && prev.stageIdx === l.stageIdx && l.kind !== 'stage') add(l, '同一角色连续发言', '中', '与上一条发言人相同');
    if (prev && prev.speaker === l.speaker && prev.kind === 'user-reply' && l.kind === 'stage') add(l, '同一角色连续发言', '低', '回应学生后紧接着又是本人环节');
    if (l.kind === 'stage' && /exam|cross|questions/.test(l.stage) === false && /询问|发问|提问/.test(l.stage) && (t.match(/[？?]/g) ?? []).length > 2) add(l, '一次多问', '中', `一次发言提出 ${(t.match(/[？?]/g) ?? []).length} 个问题`);
  });
  return out;
}

async function review(ctx: HearingCtx, lines: Line[], caseText: string): Promise<Issue[]> {
  const system = `你是有多年审判经验的法官兼法学院模拟法庭教练，审阅一份由 AI 扮演各角色、学生扮演${ctx.roleLabel}的模拟${ctx.profile.hearingName}（${ctx.pageName}）笔录。只挑 AI 角色发言的问题，不评价学生。
逐条检查（以真实的中国法庭/仲裁庭审为标准，越细越好）：
1. 角色越位：当事人、证人、专家安排程序、代替他人发言、替${ctx.profile.courtroom.bench[1]}做决定；${ctx.profile.courtroom.bench[1]}替当事人陈述或替学生回答。
2. 程序错误：发言内容与该环节名称不符；插入阶段表之外的程序；遗漏该环节应有的要素（如核对身份要问回避、举证要说证明目的、质证要按三性、询问证人前告知如实作证义务等）；顺序颠倒。
3. 事实编造：与案件资料不符或资料中没有的日期、金额、证据、人名、公证认证情况等。
4. 法律错误：条文号、规则内容明显错误，或把法律与司法解释张冠李戴。
5. 泄露结论：${ctx.profile.courtroom.bench[1]}在庭审中对管辖、实体问题提前表态，或任何角色说出案件最终裁判结果。
6. 语言风格：不像庭审口头表达（书面腔、堆砌、分点过多）、篇幅失当、重复前面说过的话、口吻不符身份、出现英文或括号动作。
7. 回应失焦：没有回应学生或提问方刚说的内容、答非所问、对学生明显错误的说法照单全收。
已知的训练设定（不算问题，不要报）：案件资料中「庭审设定」一节（代理权限与授权事项、证人身份与知情范围、专家背景与出庭依据）是本训练给定的事实，各方据此回答不算编造；所有人一律不使用真实姓名、律所名称（"本人""审判员两名"是有意为之）；阶段表是本训练给定的流程，不要建议增加阶段表之外的环节，但阶段表内环节缺少应有要素仍要报；调查阶段的最后一个环节宣布"下一步进入法庭辩论"属于正常衔接，不算越出阶段表；身份证明、授权委托书已在开庭前提交是训练约定；证人知情事实后面括号里的知情途径也是给定的。
只输出 JSON 数组，不要解释，每项 {"idx":行号,"category":"上面 7 类之一","severity":"高|中|低","detail":"具体问题，引用原话片段"}。没有问题输出 []。`;
  const transcript = lines.map((l) => `#${l.idx}【${l.stage}】${l.speaker}${l.kind === 'student' ? '（学生）' : ''}：${l.text}`).join('\n\n');
  const user = `案件资料（节选）：\n${caseText.slice(0, 6000)}\n\n阶段表：\n${ctx.stages.map((s, i) => `${i + 1}. ${s.label}（${s.speaker}${s.type === 'interactive' ? '，学生' : ''}）`).join('\n')}\n\n笔录：\n${transcript}`;
  const raw = await complete(system, user, 0.2);
  const a = raw.indexOf('['); const z = raw.lastIndexOf(']');
  try {
    const arr = JSON.parse(raw.slice(a, z + 1)) as { idx: number; category: string; severity: Issue['severity']; detail: string }[];
    return arr.filter((x) => lines[x.idx] && lines[x.idx].kind !== 'student').map((x) => ({ ...x, speaker: lines[x.idx].speaker, source: 'review' as const }));
  } catch {
    return [{ idx: -1, speaker: '-', category: '审阅失败', severity: '低', detail: raw.slice(0, 200), source: 'review' }];
  }
}

function toMarkdown(tag: string, ctx: HearingCtx, lines: Line[], issues: Issue[]): string {
  const by = new Map<number, Issue[]>();
  for (const i of issues) by.set(i.idx, [...(by.get(i.idx) ?? []), i]);
  const head = `# 庭审模拟：${tag}\n\n${ctx.pageName}｜学生：${ctx.roleLabel}（${STUDENT}）｜${lines.length} 条发言｜问题 ${issues.length} 个（高 ${issues.filter((i) => i.severity === '高').length}）\n\n`;
  const body = lines.map((l) => {
    const iss = by.get(l.idx) ?? [];
    return `**#${l.idx} ${l.speaker}**${l.kind === 'student' ? '（学生）' : ''} 〔${l.stage}〕 ${(l.ms / 1000).toFixed(0)}s\n\n${l.text}\n${iss.map((i) => `\n> ⚠ ${i.severity}｜${i.category}｜${i.detail}（${i.source}）`).join('')}\n`;
  }).join('\n');
  return head + body;
}

/** --rereview=目录：不重跑庭审，只用当前检查规则和审阅提示词重新检查已有笔录（保证前后轮次可比） */
async function rereview(dir: string) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as { tag: string; case: string; role: UserRole; phase: FlowPhase; lines: Line[] };
    const { data } = await getSupabaseClient().from('cases').select('*').eq('name', j.case).limit(1);
    const caseData = rowToCaseData(data![0], { forStudent: true }) as unknown as CaseData;
    const caseType = adversarialType(caseData.caseType);
    const profile = getForumProfile(caseType);
    // 用当时的笔录，但按当时那一版的阶段名重建阶段表（从笔录里取，保证与审阅时一致）
    const seen: string[] = [];
    for (const l of j.lines) if (!seen.includes(l.stage)) seen.push(l.stage);
    const stages = seen.map((label, i) => ({ id: String(i), label, type: 'ai' as const, speaker: j.lines.find((l) => l.stage === label)!.speaker }));
    const ctx: HearingCtx = { caseData, profile, phase: j.phase, pageName: j.phase === 'debate' ? '庭审辩论' : '庭审调查', role: j.role, roleLabel: getRoleLabel(caseType, j.role), stages };
    const caseText = buildArbitrationContext(caseData, {});
    const issues = [...ruleCheck(j.lines, caseText, profile.courtroom.bench[1]), ...(await review(ctx, j.lines, caseText))];
    fs.writeFileSync(path.join(dir, f.replace(/\.json$/, '.rereview.json')), JSON.stringify({ ...j, issues }, null, 1));
    console.log(`${j.tag}: ${issues.length}`);
  }
}

async function main() {
  const rr = flag('rereview');
  if (rr) { await rereview(rr); return; }
  const { data, error } = await getSupabaseClient().from('cases').select('*').ilike('name', `%${CASE_Q}%`).limit(1);
  if (error) throw error;
  if (!data?.[0]) throw new Error(`找不到案例：${CASE_Q}`);
  const caseData = rowToCaseData(data[0], { forStudent: true }) as unknown as CaseData;
  fs.mkdirSync(OUT, { recursive: true });
  for (const phase of PHASES) {
    const tag = `${CASE_Q}-${ROLE}-${phase}-${STUDENT}`;
    console.log(`\n=== ${tag}（${caseData.name}）`);
    const t0 = Date.now();
    const { ctx, lines } = await runPhase(caseData, phase);
    const caseText = buildArbitrationContext(caseData, {});
    const issues = [...ruleCheck(lines, caseText, ctx.profile.courtroom.bench[1]), ...(REVIEW ? await review(ctx, lines, caseText) : [])];
    fs.writeFileSync(path.join(OUT, `${tag}.json`), JSON.stringify({ tag, case: caseData.name, role: ROLE, phase, student: STUDENT, lines, issues }, null, 1));
    fs.writeFileSync(path.join(OUT, `${tag}.md`), toMarkdown(tag, ctx, lines, issues));
    const cats = issues.reduce<Record<string, number>>((m, i) => { m[i.category] = (m[i.category] ?? 0) + 1; return m; }, {});
    console.log(`  完成 ${((Date.now() - t0) / 1000).toFixed(0)}s，问题 ${issues.length}：${JSON.stringify(cats)}`);
  }
}

if (process.argv[1] && /hearing-sim\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
}
