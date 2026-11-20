/**
 * 把《中国国际私法经典案例评析》里的真实案例导入为训练案例（status=generated，需教师审核后再发布）。
 *
 * 原则：
 *  - 书里有的，一律用原文，不改写、不润色：name / profile 的事实部分 / case（基本案情）/ law（法律依据来自裁判要旨里
 *    援引的条文）/ 争议焦点（书中"法律问题"）/ 标准答案（裁判要旨、法理分析、拓展案例）。
 *  - 书里没有的（证人笔录、证据材料、文书、角色设定、教学目标、易错点）由 LLM 依据案情拟制，
 *    并在 meta.reference.aiDrafted 里逐项登记，教师审核时据此知道哪些是 AI 写的。
 *  - 标准答案放 meta.reference，学生接口会在服务端剪掉。
 *
 * 用法：pnpm exec tsx scripts/import-book-cases.ts <序号|all> [--dry]
 *   序号对应 PICKS 的下标；--dry 只生成并打印，不入库。
 */
import fs from 'node:fs';
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { LLMClient } from '../src/lib/llm-client';
import type { ArbitrationMeta } from '../src/lib/case-type';

interface BookCase {
  chapter: string; no: number; title: string; caseName: string; caseNo: string;
  facts: string; issues: string; holding: string; analysis: string; ext: string;
}

/** 挑选依据：案情+争点+要旨+法理四段齐全、正文无串案、争议点单一清晰、贴合本课程（管辖/仲裁/外国判决承认）。 */
interface Pick {
  match: string;                 // 在书中按 caseName 包含该串定位
  rules: ArbitrationMeta['rules'];
  seat: string;
  governingLaw: string;
  role: string;                  // 本案在训练中的定位
  issueTypes: ArbitrationMeta['issues'][number]['type'];
}
export const PICKS: Pick[] = [
  { match: '中国恒基伟业集团有限公司', rules: 'UNCITRAL', seat: '未约定（本案争点之一）', governingLaw: '香港特别行政区法律（主合同）', role: '涉外仲裁协议效力与准据法确定', issueTypes: 'jurisdiction' },
  { match: '江苏省物资集团轻工纺织总公司', rules: 'CIETAC', seat: '北京', governingLaw: '中国法', role: '仲裁条款独立性、侵权争议可仲裁性、仲裁第三人', issueTypes: 'jurisdiction' },
  { match: 'Hemofarm DD', rules: 'ICC', seat: '巴黎', governingLaw: '中国法（合资合同）', role: '外国仲裁裁决的承认与执行、公共政策', issueTypes: 'procedure' },
  { match: '天卓国际发展有限公司', rules: 'UNCITRAL', seat: '无（诉讼案）', governingLaw: '香港法', role: '不方便法院原则与管辖权', issueTypes: 'jurisdiction' },
  { match: 'SPAR航运有限公司', rules: 'UNCITRAL', seat: '伦敦', governingLaw: '英国法', role: '承认和执行外国法院判决、互惠原则', issueTypes: 'procedure' },
  { match: 'BY.O诉豫商集团', rules: 'CIETAC', seat: '上海', governingLaw: '中国法', role: '混合管辖协议："或裁或审"与"先裁后审"', issueTypes: 'jurisdiction' },
];

function loadBook(): BookCase[] {
  const all = JSON.parse(fs.readFileSync('/var/tmp/step0/book/cases.json', 'utf8')) as BookCase[];
  return all.filter((c) => c.facts && c.holding);
}

function clean(s: string): string {
  return s.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitIssues(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim().replace(/^\d+[.、．]\s*/, '')).filter(Boolean);
}

function splitExt(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim().replace(/^\d+[.、．]\s*/, '')).filter((l) => l && !/^第[一二三四五六七八九十]+章/.test(l));
}

/** 让 LLM 只补书里没有的部分。明确禁止改动事实，要求输出严格 JSON。 */
function buildFillPrompt(b: BookCase, pick: Pick): string {
  return `你是国际私法与国际仲裁教学案例设计专家。下面是一个**真实的裁判案例**（来自教材），请你为模拟法庭实训补齐教材里没有的材料。

【铁律】
1. 案情中的当事人名称、日期、金额、条款原文、案号、裁判结果，全部以教材原文为准，**不得改动、不得补充教材没有的"事实"当作真实发生过**。
2. 你补写的证人陈述、证据材料、代理意见，都是"模拟训练材料"，必须**只围绕教材案情已有的事实展开**，不得凭空增加会改变案件结论的新事实。
3. 严禁编造法条号、案号、判例名。需要引用时只用教材原文里出现过的；其余写"请以法律原文核对"。
4. 教材里的"裁判要旨/法理分析"是本案标准答案，**不得写进任何学生可见的材料**（申请书、答辩状、笔录、证据、角色设定里都不能透露裁判结论与推理）。

【教材案情（原文）】
${b.facts}

【本案法律问题（教材原文）】
${b.issues}

【教材原文中出现的法律依据（仅供你摘取规则名称与条文号，不得照搬其中的裁判结论）】
${b.holding.slice(0, 1800)}

【训练定位】${pick.role}

【请输出】只输出一个 JSON 对象，不要 markdown 代码块与解释。所有值为字符串：
- profile：案件概要，100-180字，只陈述事实与争议类型，不透露结论
- teach：训练价值与教学目标，120-220字
- plead：JSON 数组字符串，元素 {"title":"文书名","book":"正文"}。包含"申请人（原告方）主张意见"与"被申请人（被告方）答辩意见"各一份；各 300-600 字，**各自站在己方立场、真实地互相对抗**，仅使用案情已有事实
- record：JSON 数组字符串，元素 {"title":"笔录名","book":"问答体正文"}。包含 2 份：一名了解合同签订/履行经过的事实证人陈述，一名专家证人（${pick.role.includes('外国') || pick.role.includes('准据法') ? '外国法/准据法' : '仲裁实务或程序法'}方向）意见摘要；每份 300-500 字；**专家只陈述一般性规则与方法，不得直接对本案作出结论**
- evidence：JSON 数组字符串，元素 {"title":"证据名","book":"内容摘要"}。5-7 份，必须是案情里已提到的合同、条款、函件、法院文书等，每份 60-200 字；不得增加案情未提及的新证据类型
- law：JSON 数组字符串，每个元素为字符串，格式"条目标题：规则内容"。**只写可供学生检索使用的一般性法律规则**（公约、法律、司法解释的规则本身，及相关学理概念），**严禁出现任何"本案""该案""最高人民法院认为""应当认定""应适用……因此无效/有效"等裁判过程或结论性表述**。只能使用下面"教材原文"里已出现过的法律名称与条文号；教材没出现的一律不写条文号，只写"请以法律原文核对"。写 4-6 条，每条 40-150 字。
- wrong：学生在本案中最容易犯的 4-5 个错误，每条一行，不透露完整答案
- person：JSON 数组字符串，元素 {"name":"角色名","voice":"","set":"人设与立场、说话风格、知悉的事实","message":"该角色应坚持/如实陈述的核心信息"}。须包含：申请人代理人、被申请人代理人、首席仲裁员、边裁甲、边裁乙、事实证人、专家证人、仲裁秘书`;
}

function extractJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{'); const z = text.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(text.slice(a, z + 1)) as Record<string, unknown>; } catch { return null; }
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

async function fill(b: BookCase, pick: Pick): Promise<Record<string, string>> {
  const llm = new LLMClient();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text = '';
    for await (const ch of llm.stream([{ role: 'user', content: buildFillPrompt(b, pick) }], { temperature: 0.5 })) text += ch.content ?? '';
    const j = extractJson(text);
    const need = ['profile', 'teach', 'plead', 'record', 'evidence', 'law', 'wrong', 'person'];
    if (j && need.every((k) => asStr(j[k]).trim().length > 20)) {
      return Object.fromEntries(need.map((k) => [k, asStr(j[k])]));
    }
    console.log(`  第 ${attempt} 次生成不完整，重试…`);
  }
  throw new Error('LLM 三次生成都不完整');
}

async function main() {
  const arg = process.argv[2]; const dry = process.argv.includes('--dry');
  if (!arg) { console.log('用法: import-book-cases.ts <序号|all> [--dry]'); process.exit(1); }
  const book = loadBook();
  const idxs = arg === 'all' ? PICKS.map((_, i) => i) : [Number(arg)];
  const client = getSupabaseClient();
  for (const i of idxs) {
    const pick = PICKS[i]; if (!pick) throw new Error(`无此序号 ${i}`);
    const b = book.find((c) => (c.caseName || c.title).includes(pick.match));
    if (!b) throw new Error(`书中找不到: ${pick.match}`);
    console.log(`\n[${i}] ${(b.caseName || b.title).slice(0, 40)}…（${b.chapter}）`);

    // 幂等：同名案例已存在则跳过
    const name = clean(b.caseName || b.title);
    const { data: exist } = await client.from('cases').select('id').eq('name', name).eq('case_type', 'arbitration').maybeSingle();
    if (exist) { console.log('  已存在，跳过 id=' + exist.id); continue; }

    const ai = await fill(b, pick);
    const issues = splitIssues(b.issues);
    const meta: ArbitrationMeta = {
      rules: pick.rules, seat: pick.seat, governingLaw: pick.governingLaw, language: 'zh', claimAmount: '见案情',
      issues: issues.map((t, k) => ({ id: `issue-${k + 1}`, title: t, type: pick.issueTypes })),
      reference: {
        source: `《中国国际私法经典案例评析》${b.chapter}`,
        caseNo: b.caseNo, holding: clean(b.holding), analysis: clean(b.analysis), issues: clean(b.issues), extended: splitExt(b.ext),
        aiDrafted: ['profile', 'teach', 'plead', 'record', 'evidence', 'law', 'wrong', 'person'],
      },
    };
    const row = {
      name,
      profile: ai.profile, teach: ai.teach,
      case_info: clean(b.facts),
      plead: ai.plead, record: ai.record, evidence: ai.evidence,
      law: ai.law,
      wrong: ai.wrong, person: ai.person,
      status: 'generated', creator_name: '教材导入', case_type: 'arbitration', meta,
    };
    if (dry) {
      fs.mkdirSync('/var/tmp/step0/book/out', { recursive: true });
      fs.writeFileSync(`/var/tmp/step0/book/out/pick-${i}.json`, JSON.stringify(row, null, 1));
      console.log(`  [dry] 已生成，完整内容写入 /var/tmp/step0/book/out/pick-${i}.json（未入库）`);
      continue;
    }
    const { data, error } = await client.from('cases').insert(row).select('id').single();
    if (error) throw error;
    console.log('  已入库 id=' + data.id + '（状态 generated，待教师审核发布）');
  }
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
