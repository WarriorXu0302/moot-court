/**
 * 把《中国国际私法经典案例评析》里的全部真实案例导入为训练案例（status=generated，需教师审核后再发布）。
 *
 * 原则：
 *  - 书里有的，一律用原文，不改写、不润色：案例名称 / 案情（case_info）/ 争议焦点（书中"法律问题"）/
 *    标准答案（裁判要旨、法理分析、拓展案例，存 meta.reference，学生接口在服务端剪掉）。
 *  - 书里没有的（诉讼或仲裁文书、证人与专家笔录、证据材料、法律依据、角色设定、教学目标、易错点）
 *    由 LLM 依据案情拟制，并在 meta.reference.aiDrafted 里逐项登记，教师审核时据此知道哪些是 AI 写的。
 *  - 案件类型按章节判定：第十六章（国际商事仲裁）及"确认仲裁协议效力/承认执行仲裁裁决"类 → arbitration；
 *    其余（法律适用、管辖、外国判决承认等）→ civil（涉外民商事诉讼）。
 *
 * 书稿解析：python3 -I scripts/parse-book.py <书稿.txt> /var/tmp/book2/cases2.json
 *   （.doc 先用 macOS 自带 textutil 转 txt：textutil -convert txt -encoding UTF-8 书稿.doc -output 书稿.txt）
 *
 * 用法：pnpm exec tsx scripts/import-book-cases.ts <序号|all|列表 1,2,5> [--dry] [--book=路径] [--concurrency=4]
 *       pnpm exec tsx scripts/import-book-cases.ts 44,45,48 --regen   按教材重新生成已入库案例（原地更新，保留 id 与状态）
 *   序号为解析结果的下标；幂等：同名案例已存在则跳过。
 */
import fs from 'node:fs';
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { LLMClient } from '../src/lib/llm-client';
import type { ArbitrationMeta, AdversarialCaseType } from '../src/lib/case-type';

export interface BookCase {
  chapter: string; no: number; title: string; caseName: string; caseNo: string; infoRaw: string;
  facts: string; issues: string; holding: string; analysis: string; ext: string;
}

const argv = process.argv.slice(2);
const flag = (k: string): string | undefined => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BOOK = flag('book') ?? '/var/tmp/book2/cases2.json';
const CONCURRENCY = Number(flag('concurrency') ?? 4);
const OUT_DIR = '/var/tmp/book2/out';

/** 案件类型判定 */
export function decideType(b: BookCase): AdversarialCaseType {
  if (b.chapter.includes('国际商事仲裁')) return 'arbitration';
  const name = b.caseName + b.title;
  if (/仲裁裁决|仲裁协议/.test(name) && !/诉讼|判决/.test(b.title)) return 'arbitration';
  return 'civil';
}

/** 解析不出规范名称的个别案例，按案号手工指定（名称取自教材案情原文） */
const TITLE_BY_CASENO: Record<string, string> = {
  '（2021）京04民初836号': '蔡某与李某国际货物买卖合同纠纷案（莫桑比克法查明）',
  '（2022）鲁民终173号': '利邦国际品牌有限公司等与香港上海汇丰银行金融借款合同纠纷案',
  '（2018）津民初27号': '富昇（天津）融资租赁有限公司与德国致同会计师事务所侵权责任纠纷案',
  '（2023)京0112民特112号': '陈龙梅申请认定龙士杰无民事行为能力案',
  '（2018）闽72民初436号': '厦门港务船务有限公司与长荣海运新加坡有限公司船舶碰撞损害责任纠纷案',
  '（2022）浙0421民初4770号': '甲公司与乙公司涉外不当得利纠纷案',
};

/** 教材里案例名称常缺失或写成"（案号）：裁判要点"，这里取一个适合作为案例标题的名称 */
export function caseTitle(b: BookCase): string {
  if (TITLE_BY_CASENO[b.caseNo]) return TITLE_BY_CASENO[b.caseNo];
  // 同一真实案件在书中分别用于"定性"与"先决问题"两个知识点，按知识点区分为两个训练案例
  if (b.caseNo === '（2015）民四终字第9号') return `黄艺明、苏月弟与周大福代理人有限公司等合同纠纷案（${b.title.startsWith('定性') ? '定性' : '先决问题'}）`;
  // 第四章两个"定性"案例共用 (2015)民四终字第9号（先决问题案例）；无案号的定性案例按航运纠纷命名
  if (!b.caseNo && b.title.startsWith('定性')) return '第一产物保险公司与新加坡长荣海运公司等多式联运货损赔偿纠纷案';
  let n = (b.caseName || '').replace(/^(【?案例信息】?|一、案件信息|案件信息|案件名称[:：]?|案例名称[:：]?|案例[一二三四五六]\s*)/, '').trim();
  // "（2021）京04民初836号：准确查明及适用莫桑比克成文法" → 取冒号后的说明
  const m = n.match(/^[（(]\s*\d{4}\s*[)）][^：:]{0,40}号[：:]\s*(.+)$/);
  if (m) n = m[1];
  if (!n || n.length < 6 || /^[（(]?\d+字/.test(n)) {
    // 从 infoRaw 里找第一行像"××案/××纠纷"的
    const line = b.infoRaw.split('\n').map((l) => l.replace(/^(案件名称|案例名称)[:：]?\s*/, '').trim()).find((l) => /(案|纠纷|判决书)$/.test(l.replace(/[，,].*$/, '')) || /纠纷/.test(l));
    if (line) n = line;
  }
  n = n.replace(/[，,]\s*[（(]\d{4}[)）].*$/, '').replace(/\s*[（(]\d{4}[)）][^）)]*号.*$/, '').replace(/[。；;]$/, '').trim();
  n = n.replace(/——.*$/, '').replace(/（[^）]*典型案例）$/, '').trim();
  if (n.length > 60) n = n.slice(0, 60);
  return n || b.title;
}

function loadBook(): BookCase[] {
  return JSON.parse(fs.readFileSync(BOOK, 'utf8')) as BookCase[];
}

function clean(s: string): string {
  return s.replace(/\r/g, '').replace(/[ \t　]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitIssues(raw: string): string[] {
  const lines = raw.split('\n').map((l) => l.trim().replace(/^[（(]?\d+[)）.、．]\s*/, '')).filter((l) => l.length > 3);
  return lines.length ? lines.slice(0, 6) : [];
}

function splitExt(raw: string): string[] {
  return raw.split('\n').map((l) => l.trim().replace(/^\d+[.、．]\s*/, '')).filter((l) => l && !/^第[一二三四五六七八九十]+章/.test(l)).slice(0, 12);
}

const ROLES: Record<AdversarialCaseType, string> = {
  arbitration: '申请人代理人、被申请人代理人、首席仲裁员、边裁甲、边裁乙、事实证人（name 写"证人"）、专家证人、仲裁秘书',
  civil: '原告代理人、被告代理人、审判长、证人、外国法查明专家、书记员',
};

/** 让 LLM 只补书里没有的部分。明确禁止改动事实与泄露答案，要求输出严格 JSON。 */
function buildFillPrompt(b: BookCase, type: AdversarialCaseType): string {
  const arb = type === 'arbitration';
  const sides = arb ? ['申请人', '被申请人'] : ['原告', '被告'];
  const docs = arb ? ['仲裁申请书', '答辩状'] : ['民事起诉状', '答辩状'];
  return `你是国际私法教学案例设计专家。下面是一个**真实的裁判案例**（来自教材《中国国际私法经典案例评析》${b.chapter}，本案考查的知识点是"${b.title}"）。请你为模拟${arb ? '仲裁庭审' : '涉外民商事诉讼庭审'}实训补齐教材里没有的材料。

【铁律】
1. 案情中的当事人名称、日期、金额、条款原文、案号、裁判结果，全部以教材原文为准，**不得改动、不得补充教材没有的"事实"当作真实发生过**。
2. 你补写的文书、证人陈述、证据材料，都是"模拟训练材料"，必须**只围绕教材案情已有的事实展开**，不得凭空增加会改变案件结论的新事实。
3. 严禁编造法条号、案号、判例名。需要引用时只用教材原文里出现过的；其余写"请以法律原文核对"。
4. 教材里的"裁判要旨/法理分析"是本案标准答案，**不得写进任何学生可见的材料**（文书、笔录、证据、法律依据、角色设定里都不能透露法院/仲裁庭最终如何认定、适用了哪国法、结论是什么）。双方文书应各自主张、互相对抗，不能有一方"恰好"写出标准答案的完整推理。
5. **材料要写成案卷里的真实样子**：直接以当事人、证人、专家的口吻或文书原貌书写。不要在正文里加"【模拟训练材料】""【非真实笔录】""不予补写"等括注，不要出现"教材""教材记载""训练中"等字样；教材没有提供的细节（金额、日期、账号等）直接略去或用"若干""相关款项"概括，不要专门声明缺失。
6. 原案若是二审、再审、申请承认执行或确认仲裁协议效力等特别程序，模拟训练统一按"一审对抗式庭审"组织：${sides[0]}一方提出请求，${sides[1]}一方抗辩，${arb ? '仲裁庭' : '法庭'}居中审理。

【教材案情（原文）】
${b.facts.slice(0, 3500)}

【本案法律问题（教材原文）】
${b.issues.slice(0, 1200)}

【教材原文中出现的法律依据（仅供你摘取规则名称与条文号，不得照搬其中的裁判结论）】
${(b.holding + '\n' + b.analysis).slice(0, 2000)}

【请输出】只输出一个 JSON 对象，不要 markdown 代码块与解释。所有值为字符串：
- profile：案件概要，100-180字，只陈述当事人、事实与争议类型，不透露结论
- teach：训练价值与教学目标，120-220字，点明本案训练的国际私法知识点（"${b.title}"）
- plead：JSON 数组字符串，元素 {"title":"文书名","book":"正文"}。包含"${sides[0]}${docs[0]}（摘要）"与"${sides[1]}${docs[1]}（摘要）"各一份；各 300-600 字，**各自站在己方立场**，${arb ? '' : '双方都要就涉外性、法律关系定性与准据法提出己方主张，'}仅使用案情已有事实
- record：JSON 数组字符串，元素 {"title":"笔录名","book":"问答体正文"}。包含 2 份：一名了解事实经过的证人陈述，一名${arb ? '专家证人（仲裁实务、程序法或外国法方向）' : '外国法查明专家（或相关专业领域专家）'}意见摘要；每份 300-500 字；**专家只陈述一般性规则与方法，不得对本案作出结论**
- evidence：JSON 数组字符串，元素 {"title":"证据名","book":"内容摘要"}。5-7 份，必须是案情里已提到的合同、函件、登记、文书等，每份 60-200 字；不得增加案情未提及的新证据
- law：JSON 数组字符串，每个元素为字符串，格式"条目标题：规则内容"。**只写可供学生检索使用的一般性法律规则**（冲突规范、实体法、程序法、公约、司法解释的规则本身，及相关学理概念），**严禁出现"本案""该案""法院认为""应当认定""因此应适用……"等裁判过程或结论性表述**。只能使用教材原文里出现过的法律名称与条文号；教材没出现的一律不写条文号，只写"请以法律原文核对"。写 4-6 条，每条 40-150 字。
- wrong：学生在本案中最容易犯的 4-5 个错误，每条一行，不透露完整答案
- person：JSON 数组字符串，元素 {"name":"角色名","voice":"","set":"人设与立场、说话风格、知悉的事实","message":"该角色应坚持/如实陈述的核心信息"}。name 必须依次为：${ROLES[type]}
- court：${arb ? '空字符串' : '受案法院名称（教材原文有则照抄，没有写"见案情"）'}`;
}

function extractJson(text: string): Record<string, unknown> | null {
  const a = text.indexOf('{'); const z = text.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  try { return JSON.parse(text.slice(a, z + 1)) as Record<string, unknown>; } catch { return null; }
}

const asStr = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
const NEED = ['profile', 'teach', 'plead', 'record', 'evidence', 'law', 'wrong', 'person'] as const;

async function fill(b: BookCase, type: AdversarialCaseType): Promise<Record<string, string>> {
  const llm = new LLMClient();
  for (let attempt = 1; attempt <= 3; attempt++) {
    let text = '';
    try {
      for await (const ch of llm.stream([{ role: 'user', content: buildFillPrompt(b, type) }], { temperature: 0.5 })) text += ch.content ?? '';
    } catch (e) {
      console.log(`  第 ${attempt} 次请求失败：${e instanceof Error ? e.message : e}`);
      continue;
    }
    const j = extractJson(text);
    if (j && NEED.every((k) => asStr(j[k]).trim().length > 20)) {
      const out: Record<string, string> = Object.fromEntries(NEED.map((k) => [k, asStr(j[k])]));
      out.court = asStr(j.court);
      return out;
    }
    console.log(`  第 ${attempt} 次生成不完整，重试…`);
  }
  throw new Error('LLM 三次生成都不完整');
}

/** 学生可见字段与标准答案的连续重合（≥18 字）检查，命中只告警，交给教师审核 */
function leakCheck(ai: Record<string, string>, b: BookCase): string[] {
  const answer = (b.holding + b.analysis).replace(/\s/g, '');
  const hits: string[] = [];
  for (const k of NEED) {
    const t = ai[k].replace(/\s/g, '');
    for (let i = 0; i + 18 <= t.length; i += 6) {
      const seg = t.slice(i, i + 18);
      if (answer.includes(seg) && !b.facts.replace(/\s/g, '').includes(seg)) { hits.push(`${k}: …${seg}…`); break; }
    }
  }
  return hits;
}

async function importOne(i: number, b: BookCase, dry: boolean, existing: Set<string>): Promise<string> {
  const type = decideType(b);
  const name = clean(caseTitle(b));
  const tag = `[${i}] ${name.slice(0, 30)}（${type === 'arbitration' ? '仲裁' : '诉讼'}）`;
  if (existing.has(name)) return `${tag} 已存在，跳过`;
  if (!b.facts || b.facts.length < 150) return `${tag} 教材案情过短（${b.facts.length} 字），跳过`;
  if (!b.holding && !b.analysis) return `${tag} 教材缺裁判要旨与法理分析，跳过`;

  const ai = await fill(b, type);
  const leaks = leakCheck(ai, b);
  const issues = splitIssues(b.issues);
  const meta: ArbitrationMeta = {
    rules: 'UNCITRAL', seat: type === 'arbitration' ? '见案情' : '', governingLaw: '见案情（本案争点之一）', language: 'zh', claimAmount: '见案情',
    court: type === 'civil' ? (ai.court && ai.court !== '见案情' ? ai.court : '见案情') : undefined,
    issues: issues.map((t, k) => ({ id: `issue-${k + 1}`, title: t, type: /管辖|仲裁协议|承认|执行|送达/.test(t) ? 'jurisdiction' : 'merits' })),
    reference: {
      source: `《中国国际私法经典案例评析》${b.chapter}·${b.title}`,
      caseNo: b.caseNo, holding: clean(b.holding), analysis: clean(b.analysis), issues: clean(b.issues), extended: splitExt(b.ext),
      aiDrafted: [...NEED],
    },
  };
  const row = {
    name, profile: ai.profile, teach: ai.teach, case_info: clean(b.facts),
    plead: ai.plead, record: ai.record, evidence: ai.evidence, law: ai.law, wrong: ai.wrong, person: ai.person,
    status: 'generated', creator_name: '教材导入', case_type: type, meta,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/case-${i}.json`, JSON.stringify(row, null, 1));
  const leakNote = leaks.length ? `；⚠ 疑似答案重合 ${leaks.length} 处（${leaks.join('；')}）` : '';
  if (dry) return `${tag} [dry] 已生成 → ${OUT_DIR}/case-${i}.json${leakNote}`;
  const { data, error } = await getSupabaseClient().from('cases').insert(row).select('id').single();
  if (error) throw error;
  existing.add(name);
  return `${tag} 已入库 id=${data.id}${leakNote}`;
}

/**
 * 按教材重新生成已入库案例的 AI 拟制部分，原地更新（保留 id、名称、发布状态）。
 * 用于纠正类型错归：第一批手选的 6 个案例统一按仲裁生成，其中天卓、SPAR、BY.O 实为法院诉讼，
 * 只改 case_type 的话角色设定（首席仲裁员…）、文书（仲裁申请书…）都对不上庭审流程，必须整套重生成。
 */
async function regenerateExisting(i: number, b: BookCase, dry: boolean): Promise<string> {
  // --type=civil|arbitration 可强制指定类型：第十六章里有些案例实为法院审查程序（如恒基案：法院审查仲裁协议效力）
  const forced = flag('type');
  const type: AdversarialCaseType = forced === 'civil' || forced === 'arbitration' ? forced : decideType(b);
  const db = getSupabaseClient();
  const { data: rows, error } = await db.from('cases').select('id,name,status,case_type,meta');
  if (error) throw error;
  const key = (b.caseName || caseTitle(b)).slice(0, 12);
  const hit = (rows ?? []).filter((r) => String(r.name).includes(key) || key.includes(String(r.name).slice(0, 12)));
  if (hit.length !== 1) throw new Error(`按名称「${key}」匹配到 ${hit.length} 个案例，需唯一`);
  const cur = hit[0];
  const ai = await fill(b, type);
  const leaks = leakCheck(ai, b);
  const issues = splitIssues(b.issues);
  const meta: ArbitrationMeta = {
    rules: 'UNCITRAL', seat: type === 'arbitration' ? '见案情' : '', governingLaw: '见案情（本案争点之一）', language: 'zh', claimAmount: '见案情',
    court: type === 'civil' ? (ai.court && ai.court !== '见案情' ? ai.court : '见案情') : undefined,
    issues: issues.map((t, k) => ({ id: `issue-${k + 1}`, title: t, type: /管辖|仲裁协议|承认|执行|送达/.test(t) ? 'jurisdiction' : 'merits' })),
    reference: {
      source: `《中国国际私法经典案例评析》${b.chapter}·${b.title}`,
      caseNo: b.caseNo, holding: clean(b.holding), analysis: clean(b.analysis), issues: clean(b.issues), extended: splitExt(b.ext),
      aiDrafted: [...NEED],
    },
  };
  // 保留与类型无关的派生数据（案情大纲、涉及领域）；庭审设定与类型相关（角色名不同），清掉后用 enrich-hearing.ts 重生成
  const old = (cur.meta ?? {}) as { outline?: unknown; keywords?: unknown };
  Object.assign(meta, { outline: old.outline, keywords: old.keywords });
  // 评分标准按旧类型生成的环节 key（arb-*）对不上新类型，一并清空，由教师端重新生成
  const patch = {
    profile: ai.profile, teach: ai.teach, case_info: clean(b.facts),
    plead: ai.plead, record: ai.record, evidence: ai.evidence, law: ai.law, wrong: ai.wrong, person: ai.person,
    case_type: type, meta, judge: null, updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(`${OUT_DIR}/regen-${i}.json`, JSON.stringify({ id: cur.id, ...patch }, null, 1));
  const tag = `[${i}] ${String(cur.name).slice(0, 30)}：${cur.case_type} → ${type}（状态 ${cur.status} 不变）`;
  const leakNote = leaks.length ? `；⚠ 疑似答案重合 ${leaks.length} 处` : '';
  if (dry) return `${tag} [dry]${leakNote}`;
  const { error: upErr } = await db.from('cases').update(patch).eq('id', cur.id);
  if (upErr) throw upErr;
  return `${tag} 已更新 id=${cur.id}${leakNote}`;
}

async function main() {
  const arg = argv.find((a) => !a.startsWith('--')); const dry = argv.includes('--dry');
  if (argv.includes('--regen') && arg) {
    const book = loadBook();
    for (const i of arg.split(',').map(Number)) {
      try { console.log(await regenerateExisting(i, book[i], dry)); }
      catch (e) { console.log(`[${i}] 失败：${e instanceof Error ? e.message : JSON.stringify(e)}`); }
    }
    return;
  }
  if (!arg) { console.log('用法: import-book-cases.ts <序号|all|1,2,5> [--dry] [--book=路径] [--concurrency=4]'); process.exit(1); }
  const book = loadBook();
  const idxs = arg === 'all' ? book.map((_, i) => i) : arg.split(',').map(Number);
  const { data: rows, error } = await getSupabaseClient().from('cases').select('name');
  if (error) throw error;
  const existing = new Set((rows ?? []).map((r) => String(r.name)));
  // 旧版导入的 6 个仲裁案例用的是书中完整案例名，这里按包含关系也视为已存在
  for (const i of idxs) {
    const b = book[i];
    if (b && [...existing].some((n) => n.length > 8 && (b.caseName.includes(n.slice(0, 16)) || n.includes(caseTitle(b).slice(0, 16))))) existing.add(clean(caseTitle(b)));
  }

  let cursor = 0; let ok = 0; let failed = 0;
  const worker = async () => {
    while (cursor < idxs.length) {
      const i = idxs[cursor++];
      const b = book[i];
      if (!b) { console.log(`[${i}] 无此序号`); continue; }
      try { console.log(await importOne(i, b, dry, existing)); ok++; }
      catch (e) { console.log(`[${i}] 失败：${e instanceof Error ? e.message : JSON.stringify(e)}`); failed++; }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, worker));
  console.log(`\n完成：处理 ${ok}，失败 ${failed}`);
}

// 仅在直接执行时运行（review 脚本会 import decideType / caseTitle）
if (process.argv[1] && /import-book-cases\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
}
