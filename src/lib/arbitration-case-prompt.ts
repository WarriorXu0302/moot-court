/**
 * 国际仲裁案例生成提示词（服务端直接调 LLM，不依赖 Coze 工作流）
 *
 * 输出字段与 cases 表现有列对齐（见 docs/arbitration-design.md 第4.2节）：
 * name/profile/teach/case/plead/record/evidence/law/wrong + person（角色资料）。
 *
 * 防幻觉约束（课题"要解决的问题一"）：
 * - 条约/规则/判例只允许引用用户在需求中给出的、或极为公认的（《纽约公约》《仲裁法》等）依据
 * - 凡不能确认的条文号、案号、金额依据一律标注【待核验】，由教师审核后定稿
 */
import type { ArbitrationMeta } from './case-type';

export const ARBITRATION_CASE_FIELDS = [
  'name', 'profile', 'teach', 'case', 'plead', 'record', 'evidence', 'law', 'wrong', 'person',
] as const;

export type ArbitrationCaseFields = Record<(typeof ARBITRATION_CASE_FIELDS)[number], string>;

export function buildArbitrationCasePrompt(need: string, meta: ArbitrationMeta): string {
  return `你是国际商事仲裁教学案例设计专家，为高校《国际民事诉讼和仲裁程序》课程设计一个可用于模拟仲裁庭实训的教学案例。

【教师需求】
${need}

【案例设定】
- 仲裁规则：${meta.rules}
- 仲裁地：${meta.seat || '（由你根据需求合理设定，并在案情中明确写出）'}
- 实体准据法：${meta.governingLaw || '（由你根据需求合理设定，并在案情中明确写出）'}
- 仲裁语言：${meta.language === 'zh' ? '中文' : meta.language === 'en' ? '英文' : '中英双语'}
- 争议金额：${meta.claimAmount || '（由你合理设定）'}
- 争议焦点（教师指定）：${meta.issues.length ? meta.issues.map((i) => `${i.title}（${i.type}）`).join('；') : '（由你根据需求设定 2-4 个，须包含至少一个管辖权或程序问题与一个实体问题）'}

【输出要求】
只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释。字段如下，值全部为字符串（字段内可含换行）：

- name：案例名称，形如"某某公司诉某某公司买卖合同仲裁案"（当事人用虚构名称，不得使用真实企业名）
- profile：案件概要，150-250字，含争议类型、争议焦点
- teach：训练价值与教学目标，150-300字，说明考查的仲裁知识点与实务能力
- case：案件基本资料，800-1500字。须包含：当事人信息、合同签订与履行经过、争议产生经过、仲裁协议条款原文（须写出完整条款文字，含是否约定仲裁机构/仲裁地/准据法）、申请人的仲裁请求、被申请人的主要抗辩、争议焦点清单
- plead：诉讼文书卷。JSON 数组字符串，元素形如 {"title":"文书名","book":"文书正文"}。至少包含：仲裁申请书、答辩状（可含管辖权异议）。正文须完整，不得只写标题
- record：询问笔录。JSON 数组字符串，元素形如 {"title":"笔录名","book":"笔录正文"}。至少包含两名事实证人的陈述笔录与一名专家证人（如损失计算或外国法）的意见书摘要，问答体
- evidence：证据材料。JSON 数组字符串，元素形如 {"title":"证据名","book":"证据内容或摘要"}。至少 6 份（合同、往来函件/邮件、付款凭证、检验报告等），每份正文不少于 60 字
- law：法律依据。JSON 数组字符串，每个元素为一个字符串，格式"条目标题：正文"。只可引用：①所选仲裁规则的程序性规定（只写你有把握的内容，条文号不确定则不写条文号，只写要点）；②《承认及执行外国仲裁裁决公约》（纽约公约）等公认国际条约的核心规则；③中国《仲裁法》等公认国内法的核心规则；④案情所涉准据法的核心规则。每条正文不少于 40 字。凡你无法确认准确条文号、文号、案号之处，必须在该条末尾加注"【待核验】"，严禁编造判例名称与案号
- wrong：易错点与常见误区，列出 4-6 条学生在本案中容易犯的错误，每条一行
- person：角色资料。JSON 数组字符串，元素形如 {"name":"角色名","voice":"","set":"人设与立场、性格、说话风格、知悉的事实","message":"该角色应当如实陈述或坚持的核心信息"}。须覆盖：申请人代理人、被申请人代理人、首席仲裁员、边裁甲、边裁乙、事实证人（2名）、专家证人、仲裁秘书

【质量要求】
1. 案情须内部自洽：金额、日期、条款、证据相互对得上
2. 双方各有可辩之处，不得一边倒；管辖权争议须有真实的法律分歧点
3. 全部内容围绕教学，不得涉及真实企业、真实个人、真实未公开案件
4. 不得编造法条号、判例名、案号；不确定处标【待核验】`;
}

/** 从 LLM 输出中提取案例 JSON；字段缺失或非字符串时补空串，名称缺失视为失败 */
export function parseArbitrationCaseOutput(text: string): ArbitrationCaseFields | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const out = {} as ArbitrationCaseFields;
  for (const k of ARBITRATION_CASE_FIELDS) {
    const v = o[k];
    // 数组/对象型字段（plead/record/evidence/law/person）模型可能直接给数组，统一序列化为字符串
    out[k] = typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v);
  }
  if (!out.name.trim() || !out.case.trim()) return null;
  return out;
}
