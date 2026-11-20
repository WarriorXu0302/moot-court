/**
 * 生成评分标准种子脚本（一次性，产出 scripts/scoring-seed.json）
 *
 * 数据来源：
 * - 开发环境 Supabase 的全部案例（REST 读取）
 * - 生产环境独有的案例（内嵌 EXTRA_PRODUCT_CASES，经只读查询导出）
 *
 * 生成方式：调用本机 dev server 的 /api/llm/stream（豆包2.0 pro 真实流式输出），
 * 按 src/lib/scoring.ts 的系统评分框架 + 案件资料定制生成，解析校验后落盘。
 *
 * 用法：./node_modules/.bin/tsx scripts/generate-scoring-seed.ts
 */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScoringGenerationPrompt, DEFAULT_SAMPLE_UNLOCK } from '../src/lib/scoring';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface CaseSeedInput {
  id: string;
  name: string | null;
  profile: string | null;
  teach: string | null;
  case_info: string | null;
}

/** 生产环境独有案例（product 只读库导出，开发库不存在） */
const EXTRA_PRODUCT_CASES: CaseSeedInput[] = [
  {
    id: '8222a715-1023-4f15-b2b6-c07ac4263e8d',
    name: '陈浩故意伤害（涉正当防卫）案',
    profile:
      '2023年10月15日凌晨，醉酒的被害人李军在陈浩经营的烧烤店结账时，骚扰陈浩女友、收银员林晓，拒绝道歉且推搡陈浩、打砸店内扫码支付终端，后挣脱工友拉拽持烤串签捅刺陈浩腹部。陈浩躲闪后持店内撬棍击打李军手臂、小腿，致李军轻伤一级。案发后陈浩在现场等候处置，主动供述事实，垫付部分医疗费并缴纳赔偿保证金，但李军拒绝和解，提起附带民事诉讼索赔32万余元，双方就陈浩行为是否构成正当防卫存在核心争议。',
    teach:
      '本案属于典型的涉正当防卫轻伤害刑民交叉案件，证据链完整，涵盖全流程诉讼文书与多维度证据材料，兼具刑事定性、量刑抗辩与附带民事赔偿多元争议点。作为模拟法庭训练材料，可锻炼学生事实辨析、证据运用、法律检索能力，训练举证质证、法庭询问、辩论表达、文书写作等核心实务技能，深化对正当防卫等规则的理解，培养法律职业素养与综合实操能力。',
    case_info:
      '# 陈浩故意伤害案案件基本资料\n## 一、诉讼参与人基本信息\n### （一）被告人\n陈浩，男，1998年7月12日出生，初中文化，个体工商户，系XX市XX区"夜猫子"烧烤店实际经营人。2023年10月15日因涉嫌故意伤害罪被刑事拘留，同年10月27日经批准逮捕，现羁押于XX市第一看守所。委托律师张凯担任辩护人。\n### （二）被害人\n李军，男，1995年3月21日出生，汉族，高中文化，系建筑工地劳务班组长。委托律师刘萌担任刑事附带民事诉讼代理人。\n## 二、案件事实\n2023年10月14日23时12分，李军与工友张磊、王强、赵晓东前往烧烤店就餐，李军饮用约8瓶啤酒。次日凌晨1时47分，李军结账时借酒意抚摸收银员林晓（陈浩女友）脸颊并言语挑逗，林晓呼喊陈浩。陈浩要求李军道歉，李军拒绝并推搡陈浩、砸坏扫码支付终端，双方口角。李军挣脱工友拉拽后冲入后厨取出长约30厘米不锈钢烤串签，持签捅刺陈浩腹部。陈浩躲闪后持约80厘米不锈钢撬棍击打李军左侧手臂，李军烤串签掉落后仍试图上前，陈浩再击打其右侧小腿，李军倒地。李军当日醉酒（呼气酒精127mg/100ml），伤情经鉴定为轻伤一级（左侧尺骨粉碎性骨折伴桡神经挫伤、右侧腓骨骨折），另有十级伤残鉴定，医疗费42769.32元。陈浩在现场等候处置、如实供述，家属垫付医疗费30000元。李军拒绝和解，提起附带民事诉讼索赔32万余元。\n## 三、本案证据\n物证：不锈钢撬棍、烤串签、损毁的扫码支付终端。书证：受案登记表、立案决定书、强制措施文书、户籍与无犯罪记录证明、诊断证明与医疗票据、酒精检测报告、营业台账、垫付收条、到案经过。证人证言：林晓（收银员）、张磊/王强（工友）、周明/刘雅（邻桌顾客）、赵刚（超市老板），证实冲突由李军挑起、李军先持签捅刺。被害人陈述与被告人供述对峙。',
  },
];

const SUPABASE_URL = process.env.COZE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';
const PORT = process.env.DEPLOY_RUN_PORT || '5000';
const SEED_PATH = join(__dirname, 'scoring-seed.json');

interface ScoringStandardsSeed {
  version: number;
  generatedAt: string;
  overall: { dimensions: unknown[]; grading: unknown[] };
  stages: unknown[];
  sampleUnlock: { scoreThreshold: number; evalCountThreshold: number };
}

async function fetchDevCases(): Promise<CaseSeedInput[]> {
  const url = `${SUPABASE_URL}/rest/v1/cases?select=id,name,profile,teach,case_info,status&order=created_at.desc`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`拉取开发环境案例失败: ${res.status}`);
  const rows = (await res.json()) as Array<CaseSeedInput & { status: string }>;
  return rows.filter((r) => r.status !== 'generating' && !(r.name ?? '').startsWith('生成中'));
}

async function callLlm(prompt: string): Promise<string> {
  const res = await fetch(`http://localhost:${PORT}/api/llm/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      caching: false,
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let full = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const obj = JSON.parse(payload) as { content?: string };
        if (obj.content) full += obj.content;
      } catch {
        /* 忽略残缺行 */
      }
    }
  }
  return full;
}

function parseStandards(text: string): ScoringStandardsSeed | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as ScoringStandardsSeed;
    if (
      !parsed.overall ||
      !Array.isArray(parsed.overall.dimensions) ||
      !Array.isArray(parsed.overall.grading) ||
      !Array.isArray(parsed.stages) ||
      parsed.stages.length < 10
    ) {
      return null;
    }
    parsed.version = 1;
    parsed.generatedAt = new Date().toISOString();
    parsed.sampleUnlock = parsed.sampleUnlock || DEFAULT_SAMPLE_UNLOCK;
    return parsed;
  } catch {
    return null;
  }
}

async function main() {
  console.log('[seed] 拉取开发环境案例...');
  const devCases = await fetchDevCases();
  const allCases = [...devCases, ...EXTRA_PRODUCT_CASES.filter((e) => !devCases.some((d) => d.id === e.id))];
  console.log(`[seed] 待生成案例 ${allCases.length} 个：${allCases.map((c) => c.name).join('、')}`);

  // 已有种子做断点续跑
  const seed: Record<string, ScoringStandardsSeed> = {};
  if (existsSync(SEED_PATH)) {
    try {
      Object.assign(seed, JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as Record<string, ScoringStandardsSeed>);
    } catch {
      /* 重新生成 */
    }
  }

  let ok = 0;
  let fail = 0;
  for (const c of allCases) {
    if (seed[c.id]) {
      console.log(`[seed] 已存在，跳过: ${c.name}`);
      ok++;
      continue;
    }
    const prompt = buildScoringGenerationPrompt(c);
    let standards: ScoringStandardsSeed | null = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3 && !standards; attempt++) {
      try {
        console.log(`[seed] 生成中(${attempt}/3): ${c.name}`);
        const text = await callLlm(prompt);
        standards = parseStandards(text);
        if (!standards) lastErr = `JSON不完整(长度${text.length})`;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
      }
    }
    if (standards) {
      seed[c.id] = standards;
      ok++;
      console.log(`[seed] 成功: ${c.name}（${standards.stages.length}个环节）`);
      writeFileSync(SEED_PATH, JSON.stringify(seed, null, 2), 'utf-8');
    } else {
      fail++;
      console.error(`[seed] 失败: ${c.name} — ${lastErr}`);
    }
  }

  console.log(`[seed] 完成：成功${ok} 失败${fail}，已写入 ${SEED_PATH}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error('[seed] 致命错误:', e);
  process.exit(1);
});
