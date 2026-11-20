/**
 * 教材导入案例的发布前审核（只读，不改数据库）。
 *
 * 逐案检查 AI 拟制的学生可见字段：
 *  1. 编造事实：AI 字段里出现、但教材原文（案情 + 法律问题 + 裁判要旨 + 法理分析）里找不到的日期、金额、百分比、案号、条文号；
 *  2. 答案泄露：AI 字段与裁判要旨 / 法理分析连续 ≥18 字重合，或出现"本案应认定""法院认为"等结论性措辞；
 *  3. 结构完整：诉讼文书 / 笔录 / 证据条数，角色设定是否含仲裁庭全部角色，评分标准是否已生成。
 *
 * 用法：pnpm exec tsx scripts/review-book-cases.ts > docs/review/book-cases-review.md
 */
import fs from 'node:fs';
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';

interface BookCase { caseName: string; title: string; facts: string; issues: string; holding: string; analysis: string }

const STUDENT_FIELDS: Record<string, string> = {
  profile: '案件基本介绍', teach: '训练价值', plead: '卷宗 · 诉讼文书', record: '卷宗 · 询问笔录',
  evidence: '卷宗 · 证据材料', law: '相关法条', wrong: '易错点', person: '角色设定',
};
const REQUIRED_ROLES = ['申请人代理人', '被申请人代理人', '首席仲裁员', '边裁', '事实证人', '专家证人', '仲裁秘书'];
const VERDICT_WORDS = ['本案应认定', '应当认定', '法院认为', '最高人民法院认为', '本院认为', '裁定如下', '判决如下', '因此无效', '因此有效', '应予承认', '不予承认', '应予驳回'];

const norm = (s: string) => s.replace(/\r/g, '').replace(/[\s　]/g, '').replace(/[，,]/g, ',');

/** 与 import-book-cases.ts 的 PICKS.match 一致（不能直接 import：该文件顶层会执行导入流程） */
const MATCH_KEYS = ['中国恒基伟业集团有限公司', '江苏省物资集团轻工纺织总公司', 'Hemofarm DD', '天卓国际发展有限公司', 'SPAR航运有限公司', 'BY.O诉豫商集团'];

const CN_DIGIT: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 汉字数字 → 阿拉伯数字（支持到百位），用于"第八条"与"第8条"互认 */
function cnToNum(t: string): string {
  if (/^\d+$/.test(t)) return t;
  let total = 0, cur = 0;
  for (const ch of t) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
  }
  return String(total + cur);
}
/** 事实归一：条文号统一成阿拉伯数字，金额去千分位 */
function canon(s: string): string {
  return norm(s)
    .replace(/第([一二三四五六七八九十百零两\d]+)条/g, (_, n: string) => `第${cnToNum(n)}条`)
    .replace(/(\d),(?=\d{3})/g, '$1');
}

/** 可核对的"硬事实"：日期、金额、百分比、案号、条文号 */
function hardFacts(text: string): string[] {
  const pats = [
    /\d{4}年\d{1,2}月(?:\d{1,2}日)?/g,
    /\d+(?:\.\d+)?(?:万|亿)?(?:欧元|美元|元|港元|英镑|人民币)/g,
    /\d+(?:\.\d+)?%/g,
    /[（(]\d{4}[)）][^\s，。；]{1,12}?\d+号/g,
    /第[一二三四五六七八九十百零\d]+条/g,
  ];
  const out = new Set<string>();
  for (const p of pats) for (const m of text.matchAll(p)) out.add(m[0]);
  return [...out];
}

function longestOverlap(a: string, b: string, min = 18): string | null {
  const A = norm(a), B = norm(b);
  let best: string | null = null;
  for (let i = 0; i + min <= A.length; i++) {
    const chunk = A.slice(i, i + min);
    if (B.includes(chunk)) {
      let len = min;
      while (i + len < A.length && B.includes(A.slice(i, i + len + 1))) len++;
      const hit = A.slice(i, i + len);
      if (!best || hit.length > best.length) best = hit;
      i += len - 1;
    }
  }
  return best;
}

function countItems(json: string): number {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v.length : 0; } catch { return 0; }
}

function flatten(json: string): string {
  try {
    const v = JSON.parse(json);
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : Object.values(x).join('\n'))).join('\n');
  } catch { /* 非 JSON */ }
  return json;
}

async function main() {
  const book = JSON.parse(fs.readFileSync('/var/tmp/step0/book/cases.json', 'utf8')) as BookCase[];
  const db = getSupabaseClient();
  const { data, error } = await db.from('cases')
    .select('id,name,status,profile,teach,case_info,plead,record,evidence,law,wrong,person,judge,meta')
    .eq('case_type', 'arbitration').eq('creator_name', '教材导入');
  if (error) throw error;

  const lines: string[] = [];
  const out = (s = '') => lines.push(s);
  out('# 教材导入案例 · 发布前审核报告');
  out();
  out(`生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}　脚本：\`scripts/review-book-cases.ts\`（只读，不改数据）`);
  out();
  out('判定口径：');
  out('- **疑似编造**：AI 拟制字段里的日期 / 金额 / 百分比 / 案号 / 条文号，在教材原文（案情、法律问题、裁判要旨、法理分析）中都找不到。不一定错，但学生会把它当事实用，必须人工核对。');
  out('- **答案泄露**：学生可见字段与裁判要旨 / 法理分析连续 18 字以上重合，或出现"法院认为""应当认定"等结论措辞。');
  out('- 机器检查只能发现"可对照的硬事实"，论证质量、法律规则是否准确仍需教师阅读判断。');
  out();

  const summary: string[] = [];
  for (const c of (data ?? []).sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'))) {
    const key = MATCH_KEYS.find((k) => c.name.includes(k));
    const b = key ? book.filter((x) => x.facts && x.holding).find((x) => (x.caseName || x.title).includes(key)) : undefined;
    const source = b ? [b.facts, b.issues, b.holding, b.analysis].join('\n') : String(c.case_info ?? '');
    const srcN = canon(source);
    const answer = b ? `${b.holding}\n${b.analysis}` : '';

    const fabricated: { field: string; items: string[] }[] = [];
    const leaks: { field: string; text: string }[] = [];
    const verdictHits: { field: string; word: string }[] = [];
    for (const [key, label] of Object.entries(STUDENT_FIELDS)) {
      const text = flatten(String(c[key as keyof typeof c] ?? ''));
      if (!text) continue;
      const miss = hardFacts(text).filter((f) => !srcN.includes(canon(f)));
      if (miss.length) fabricated.push({ field: label, items: miss });
      const ov = answer ? longestOverlap(text, answer) : null;
      if (ov) leaks.push({ field: label, text: ov });
      for (const w of VERDICT_WORDS) if (text.includes(w)) verdictHits.push({ field: label, word: w });
    }

    const personText = String(c.person ?? '');
    const missingRoles = REQUIRED_ROLES.filter((r) => !personText.includes(r));
    const counts = { plead: countItems(String(c.plead ?? '')), record: countItems(String(c.record ?? '')), evidence: countItems(String(c.evidence ?? '')), law: countItems(String(c.law ?? '')) };
    const hasScoring = !!c.judge && String(c.judge).length > 20;
    const caseInfoMatches = b ? norm(String(c.case_info ?? '')) === norm(b.facts) : false;

    const blockers = [
      fabricated.length ? `${fabricated.reduce((n, f) => n + f.items.length, 0)} 处疑似编造` : '',
      leaks.length || verdictHits.length ? '疑似答案泄露' : '',
      missingRoles.length ? `缺角色 ${missingRoles.join('、')}` : '',
      !hasScoring ? '无评分标准' : '',
      !caseInfoMatches ? '案情与教材不一致' : '',
    ].filter(Boolean);
    summary.push(`| ${c.name.slice(0, 28)}${c.name.length > 28 ? '…' : ''} | ${c.status === 'published' ? '已发布' : '待审核'} | ${blockers.length ? blockers.join('；') : '机器检查未发现问题'} |`);

    out(`## ${c.name}`);
    out();
    out(`- id：\`${c.id}\`　状态：${c.status}　教材匹配：${b ? '是' : '**否**'}　案情与教材原文逐字一致：${caseInfoMatches ? '是' : '**否**'}`);
    out(`- 材料条数：诉讼文书 ${counts.plead}、笔录 ${counts.record}、证据 ${counts.evidence}、法律依据 ${counts.law}　评分标准：${hasScoring ? '已有' : '**未生成**'}`);
    out(`- 角色设定：${missingRoles.length ? `**缺少 ${missingRoles.join('、')}**` : '齐全'}`);
    out();
    out('**疑似编造的事实**');
    out();
    if (!fabricated.length) out('- 未发现');
    for (const f of fabricated) out(`- ${f.field}：${f.items.map((x) => `「${x}」`).join(' ')}`);
    out();
    out('**答案泄露检查**');
    out();
    if (!leaks.length && !verdictHits.length) out('- 未发现');
    for (const l of leaks) out(`- ${l.field} 与裁判要旨/法理分析重合 ${l.text.length} 字：「${l.text.slice(0, 60)}${l.text.length > 60 ? '…' : ''}」`);
    for (const v of verdictHits) out(`- ${v.field} 出现结论性措辞「${v.word}」`);
    out();
  }

  lines.splice(9, 0, '## 总览', '', '| 案例 | 状态 | 需要处理 |', '| --- | --- | --- |', ...summary, '');
  process.stdout.write(lines.join('\n') + '\n');
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
