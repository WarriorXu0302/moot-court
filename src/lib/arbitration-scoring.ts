/**
 * 国际仲裁评分标准框架（见 docs/arbitration-design.md 第8.2节）
 *
 * 结构与刑事版 SYSTEM_SCORING_FRAMEWORK 完全一致，因此学生端 StageStandardsViewer、
 * parseScoringStandards、stageStandardsToPrompt、教师端评分编辑页全部原样复用。
 *
 * 环节 key 与页面对应：
 *   case-detail            → /student/case-detail（仲裁案例）
 *   arb-claim-writing      → /student/arbitration-writing?doc=claim
 *   arb-answer-writing     → /student/arbitration-writing?doc=answer
 *   arb-award-writing      → /student/arbitration-writing?doc=award
 *   arb-investigation      → /student/arbitration-hearing?phase=investigation
 *   arb-debate             → /student/arbitration-hearing?phase=debate
 *
 * ⚠ 考核要点为初稿，须由课题组校准。"AI 应用四力"来自高校人工智能法律实训联盟（2026-06）。
 */
import type { ArbitrationMeta } from './case-type';

export const ARBITRATION_SCORING_FRAMEWORK = {
  overallDimensions: [
    { name: '管辖权与仲裁协议论证', weight: 20, desc: '能否准确分析仲裁协议的存在、效力、范围，并正确确定仲裁协议的准据法' },
    { name: '证据运用与质证', weight: 20, desc: '围绕真实性、合法性、关联性举证质证，证据与主张对应清晰，证明责任意识明确' },
    { name: '法律适用与外国法查明', weight: 20, desc: '仲裁规则、公约、国内法与实体准据法的引用是否准确，有无编造或误引' },
    { name: '程序意识与庭审表现', weight: 15, desc: '是否遵守仲裁庭审步骤，陈述、询问、辩论是否规范、有层次、理性专业' },
    { name: '文书质量', weight: 15, desc: '仲裁申请书、答辩状、裁决书的结构、说理与格式是否规范' },
    { name: 'AI 应用能力（核查力）', weight: 10, desc: '对 AI 给出的条约条款、规则条文、裁判案例是否自行核查其真实性，能否识别并纠正 AI 的错误或幻觉' },
  ],
  gradingBands: [
    { band: '优秀', range: '90-100', desc: '全面达到环节考核要点，论证严密、程序熟练，且对法律依据进行了有效核查' },
    { band: '良好', range: '75-89', desc: '较好达到考核要点，个别维度有瑕疵但不影响整体质量' },
    { band: '基本可以', range: '60-74', desc: '基本达到考核要点，能完成核心任务但存在明显可改进之处' },
    { band: '需改进', range: '0-59', desc: '未达到考核要点，核心任务完成质量不足，或存在未经核实的法律引用' },
  ],
  stages: [
    {
      key: 'case-detail',
      name: '案例研习',
      roles: ['prosecutor', 'defender', 'judge'],
      points: [
        '从所选角色视角（申请人重请求权基础与管辖依据、被申请人重管辖权异议与抗辩、首席仲裁员重管辖权与争议焦点归纳）分析案情',
        '准确识别仲裁协议的约定内容及可能的效力瑕疵，初步判断仲裁协议准据法的确定路径',
        '能识别案件的争议焦点与关键证据，并对 AI 助手给出的法律依据保持核查意识',
      ],
    },
    {
      key: 'arb-claim-writing',
      name: '仲裁申请书撰写',
      roles: ['prosecutor'],
      points: [
        '当事人信息、仲裁请求（具体、可执行、含金额与费用）、仲裁协议与管辖依据、事实与理由、证据清单结构完整',
        '仲裁请求的请求权基础清晰，金额计算有依据',
        '预判并回应可能的管辖权异议；引用的条文、条约、判例真实可核查',
      ],
    },
    {
      key: 'arb-answer-writing',
      name: '答辩状撰写',
      roles: ['defender'],
      points: [
        '针对申请人每项仲裁请求逐项答辩',
        '管辖权异议抓住仲裁协议的存在、效力、范围和准据法，论证有层次',
        '事实抗辩与证据对应；反请求（如有）具备独立的请求权基础与金额依据；引用的法律依据真实可核查',
      ],
    },
    {
      key: 'arb-investigation',
      name: '庭审调查',
      roles: ['prosecutor', 'defender', 'judge'],
      points: [
        '管辖权异议的陈述与答复紧扣仲裁协议效力与准据法确定规则',
        '举证说明证据来源与证明目的；质证按真实性、合法性、关联性逐项表态，不空泛"不认可"',
        '事实证人询问：直接询问用开放式问题不诱导；交叉询问指向证言矛盾与不可靠之处；专家证人询问聚焦资质、方法与独立性',
        '首席仲裁员：程序安排清晰中立，提问一次一问且指向具体事实或法律依据，保障双方平等陈述机会',
      ],
    },
    {
      key: 'arb-debate',
      name: '庭审辩论',
      roles: ['prosecutor', 'defender', 'judge'],
      points: [
        '结案陈词围绕争议焦点，结构为管辖权、事实认定、法律适用、请求或抗辩结论',
        '自由辩论直接回应对方观点，不重复已有陈述',
        '就仲裁费用承担给出明确主张和理由',
        '首席仲裁员：宣布程序简明，引导围绕焦点辩论，不对实体结果表态',
      ],
    },
    {
      key: 'arb-award-writing',
      name: '裁决书撰写',
      roles: ['judge'],
      points: [
        '争议焦点归纳准确完整，管辖权问题先行说理',
        '事实认定基于证据，证明责任分配正确',
        '法律适用准确（仲裁协议准据法与实体准据法分别论证）',
        '裁决主文明确可执行，与仲裁请求对应，无超裁漏裁；仲裁费用承担有理由；格式规范',
      ],
    },
  ],
};

/** 构建"生成仲裁案例评分标准"的提示词（与刑事版同构，输出 JSON 结构相同） */
export function buildArbitrationScoringPrompt(caseData: {
  name?: string | null;
  profile?: string | null;
  teach?: string | null;
  case_info?: string | null;
  meta?: ArbitrationMeta | null;
}): string {
  const fw = ARBITRATION_SCORING_FRAMEWORK;
  const stageList = fw.stages
    .map((s) => `${s.key}｜${s.name}｜适用角色:${s.roles.join('/')}｜考核要点:\n${s.points.map((p) => `  - ${p}`).join('\n')}`)
    .join('\n');
  const metaLine = caseData.meta
    ? `仲裁规则：${caseData.meta.rules}；仲裁地：${caseData.meta.seat || '未指定'}；实体准据法：${caseData.meta.governingLaw || '未指定'}；争议焦点：${caseData.meta.issues.map((i) => i.title).join('、') || '未指定'}`
    : '';

  return `你是模拟仲裁教学系统的教学督导，请依据"系统评分框架"和本案资料，为本案例生成一套完整的评分标准。

# 案例资料
案例名称：${caseData.name || ''}
案件概况：${(caseData.profile || '').slice(0, 2000)}
教学目标：${(caseData.teach || '').slice(0, 1500)}
仲裁基本信息：${metaLine}
案件详情：${(caseData.case_info || '').slice(0, 3000)}

# 系统评分框架
总标准维度：
${fw.overallDimensions.map((d) => `- ${d.name}（权重${d.weight}%）：${d.desc}`).join('\n')}
等级划分：
${fw.gradingBands.map((b) => `- ${b.band}（${b.range}分）：${b.desc}`).join('\n')}
各环节考核要点：
${stageList}

# 生成要求
1. 结合本案具体案情（争议类型、仲裁协议约定、争议焦点、证据特点、教学目标），将框架落实为本案专属评分标准；
2. 各环节保留框架考核要点精神，criteria 必须体现本案特点（引用本案仲裁条款的关键约定、关键证据类型、争议焦点等）；
3. 每个环节 3-4 个评分维度，权重之和为 100，每个维度 weight 为整数；
4. 总标准 overall.dimensions 必须保留框架的 6 个维度（含"AI 应用能力（核查力）"），权重之和为 100；
5. 不得在 criteria 或 points 中编造法条号、案号；需要提及法律依据时只写原则性表述；
6. 输出严格的 JSON（不要markdown代码块、不要任何多余文字），结构如下：
{
  "overall": {
    "dimensions": [{"name":"管辖权与仲裁协议论证","weight":20,"criteria":"结合本案…"}],
    "grading": [{"band":"优秀","range":"90-100","desc":"…"},{"band":"良好","range":"75-89","desc":"…"},{"band":"基本可以","range":"60-74","desc":"…"},{"band":"需改进","range":"0-59","desc":"…"}]
  },
  "stages": [
    {"key":"环节key（与框架一致）","name":"环节名","roles":["适用角色"],"points":["本案化的考核要点，3-5条"],"dimensions":[{"name":"维度名","weight":整数,"criteria":"结合本案的具体标准"}]}
  ],
  "sampleUnlock": {"scoreThreshold": 60, "evalCountThreshold": 3}
}
7. stages 必须覆盖框架列出的全部 ${fw.stages.length} 个环节，key 与框架完全一致；
8. 所有 criteria 控制在 80 字以内，points 每条控制在 60 字以内。`;
}
