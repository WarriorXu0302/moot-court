/**
 * 文书模板：把文书的固定组成部分作为小标题预先列在编辑区，学生按标题填内容。
 *
 * 当事人名称从本案卷宗的诉辩文书摘要里取（"原告：××。被告：××。"），取不到就留空让学生填。
 * 住所地、法定代表人等卷宗没有的信息一律留空，不替学生编造。
 */
import type { CaseData } from './types';
import type { ArbitrationDoc } from './arbitration-route';

export interface Parties {
  claimant: string;
  respondent: string;
}

function firstMatch(text: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].replace(/^[\s：:]+|[\s。；;，,]+$/g, '').slice(0, 80);
  }
  return '';
}

/** 从诉辩文书摘要中提取双方名称 */
export function extractParties(c: CaseData | null | undefined): Parties {
  let text = '';
  try {
    const items = JSON.parse(c?.plead || '[]') as { book?: string }[];
    text = items.map((i) => i.book ?? '').join('\n');
  } catch {
    text = c?.plead ?? '';
  }
  let claimant = firstMatch(text, [/原告[：:]([^。\n]+)/, /(?<!被)申请人[：:]([^。\n]+)/, /(?<!被)申请人为([^，。\n]+)/]);
  let respondent = firstMatch(text, [/被告[：:]([^。\n]+)/, /被申请人[：:]([^。\n]+)/, /被申请人为([^，。\n]+)/, /答辩人[：:]([^。\n]+)/]);
  // 诉辩摘要里没写当事人时，退回案情原文的开头写法："原告××公司（以下简称……）、被告××公司……"
  const facts = c?.case ?? '';
  if (!claimant) claimant = firstMatch(facts, [/原告([^（(，,、。：:\s]{2,40})/, /(?<!被)申请人([^（(，,、。：:\s]{2,40})/]);
  if (!respondent) respondent = firstMatch(facts, [/被告([^（(，,、。：:\s]{2,40})/, /被申请人([^（(，,、。：:\s]{2,40})/]);
  return { claimant, respondent };
}

/** 一方当事人的信息块（多个当事人用"、"分隔时逐个列出） */
function partyBlock(role: string, names: string): string {
  const list = names ? names.split(/[、，,]/).map((s) => s.trim()).filter(Boolean) : [''];
  return list
    .map((n) => `${role}：${n}\n住所地：\n法定代表人 / 负责人：\n委托代理人：`)
    .join('\n\n');
}

const BLANK = '';

export function buildDocTemplate(caseType: unknown, doc: ArbitrationDoc, c: CaseData | null | undefined): string {
  const { claimant, respondent } = extractParties(c);
  const civil = caseType === 'civil';
  const court = c?.meta?.court && c.meta.court !== '见案情' ? c.meta.court : '';

  if (civil) {
    if (doc === 'claim') {
      return [
        partyBlock('原告', claimant), BLANK,
        partyBlock('被告', respondent), BLANK,
        '诉讼请求：', '一、', '二、', BLANK,
        '管辖依据：', BLANK,
        '事实与理由：', '（一）案件事实', BLANK, '（二）涉外因素与法律关系定性', BLANK, '（三）准据法的确定', BLANK, '（四）请求的实体法依据', BLANK,
        '证据清单：', '1. ', BLANK,
        '此致', court || '××人民法院', BLANK,
        '具状人：', '年　月　日',
      ].join('\n');
    }
    if (doc === 'answer') {
      return [
        partyBlock('答辩人', respondent), BLANK,
        `因原告${claimant || '××'}诉答辩人××纠纷一案，现提出答辩意见如下：`, BLANK,
        '一、管辖异议（如有）', BLANK,
        '二、对诉讼请求的答辩意见', BLANK,
        '三、法律适用意见（定性与准据法）', BLANK,
        '四、事实与证据方面的抗辩', BLANK,
        '证据清单：', '1. ', BLANK,
        '此致', court || '××人民法院', BLANK,
        '答辩人：', '年　月　日',
      ].join('\n');
    }
    return [
      court || '××人民法院', '民事判决书', '（　　）　号', BLANK,
      partyBlock('原告', claimant), BLANK,
      partyBlock('被告', respondent), BLANK,
      '审理经过：', BLANK,
      '原告诉称：', BLANK,
      '被告辩称：', BLANK,
      '本院查明：', BLANK,
      '本院认为：', '（一）管辖', BLANK, '（二）涉外性与定性', BLANK, '（三）准据法的确定与外国法查明', BLANK, '（四）实体争点', BLANK,
      '判决如下：', '一、', '二、', BLANK,
      '案件受理费……由……负担。', BLANK,
      '如不服本判决，可在判决书送达之日起……日内，向本院递交上诉状……', BLANK,
      '审判长：', '审判员：', '年　月　日', '书记员：',
    ].join('\n');
  }

  // 国际商事仲裁
  if (doc === 'claim') {
    return [
      partyBlock('申请人', claimant), BLANK,
      partyBlock('被申请人', respondent), BLANK,
      '仲裁请求：', '一、', '二、', BLANK,
      '仲裁协议及管辖依据：', BLANK,
      '事实与理由：', '（一）合同订立与履行', BLANK, '（二）争议的发生', BLANK, '（三）请求的法律依据', BLANK,
      '证据清单：', '1. ', BLANK,
      '此致', '××仲裁委员会', BLANK,
      '申请人：', '年　月　日',
    ].join('\n');
  }
  if (doc === 'answer') {
    return [
      partyBlock('答辩人（被申请人）', respondent), BLANK,
      `就申请人${claimant || '××'}提起的仲裁案，答辩如下：`, BLANK,
      '一、管辖权异议（如有）', BLANK,
      '二、对仲裁请求的答辩意见', BLANK,
      '三、事实抗辩', BLANK,
      '四、法律抗辩', BLANK,
      '五、反请求（如有）', BLANK,
      '证据清单：', '1. ', BLANK,
      '此致', '××仲裁委员会', BLANK,
      '答辩人：', '年　月　日',
    ].join('\n');
  }
  return [
    '××仲裁委员会', '裁决书', '（　　）　号', BLANK,
    partyBlock('申请人', claimant), BLANK,
    partyBlock('被申请人', respondent), BLANK,
    '一、仲裁程序', BLANK,
    '二、案情与各方主张', BLANK,
    '三、争议焦点', BLANK,
    '四、仲裁庭意见', '（一）管辖权', BLANK, '（二）事实认定', BLANK, '（三）法律适用', BLANK,
    '五、裁决', '1. ', BLANK,
    '仲裁费用承担：', BLANK,
    '本裁决为终局裁决，自作出之日起发生法律效力。', BLANK,
    '首席仲裁员：', '仲裁员：', '仲裁员：', '年　月　日（于××作出）',
  ].join('\n');
}

/** 判断正文是否还只是模板（没写任何实质内容）：去掉模板原文与空白后为空 */
export function isOnlyTemplate(content: string, template: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '');
  return norm(content) === norm(template);
}
