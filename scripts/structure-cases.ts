/**
 * 为教材导入的案例生成「涉及领域」关键词与「案件基本资料」大纲，写入 cases.meta.keywords / meta.outline。
 *
 * 大纲只切分、不改写：先把 case_info 按句切成编号片段，LLM 只返回"第几句到第几句属于哪个阶段的哪个小节"，
 * 正文由脚本按编号从原文拼回，所以拼起来与原文逐字一致（校验不通过就不写入）。
 * 关键词 = 教材章名（领域）+ 知识点（来自 meta.reference.source）+ LLM 给出的 1-3 个争议标的词（如"借款合同"）。
 *
 * 用法：pnpm exec tsx scripts/structure-cases.ts [--only=名称片段] [--dry] [--concurrency=2] [--force]
 *   默认跳过已有 outline 的案例；--force 重新生成。
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { LLMClient } from '../src/lib/llm-client';
import type { CaseOutlineStage } from '../src/lib/case-type';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DRY = argv.includes('--dry');
const FORCE = argv.includes('--force');
const ONLY = flag('only');
const CONCURRENCY = Number(flag('concurrency') ?? 2);

type Kind = CaseOutlineStage['sections'][number]['kind'];
const KINDS: Kind[] = ['facts', 'procedure', 'plaintiff', 'defendant', 'ruling', 'other'];

/** 按句末标点与换行切句，保留标点与原有换行；拼接全部片段 === 原文 */
export function splitUnits(text: string): string[] {
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    buf += ch;
    const next = text[i + 1];
    const endSentence = '。！？；'.includes(ch) && !'”’）)」'.includes(next ?? '');
    const closeQuote = '”’」'.includes(ch) && '。！？'.includes(text[i - 1] ?? '');
    if (ch === '\n' || endSentence || closeQuote) {
      // 把紧随的换行并入本句，避免出现只有换行的片段
      while (text[i + 1] === '\n') { buf += '\n'; i++; }
      if (buf.trim()) out.push(buf); else if (out.length) out[out.length - 1] += buf;
      buf = '';
    }
  }
  if (buf) { if (buf.trim() || !out.length) out.push(buf); else out[out.length - 1] += buf; }
  return out;
}

function buildPrompt(units: string[], source: string): string {
  return `下面是一个涉外民商事案例的"基本案情"原文（来自教材，${source}），已按句编号。请帮我把它组织成便于学生阅读的大纲。

【要求】
1. 只划分，不改写：你只输出"第几句到第几句"属于哪个阶段的哪个小节，不要输出原文。
2. 一级是程序阶段：如"一审阶段""二审阶段""再审阶段""申请承认与执行阶段"；原文只有事实、没有诉讼或仲裁程序经过的，只设一个阶段"案情"。
3. 二级小节标题从这些里选用（可以按原文需要微调措辞，如"一审裁定"）："基本案情""诉讼程序经过""原告意见""被告意见""一审判决""二审判决"……；每个小节标注 kind：
   facts=事实经过，procedure=程序经过（受理、管辖、前案、开庭、提交材料等），plaintiff=原告/申请人主张，defendant=被告/被申请人主张，ruling=法院或仲裁庭的裁判结果与理由，other=其他。
4. 所有小节按原文顺序排列，句号范围首尾相接、不重叠、不遗漏，第一节从 1 开始，最后一节到 ${units.length} 结束。一个小节至少 1 句。
5. 另给出 1-3 个"争议标的"关键词（2-6 字，如"借款合同""股权转让""商标侵权""船舶碰撞""遗嘱继承"），只描述纠纷属于哪类民商事关系，不得体现裁判结论。

只输出 JSON，不要解释：
{"subjects":["…"],"stages":[{"stage":"一审阶段","sections":[{"title":"基本案情","kind":"facts","from":1,"to":4}]}]}

【原文（共 ${units.length} 句）】
${units.map((u, i) => `[${i + 1}] ${u.replace(/\n+$/, '')}`).join('\n')}`;
}

interface Plan { subjects?: unknown; stages?: { stage?: unknown; sections?: { title?: unknown; kind?: unknown; from?: unknown; to?: unknown }[] }[] }

/** 校验并按编号从原文拼回正文 */
export function applyPlan(units: string[], plan: Plan): CaseOutlineStage[] | string {
  if (!Array.isArray(plan.stages) || plan.stages.length === 0) return '缺 stages';
  let expect = 1;
  const out: CaseOutlineStage[] = [];
  for (const st of plan.stages) {
    if (typeof st.stage !== 'string' || !Array.isArray(st.sections) || st.sections.length === 0) return '阶段结构不完整';
    const sections: CaseOutlineStage['sections'] = [];
    for (const sec of st.sections) {
      const from = Number(sec.from); const to = Number(sec.to);
      if (from !== expect || !(to >= from) || to > units.length) return `句号不连续：期望从 ${expect} 开始，得到 ${from}-${to}`;
      const kind = KINDS.includes(sec.kind as Kind) ? (sec.kind as Kind) : 'other';
      const title = typeof sec.title === 'string' && sec.title.trim() ? sec.title.trim().slice(0, 20) : '其他';
      sections.push({ title, kind, text: units.slice(from - 1, to).join('').trim() });
      expect = to + 1;
    }
    out.push({ stage: st.stage.trim().slice(0, 20), sections });
  }
  if (expect !== units.length + 1) return `未覆盖全文：止于第 ${expect - 1} 句，共 ${units.length} 句`;
  return out;
}

/** 教材出处 → 领域关键词：「第十五章 国际民事诉讼·不方便法院原则」→ ["国际民事诉讼","不方便法院原则"] */
export function keywordsFromSource(source: string): string[] {
  const m = source.match(/第[一二三四五六七八九十]+章\s*([^·]+)(?:·(.+))?$/);
  if (!m) return [];
  const area = m[1].trim();
  const points = (m[2] ?? '').replace(/[（(][^）)]*[）)]/g, '').split(/[、，,]/).map((s) => s.trim()).filter((s) => s.length >= 2 && s.length <= 16);
  return [area, ...points];
}

async function planFor(units: string[], source: string): Promise<{ outline: CaseOutlineStage[]; subjects: string[] }> {
  const llm = new LLMClient();
  let lastErr = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text = '';
    try {
      for await (const ch of llm.stream([{ role: 'user', content: buildPrompt(units, source) }], { temperature: 0.2 })) text += ch.content ?? '';
    } catch (e) { lastErr = e instanceof Error ? e.message : String(e); continue; }
    const a = text.indexOf('{'); const z = text.lastIndexOf('}');
    let plan: Plan;
    try { plan = JSON.parse(text.slice(a, z + 1)) as Plan; } catch { lastErr = 'JSON 解析失败'; continue; }
    const outline = applyPlan(units, plan);
    if (typeof outline === 'string') { lastErr = outline; continue; }
    const subjects = Array.isArray(plan.subjects) ? plan.subjects.filter((s): s is string => typeof s === 'string' && s.length >= 2 && s.length <= 8).slice(0, 3) : [];
    return { outline, subjects };
  }
  throw new Error(`三次都未得到合格大纲：${lastErr}`);
}

async function main() {
  const db = getSupabaseClient();
  const { data, error } = await db.from('cases').select('id,name,case_info,meta').eq('creator_name', '教材导入');
  if (error) throw error;
  const rows = (data ?? []).filter((r) => !ONLY || String(r.name).includes(ONLY));
  const todo = rows.filter((r) => FORCE || !(r.meta as { outline?: unknown } | null)?.outline);
  console.log(`教材案例 ${rows.length} 个，待处理 ${todo.length} 个`);
  let cursor = 0; let ok = 0; let fail = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const r = todo[cursor++];
      const meta = (r.meta ?? {}) as Record<string, unknown> & { reference?: { source?: string } };
      const text = String(r.case_info ?? '');
      const units = splitUnits(text);
      if (units.join('') !== text) { console.log(`✗ ${String(r.name).slice(0, 24)}：切句后无法还原原文`); fail++; continue; }
      try {
        const source = meta.reference?.source ?? '';
        const { outline, subjects } = await planFor(units, source);
        const keywords = [...new Set([...keywordsFromSource(source), ...subjects])].slice(0, 6);
        const shape = outline.map((s) => `${s.stage}(${s.sections.map((x) => x.title).join('/')})`).join(' ');
        if (!DRY) {
          const { error: e } = await db.from('cases').update({ meta: { ...meta, keywords, outline } }).eq('id', r.id);
          if (e) throw e;
        }
        console.log(`✓ ${String(r.name).slice(0, 24)}｜${keywords.join('、')}｜${shape}`);
        ok++;
      } catch (e) {
        console.log(`✗ ${String(r.name).slice(0, 24)}：${e instanceof Error ? e.message : e}`);
        fail++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  console.log(`\n完成：成功 ${ok}，失败 ${fail}${DRY ? '（--dry 未写库）' : ''}`);
}

if (process.argv[1] && /structure-cases\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
}
