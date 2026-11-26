/**
 * 为教材案例生成「庭审设定」（meta.hearingSetup）：双方代理权限与授权事项、证人身份与知情范围、专家背景与出庭依据。
 *
 * 背景（docs/review/hearing-sim.md）：开庭时会被问到代理权限、证人与当事人的关系、专家受谁委托等问题，
 * 但判决类教材原文里没有这些信息——AI 说具体了被判"编造"，说"以委托书为准"又被判"回避"。
 * 这里把这些信息作为训练设定预先写定，开庭时各角色据此回答，教师可在后台修改。
 *
 * 约束：只依据案情、证人笔录、角色设定；不得涉及裁判结论；证人"能作证的事实"必须是案情/笔录里有的。
 *
 * 用法：pnpm exec tsx scripts/enrich-hearing.ts [--only=名称片段] [--force] [--dry] [--concurrency=2]
 */
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';
import { LLMClient } from '../src/lib/llm-client';
import type { HearingSetup } from '../src/lib/case-type';

const argv = process.argv.slice(2);
const flag = (k: string) => argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = flag('only');
const FORCE = argv.includes('--force');
const DRY = argv.includes('--dry');
const CONCURRENCY = Number(flag('concurrency') ?? 2);

function prompt(r: { name: string; case_type: string; case_info: string; record: string; person: string; plead: string }): string {
  const civil = r.case_type === 'civil';
  const [a, b] = civil ? ['原告', '被告'] : ['申请人', '被申请人'];
  return `下面是一个模拟${civil ? '涉外民商事诉讼' : '国际商事仲裁'}训练案例的资料。请为开庭环节写一份"庭审设定"，供 AI 扮演的代理人、证人、专家在开庭时回答身份类问题。

【要求】
1. 代理权限：为${a}、${b}的代理人各写一份。authority 只能是"特别授权"或"一般代理"；scope 写授权事项（特别授权写明可代为承认、放弃、变更诉讼请求，进行和解，提起反诉或上诉等中的哪些；一般代理写"代为起诉/应诉、提交证据、参加庭审、发表代理意见"）。party 用资料中的当事人全称，多个当事人用"、"分隔，只写委托了这名代理人的当事人。一般让双方都是特别授权，除非资料显示某方授权受限。
   起诉状（申请书）列明的当事人如果没有被包含在任何一方代理人的 party 里，放进 absent：side 写 claimant 或 respondent，note 写"经合法传唤未到庭，未委托代理人"（资料显示它另有安排的按资料写）。没有就写 []。
2. 证人：identity 写案涉期间的具体职务和任职单位，以及现在的职业和工作单位（不写姓名；资料没写的，按他知情的事实合理设定，如"案涉交易期间任原告公司投资部经办人，现仍在该公司任职"）；relation 写与双方当事人的关系（明确写在哪一方任职或无关系）；knows 写 4-8 条他亲身经历、能直接作证的具体事实（必须是案情或证人笔录里有的，写清谁、做了什么、什么时候、在哪里），每条末尾用括号写明他是怎么知道的（如"（本人经办，签约时在场）""（本人负责付款审批，见过银行回单）"），知情途径按他的职务合理设定；unknown 写 3-5 条他不知道或不是他经手的事项（与本案争点相关、对方律师可能追问的）。资料里没有证人的，witness 写 null。
3. 专家：background 写专业领域与经历概述（不写真实姓名、学校、职称）；appointedBy 写"经${civil ? '法庭' : '仲裁庭'}通知出庭"或"经某方申请、${civil ? '法庭' : '仲裁庭'}准许出庭"（按角色设定，没写就用前者）；interest 写"与双方当事人及代理人均无利害关系"之类；scope 写本次意见只涉及的法律问题（一两句）。资料里没有专家的，expert 写 null。
4. 不得涉及任何裁判结论或法院（仲裁庭）的认定；不编造金额、日期等案情里没有的事实。
5. 这是写给出庭角色看的设定，要写成确定的陈述：任何字段都不要出现"未载明""未说明""资料没有""不详"这类说法。某个细节资料里没有，就不要写这个细节（不要写"签订地点未载明"，直接不提签订地点）；unknown 写成"他不知道的事"，如"不清楚各方磋商仲裁条款的过程"。

只输出 JSON，不要解释：
{"claimant":{"party":"","authority":"特别授权","scope":""},"respondent":{"party":"","authority":"特别授权","scope":""},"absent":[],"witness":{"identity":"","relation":"","knows":[""],"unknown":[""]},"expert":{"background":"","appointedBy":"","interest":"","scope":""}}

【案例名称】${r.name}
【案情】
${r.case_info.slice(0, 4000)}
【诉辩文书】
${r.plead.slice(0, 2000)}
【证人与专家笔录】
${r.record.slice(0, 3000)}
【角色设定】
${r.person.slice(0, 2500)}`;
}

function valid(h: HearingSetup | null): h is HearingSetup {
  if (!h?.claimant?.party || !h?.respondent?.party) return false;
  for (const p of [h.claimant, h.respondent]) if (!['特别授权', '一般代理'].includes(p.authority) || !p.scope) return false;
  if (h.witness && (!Array.isArray(h.witness.knows) || h.witness.knows.length < 2)) return false;
  if (/未载明|未说明|资料没有|资料未|不详/.test(JSON.stringify(h))) return false;
  return true;
}

async function gen(r: Parameters<typeof prompt>[0]): Promise<HearingSetup> {
  const llm = new LLMClient();
  for (let attempt = 1; attempt <= 4; attempt++) {
    let text = '';
    try {
      for await (const ch of llm.stream([{ role: 'user', content: prompt(r) }], { temperature: 0.3 })) text += ch.content ?? '';
    } catch { continue; }
    const a = text.indexOf('{'); const z = text.lastIndexOf('}');
    try {
      const h = JSON.parse(text.slice(a, z + 1)) as HearingSetup;
      if (h.witness === null) delete h.witness;
      if (h.expert === null) delete h.expert;
      if (!Array.isArray(h.absent) || h.absent.length === 0) delete h.absent;
      if (valid(h)) return h;
    } catch { /* retry */ }
  }
  throw new Error('四次生成都不合格');
}

async function main() {
  const db = getSupabaseClient();
  const { data, error } = await db.from('cases').select('id,name,case_type,case_info,record,person,plead,meta').eq('creator_name', '教材导入');
  if (error) throw error;
  const rows = (data ?? []).filter((r) => (!ONLY || String(r.name).includes(ONLY)) && (FORCE || !(r.meta as { hearingSetup?: unknown })?.hearingSetup));
  console.log(`待处理 ${rows.length} 个`);
  let cursor = 0; let ok = 0; let fail = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const r = rows[cursor++];
      try {
        const h = await gen({ name: String(r.name), case_type: String(r.case_type), case_info: String(r.case_info ?? ''), record: String(r.record ?? ''), person: String(r.person ?? ''), plead: String(r.plead ?? '') });
        const meta = (r.meta ?? {}) as Record<string, unknown> & { reference?: { aiDrafted?: string[] } };
        if (meta.reference) meta.reference.aiDrafted = [...new Set([...(meta.reference.aiDrafted ?? []), 'hearingSetup'])];
        if (!DRY) {
          const { error: e } = await db.from('cases').update({ meta: { ...meta, hearingSetup: h } }).eq('id', r.id);
          if (e) throw e;
        }
        console.log(`✓ ${String(r.name).slice(0, 24)}｜${h.claimant.authority}/${h.respondent.authority}｜证人知情 ${h.witness?.knows.length ?? 0} 条｜专家 ${h.expert ? '有' : '无'}`);
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

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
