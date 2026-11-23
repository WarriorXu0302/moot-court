/**
 * 仲裁案例卷宗工具：把案例字段整理成卷宗分区与 LLM 上下文。
 * 列名沿用刑事（plead/record/evidence/law/person），语义见 case-type.ts 的 CASE_LABELS。
 */
import type { CaseData, PersonData } from './types';
import { parsePersonData } from './types';
import type { CaseFileSection } from '@/components/case-file-viewer';

interface Item { title: string; book: string }

/** 解析 JSON 数组字段，兼容 {title,book} / {title,content} / 纯字符串（"标题：正文"）/ 非 JSON 全文 */
export function parseCaseItems(raw: string | undefined | null): Item[] {
  if (!raw) return [];
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return [{ title: '全文', book: raw }]; }
  if (!Array.isArray(parsed)) return [{ title: '全文', book: raw }];
  return parsed.map((it): Item => {
    if (typeof it === 'string') {
      const idx = it.indexOf('：');
      return idx > 0 ? { title: it.slice(0, idx).trim(), book: it.slice(idx + 1).trim() } : { title: it.slice(0, 30), book: it };
    }
    if (it && typeof it === 'object') {
      const o = it as Record<string, unknown>;
      return { title: String(o.title ?? o.name ?? ''), book: String(o.book ?? o.content ?? '') };
    }
    return { title: String(it), book: '' };
  });
}

/** 卷宗分区（左侧/右侧 CaseFileViewer 用） */
export function buildArbitrationFileSections(c: CaseData | null | undefined): CaseFileSection[] {
  if (!c) return [];
  return [
    { label: c.caseType === 'civil' ? '诉讼文书卷' : '仲裁文书卷', items: parseCaseItems(c.plead) },
    { label: '证人与专家陈述', items: parseCaseItems(c.record) },
    { label: '证据材料', items: parseCaseItems(c.evidence) },
    { label: '法律依据', items: parseCaseItems(c.law) },
  ];
}

/** 案件基本资料的大纲分区（阶段 → 小节）；没有大纲时整段原文作为一个小节 */
export function buildCaseOutlineSections(c: CaseData | null | undefined): CaseFileSection[] | null {
  const outline = c?.meta?.outline;
  if (outline && outline.length > 0) {
    return outline.map((st) => ({ label: st.stage, items: st.sections.map((sec) => ({ title: sec.title, book: sec.text })) }));
  }
  return c?.case ? [{ label: '案情', items: [{ title: '基本案情', book: c.case }] }] : null;
}

/** 取某角色的人设资料（name 包含 speaker 或反之） */
export function findPerson(c: CaseData | null | undefined, speaker: string): PersonData | undefined {
  const list = parsePersonData(c?.person).filter((p) => p.name);
  // 先精确匹配，再做包含匹配。只用包含匹配时，"被申请人代理人".includes("申请人代理人") 为真，
  // 申请人一方会拿到被申请人的角色设定（2026-11 实测：AI 申请人代理人发言里说"我方代表豫商公司"）
  const exact = list.find((p) => p.name === speaker);
  if (exact) return exact;
  // 包含匹配时取名字最接近的一个，并排除"被"字前缀造成的反向命中
  const fuzzy = list.filter((p) => {
    const a = p.name, b = speaker;
    if (a.startsWith('被') !== b.startsWith('被')) return false;
    return a.includes(b) || b.includes(a);
  });
  return fuzzy.sort((x, y) => Math.abs(x.name.length - speaker.length) - Math.abs(y.name.length - speaker.length))[0];
}

/** 仲裁元数据的一行摘要，注入提示词与页面头部 */
export function describeArbitrationMeta(c: CaseData | null | undefined): string {
  const m = c?.meta;
  if (!m) return '';
  const issues = m.issues.length ? `；争议焦点：${m.issues.map((i) => i.title).join('、')}` : '';
  if (c?.caseType === 'civil') return `受案法院：${m.court || '见案情'}${issues}`;
  return `仲裁规则：${m.rules}；仲裁地：${m.seat || '未指定'}；实体准据法：${m.governingLaw || '未指定'}；争议金额：${m.claimAmount || '未指定'}${issues}`;
}

/** 庭审/写作共用的案件上下文 */
export function buildArbitrationContext(c: CaseData | null | undefined, documents: Record<string, string> = {}): string {
  if (!c) return '';
  const part = (label: string, v: string | undefined) => (v && v.trim() ? `${label}:\n${v}\n\n` : '');
  const civil = c.caseType === 'civil';
  return (
    part('案件基本资料', c.case) +
    part(civil ? '案件基本信息' : '仲裁基本信息', describeArbitrationMeta(c)) +
    part(civil ? '诉讼文书卷（含起诉状、答辩状）' : '仲裁文书卷（含申请书、答辩状）', c.plead) +
    part('证人与专家陈述笔录', c.record) +
    part('证据材料', c.evidence) +
    part('法律依据', c.law) +
    part(civil ? '原告提交的民事起诉状（学生撰写）' : '申请人提交的仲裁申请书（学生撰写）', documents.claim) +
    part(civil ? '被告提交的答辩状（学生撰写）' : '被申请人提交的答辩状（学生撰写）', documents.answer) +
    part('角色资料', c.person)
  );
}
