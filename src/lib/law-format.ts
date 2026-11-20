/**
 * 法条检索结果格式化模块
 * 处理工作流 7674184725792489498 出参的符号结构，供 law-search 呈现使用：
 * - 法条：`第二百三十四条 【故意伤害罪】正文…` → 条款号 + 罪名 + 正文
 * - 解释：`〔10〕【相关法规】正文…【司法解释】正文…` → 序号组 + 分类分节
 * - 正文混排 `一、` `（二）` `1.` `★` 等层级标记 → 结构化分块换行
 */

/** 解释条目内的已知分类标记（仅按白名单切分，避免误伤正文中的普通方括号） */
const KNOWN_CATEGORIES = [
  '相关法规',
  '立法解释',
  '司法解释',
  '规范性文件',
  '指导性案例',
  '指导案例',
  '相关规定',
  '指导意见',
  '立法规定',
] as const;

/** 工作流 explain 数组的原始条目：point=关联法条，content=带符号的混排正文 */
export interface ExplainItem {
  point: string;
  content: string;
}

export interface ExplainSection {
  /** 分类名，如「司法解释」 */
  category: string;
  /** 该分类下正文 */
  body: string;
}

export interface ExplainEntry {
  /** 〔10〕形式的一级序号；无标记时为 null */
  ordinal: string | null;
  /** 关联法条，如「第二十条」 */
  point: string;
  /** 按分类切分后的分节 */
  sections: ExplainSection[];
}

export interface ParsedLaw {
  /** 条款号，如「第二百三十四条」 */
  article: string;
  /** 罪名，如「故意伤害罪」；无则 null */
  charge: string | null;
  /** 条文正文 */
  body: string;
}

export type LegalBlockKind = 'h1' | 'h2' | 'star' | 'text';

/** 结构化正文块：h1=「一、」级标题，h2=「（二）」「1.」级条目，star=★ 标记行，text=普通段落 */
export interface LegalBlock {
  kind: LegalBlockKind;
  text: string;
}

/** 解析法条文本：`第二百三十四条 【故意伤害罪】正文…` → 条款号 + 罪名 + 正文 */
export function parseLawItem(text: string): ParsedLaw {
  const m = text.trim().match(/^([^\s【]{2,20})\s*【(.+?)】\s*([\s\S]*)$/);
  if (m) return { article: m[1], charge: m[2], body: m[3] };
  return { article: '', charge: null, body: text.trim() };
}

/**
 * 解析单条解释：剥离 〔N〕 一级序号，再按 【分类】 白名单切分为分节。
 * 无分类标记时整体作为一节，分类名退化为正文首标记推断。
 */
export function parseExplainEntry(point: string, content: string): ExplainEntry {
  let rest = content.trim();
  let ordinal: string | null = null;

  const om = rest.match(/^〔([^〕]{1,8})〕\s*/);
  if (om) {
    ordinal = `〔${om[1]}〕`;
    rest = rest.slice(om[0].length);
  }

  // 定位所有白名单分类标记的位置（【分类】总长 = 分类名 + 2）
  const marks: { start: number; end: number; category: string }[] = [];
  for (const cat of KNOWN_CATEGORIES) {
    const tag = `【${cat}】`;
    let from = 0;
    for (;;) {
      const idx = rest.indexOf(tag, from);
      if (idx === -1) break;
      marks.push({ start: idx, end: idx + tag.length, category: cat });
      from = idx + tag.length;
    }
  }
  marks.sort((a, b) => a.start - b.start);

  // 同名分类出现多次时保留首次（其余视作正文）
  const seen = new Set<string>();
  const sections: ExplainSection[] = [];
  for (let i = 0; i < marks.length; i += 1) {
    const mark = marks[i];
    if (seen.has(mark.category)) continue;
    seen.add(mark.category);
    const body = rest.slice(mark.end, marks[i + 1]?.start ?? rest.length).trim();
    sections.push({ category: mark.category, body });
  }

  if (sections.length === 0) {
    sections.push({ category: detectExplainCategory(rest), body: rest });
  }

  return { ordinal, point: point.trim(), sections };
}

/** 从内容首标记或关键词推断解释类型（兜底分类名） */
export function detectExplainCategory(content: string): string {
  const firstTag = content.match(/【(立法解释|司法解释|指导性案例|相关法规|规范性文件|指导意见|相关规定)】/);
  if (firstTag) {
    const tag = firstTag[1];
    if (tag === '相关法规' || tag === '指导意见' || tag === '相关规定' || tag === '规范性文件') return '规范性文件';
    return tag;
  }
  if (/指导(?:性)?案例/.test(content)) return '指导性案例';
  if (/立法解释/.test(content)) return '立法解释';
  if (/司法解释/.test(content)) return '司法解释';
  if (/管理办法|条例|规定/.test(content)) return '规范性文件';
  return '相关解释';
}

/** 在层级标记前插换行：一、 （二） 1. ★（\d 前向断言避免切年份/小数） */
const MARKER_SPLIT_RE =
  /(?=(?:[一二三四五六七八九十百]+、)|(?:（[一二三四五六七八九十百]+）)|(?:(?<![0-9.．])[0-9]{1,2}[.．]\s)|★)/g;

/**
 * 将混排正文切分为结构化块并归类层级。
 * 输入一整段文字（含 \r 分段），输出按标记换行后的 h1/h2/star/text 块序列。
 */
export function splitLegalBlocks(text: string): LegalBlock[] {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const lines = normalized.split(MARKER_SPLIT_RE).join('\n').split('\n');

  const blocks: LegalBlock[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (/^[一二三四五六七八九十百]+、/.test(t)) {
      blocks.push({ kind: 'h1', text: t });
    } else if (/^（[一二三四五六七八九十百]+）/.test(t)) {
      blocks.push({ kind: 'h2', text: t });
    } else if (/^[0-9]{1,2}[.．]\s*\S/.test(t)) {
      blocks.push({ kind: 'h2', text: t });
    } else if (t.startsWith('★')) {
      blocks.push({ kind: 'star', text: t.slice(1).trim() });
    } else {
      blocks.push({ kind: 'text', text: t });
    }
  }
  return blocks;
}

/** 法条/解释正文预览：取首段前 N 字符（供列表项展示） */
export function previewText(text: string, max = 64): string {
  const first = text.replace(/\s+/g, ' ').trim();
  return first.length > max ? `${first.slice(0, max)}…` : first;
}

/** 法条条文按句号分款（每句一行，保留句读），无标记时正文更易读 */
export function splitLawBody(body: string): string[] {
  const normalized = body.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!normalized) return [];
  return normalized
    .split('\n')
    .flatMap((line) => line.split(/(?<=。)/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
