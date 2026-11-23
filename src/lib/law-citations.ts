/**
 * 案情里的法条引用（如"《中华人民共和国民事诉讼法》第二百六十五条"）→ 可点击查看原文。
 *
 * 原文来源只有本案「相关法律依据」（cases.law，按"条目标题：内容"存）。能对上法名和条号的就显示该条；
 * 对不上的显示"本平台暂未收录该条原文"并给出国家法律法规数据库入口——不让 AI 现编条文。
 */

export interface Citation {
  /** 原文中的完整引用文字 */
  raw: string;
  /** 法名（去掉书名号） */
  law: string;
  /** 条号（阿拉伯数字） */
  article: number;
}

const CN: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 中文数字（到千位）或阿拉伯数字 → number */
export function cnToNumber(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  let total = 0;
  let cur = 0;
  for (const ch of s) {
    if (ch in CN) cur = CN[ch];
    else if (ch === '十') { total += (cur || 1) * 10; cur = 0; }
    else if (ch === '百') { total += (cur || 1) * 100; cur = 0; }
    else if (ch === '千') { total += (cur || 1) * 1000; cur = 0; }
  }
  return total + cur;
}

// 《…》可内含〈…〉；条号允许中文或阿拉伯数字
const CITE_RE = /《((?:[^《》]|〈[^〉]*〉){2,60})》(?:的)?第([一二三四五六七八九十百千零〇两\d]{1,8})条/g;

export function findCitations(text: string): Citation[] {
  const out: Citation[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    const article = cnToNumber(m[2]);
    if (article > 0) out.push({ raw: m[0], law: m[1], article });
  }
  return out;
}

/** 把引用替换成 markdown 链接 [引用](#law-cite-N)，N 为 cites 下标 */
export function linkifyCitations(text: string): { md: string; cites: Citation[] } {
  const cites: Citation[] = [];
  const md = text.replace(CITE_RE, (raw: string, law: string, num: string) => {
    const article = cnToNumber(num);
    if (article <= 0) return raw;
    cites.push({ raw, law, article });
    return `[${raw}](#law-cite-${cites.length - 1})`;
  });
  return { md, cites };
}

/** 法名的核心部分，用于宽松匹配：去掉"中华人民共和国""最高人民法院关于"等前缀和书名号 */
function coreName(s: string): string {
  return s
    .replace(/[《》〈〉<>“”"\s]/g, '')
    .replace(/^最高人民法院关于/, '')
    .replace(/中华人民共和国/g, '')
    .replace(/^适用/, '');
}

/** 在本案法律依据条目中找对应条文；条号必须一致，法名核心互相包含 */
export function matchLawItem(cite: Citation, lawItems: string[]): string | null {
  const want = coreName(cite.law);
  for (const item of lawItems) {
    const head = item.split(/[：:]/)[0] ?? '';
    const m = head.match(/第([一二三四五六七八九十百千零〇两\d]{1,8})条/);
    if (!m || cnToNumber(m[1]) !== cite.article) continue;
    const have = coreName(head.slice(0, head.indexOf(m[0])));
    if (!have || !want) continue;
    // 法律与它的司法解释 / 规定不能互配（同号条文内容完全不同）
    const isInterp = (x: string) => /解释|规定|安排|批复|通知/.test(x);
    if (isInterp(have) !== isInterp(want)) continue;
    if (have.includes(want) || want.includes(have)) return item;
    // 简称：《法律适用法》对应《涉外民事关系法律适用法》
    if (want.length >= 3 && have.endsWith(want)) return item;
  }
  return null;
}
