import type { CaseData } from './types';

/**
 * 评分标准系统设置（全局框架）
 *
 * 各环节考核要点提炼自项目全部系统提示词与知识库：
 * - src/lib/knowledge.ts（开庭/法庭调查/法庭辩论/评议/宣判步骤与注意事项、举证/质证/询问/辩论知识）
 * - 各写作页 evalPrompt（辩护词/刑事起诉书/公诉意见书/庭审提纲）
 * - question-generator.ts（案例研习9问题角色视角）
 * - writing-outline.ts（文书结构与写作方法）
 *
 * 每个案例的评分标准由本框架 + 案件资料经 LLM 定制生成，
 * 存储于 cases 表 judge 列（JSON 文本），见 api/cases 路由映射。
 */

export interface ScoringDimension {
  name: string;
  weight: number;
  criteria: string;
}

export interface ScoringStage {
  key: string;
  name: string;
  roles: string[];
  points: string[];
  dimensions: ScoringDimension[];
}

export interface GradingBand {
  band: string;
  range: string;
  desc: string;
}

export interface SampleUnlockRule {
  scoreThreshold: number;
  evalCountThreshold: number;
}

export interface ScoringStandards {
  version: number;
  generatedAt?: string;
  overall: {
    dimensions: ScoringDimension[];
    grading: GradingBand[];
  };
  stages: ScoringStage[];
  sampleUnlock: SampleUnlockRule;
}

/** AI样例解锁规则（系统设置）：文书评分达标 或 评价满3次 */
export const DEFAULT_SAMPLE_UNLOCK: SampleUnlockRule = {
  scoreThreshold: 60,
  evalCountThreshold: 3,
};

export interface DocEvalProgress {
  evalCount: number;
  bestScore: number;
}

/** 判断 AI 样例是否解锁 */
export function isSampleUnlocked(
  progress: DocEvalProgress | undefined,
  rule: SampleUnlockRule = DEFAULT_SAMPLE_UNLOCK,
): boolean {
  if (!progress) return false;
  if (progress.evalCount >= rule.evalCountThreshold) return true;
  return progress.bestScore >= rule.scoreThreshold;
}

/** 便捷别名：是否可查看样例 */
export function canViewSample(progress: DocEvalProgress | undefined, rule: SampleUnlockRule = DEFAULT_SAMPLE_UNLOCK): boolean {
  return isSampleUnlocked(progress, rule);
}

/** 未解锁时的提示文案 */
export function sampleLockedHint(progress: DocEvalProgress | undefined, rule: SampleUnlockRule = DEFAULT_SAMPLE_UNLOCK): string {
  const scoreDesc = `文书评分达到 ${rule.scoreThreshold} 分（基本可以）`;
  const countDesc = `或完成 ${rule.evalCountThreshold} 次评价`;
  if (!progress || progress.evalCount === 0) {
    return `${scoreDesc}${countDesc}后可查看AI样例`;
  }
  const leftCount = Math.max(0, rule.evalCountThreshold - progress.evalCount);
  const leftScore = Math.max(0, rule.scoreThreshold - progress.bestScore);
  if (leftCount <= 0) return `${scoreDesc}${countDesc}后可查看AI样例`;
  return `已评价 ${progress.evalCount} 次（最好 ${progress.bestScore} 分）：再评 ${leftCount} 次或提高 ${leftScore} 分后可查看AI样例`;
}

/** 评价进度持久化：localStorage key（学生+案例维度） */
function evalProgressKey(caseId: string | undefined, studentId: string | undefined): string {
  return `court-eval-progress:${studentId || 'guest'}:${caseId || 'none'}`;
}

/** 读取某学生在某案例下所有文书的评价进度（含SSR兜底） */
export function getEvalProgressMap(
  caseId: string | undefined,
  studentId: string | undefined,
): Record<string, DocEvalProgress> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(evalProgressKey(caseId, studentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, DocEvalProgress>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/** 记录一次评价（计数+1，最好成绩取max），返回更新后的进度 */
export function recordEvalProgress(
  caseId: string | undefined,
  studentId: string | undefined,
  docType: string,
  score: number | null | undefined,
): DocEvalProgress {
  const map = getEvalProgressMap(caseId, studentId);
  const prev = map[docType] || { evalCount: 0, bestScore: 0 };
  const next: DocEvalProgress = {
    evalCount: prev.evalCount + 1,
    bestScore: score == null ? prev.bestScore : Math.max(prev.bestScore, score),
  };
  map[docType] = next;
  try {
    window.localStorage.setItem(evalProgressKey(caseId, studentId), JSON.stringify(map));
  } catch { /* 存储失败忽略 */ }
  return next;
}

/** 解析案例的评分标准 JSON（存储于 judge 列） */
export function parseScoringStandards(json: string | null | undefined): ScoringStandards | null {
  if (!json || !json.trim()) return null;
  try {
    const parsed = JSON.parse(json) as ScoringStandards;
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.overall &&
      Array.isArray(parsed.overall.dimensions) &&
      Array.isArray(parsed.stages)
    ) {
      return {
        ...parsed,
        sampleUnlock: parsed.sampleUnlock || DEFAULT_SAMPLE_UNLOCK,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/** 取某环节的评分标准 */
export function getStageStandards(
  standards: ScoringStandards | null,
  stageKey: string,
): ScoringStage | null {
  if (!standards) return null;
  return standards.stages.find((s) => s.key === stageKey) || null;
}

/** 将环节评分标准转为文本（注入评价提示词） */
export function stageStandardsToPrompt(stage: ScoringStage | null): string {
  if (!stage) return '';
  const dims = stage.dimensions
    .map((d) => `- ${d.name}（权重${d.weight}%）：${d.criteria}`)
    .join('\n');
  const points = stage.points.map((p) => `- ${p}`).join('\n');
  return `本环节评分标准（总分100，按权重打分）：
考核要点：
${points}
评分维度：
${dims}
请严格依据上述标准评价，得分体现标准执行情况。`;
}

/** 学生端文书类型 → AI样例字段 与 环节key 的映射 */
export const DOC_SAMPLE_CONFIG: Record<
  string,
  { sampleField: keyof CaseData; stageKey: string; sampleTitle: string }
> = {
  defense: { sampleField: 'defense', stageKey: 'defense-writing', sampleTitle: '辩护词' },
  indictment: { sampleField: 'indictment', stageKey: 'indictment-writing', sampleTitle: '刑事起诉书' },
  prosecution: { sampleField: 'prosecution', stageKey: 'prosecution-writing', sampleTitle: '公诉意见书' },
  plan: { sampleField: 'plan', stageKey: 'trial-outline-writing', sampleTitle: '庭审提纲' },
};

/**
 * 系统设置的评分框架骨架：环节清单 + 各环节考核要点（源自系统提示词与知识库遍历）。
 * LLM 依据此框架 + 具体案件资料，生成每个案例的完整评分标准。
 */
export const SYSTEM_SCORING_FRAMEWORK = {
  overallDimensions: [
    { name: '事实认定与证据运用', weight: 25, desc: '能否准确归纳案件事实，围绕证据"三性"举证、质证，运用证据链证明主张' },
    { name: '法律适用与论证', weight: 25, desc: '法条与司法解释引用是否准确，定性与量刑论证是否严密' },
    { name: '程序规范', weight: 20, desc: '是否遵守各庭审环节的法定步骤、顺序与规则' },
    { name: '语言表达与文书规范', weight: 20, desc: '法言法语运用、逻辑层次、文书格式是否符合规范' },
    { name: '职业伦理与法庭礼仪', weight: 10, desc: '对抗理性、尊重法庭与诉讼参与人，符合法律职业伦理' },
  ],
  gradingBands: [
    { band: '优秀', range: '90-100', desc: '全面达到环节考核要点，论证严密、程序熟练，可作为示范' },
    { band: '良好', range: '75-89', desc: '较好达到考核要点，个别维度有瑕疵但不影响整体质量' },
    { band: '基本可以', range: '60-74', desc: '基本达到考核要点，能完成核心任务但存在明显可改进之处' },
    { band: '需改进', range: '0-59', desc: '未达到考核要点，核心任务完成质量不足，需针对性补强' },
  ],
  stages: [
    {
      key: 'case-detail',
      name: '案例研习',
      roles: ['defender', 'prosecutor', 'judge'],
      points: [
        '从所选角色视角（辩护人重无罪罪轻情节、公诉人重指控体系、审判长重程序与争议焦点归纳）分析案情',
        '准确回答案件相关的角色专属问题，覆盖案件事实、证据、法律适用三个层面',
        '能识别案件的争议焦点与关键证据',
      ],
    },
    {
      key: 'indictment-review',
      name: '起诉审查',
      roles: ['judge'],
      points: [
        '审查起诉书要件：被告人身份、案件事实、罪名与法律依据、证据目录是否齐全规范',
        '发现起诉书在事实表述、罪名适用、证据引用上的问题',
        '形成是否开庭审理的审查结论并说明理由',
      ],
    },
    {
      key: 'indictment-writing',
      name: '刑事起诉书撰写',
      roles: ['prosecutor'],
      points: [
        '首部（检察机关名称、文号）、正文（犯罪事实、证据、起诉理由与法律依据）、尾部格式规范',
        '犯罪事实叙述做到时间、地点、手段、动机、后果等要素齐全、条理清晰',
        '准确援引刑法条文与司法解释，罪名认定正确',
      ],
    },
    {
      key: 'prosecution-writing',
      name: '公诉意见书撰写',
      roles: ['prosecutor'],
      points: [
        '结构完整：案件事实综述、证据分析、法律适用论证、量刑建议',
        '证据分析围绕证据"三性"与证明力展开，形成完整证明体系',
        '量刑建议有法定量刑情节支撑，论证充分',
      ],
    },
    {
      key: 'defense-writing',
      name: '辩护词撰写',
      roles: ['defender'],
      points: [
        '论点清晰（无罪、罪轻、从轻减轻免除处罚等辩护方向明确）',
        '证据引用准确，质证意见针对证据资格与证明力',
        '法律适用正确，援引刑法、刑事诉讼法及相关司法解释',
        '语言规范，结构层次分明（标题、引言、辩护意见、事实与理由、结语）',
      ],
    },
    {
      key: 'trial-outline-writing',
      name: '庭审提纲撰写',
      roles: ['judge'],
      points: [
        '覆盖开庭准备、法庭调查、法庭辩论、最后陈述、评议宣判全流程',
        '准确归纳案件争议焦点，围绕焦点安排调查与辩论重点',
        '程序要点完备：权利告知、回避询问、举证质证顺序、辩论轮次安排',
      ],
    },
    {
      key: 'judge-opening',
      name: '开庭',
      roles: ['judge'],
      points: [
        '庭前程序性工作完备（起诉书副本送达、开庭通知、传票、公告时限符合规定）',
        '开庭步骤规范：查明被告人情况、宣布案由与来源、告知诉讼权利、询问回避',
        '庭审驾驭沉稳，用语规范',
      ],
    },
    {
      key: 'investigation',
      name: '法庭调查',
      roles: ['defender', 'prosecutor', 'judge'],
      points: [
        '举证规范：说明证据种类、名称、来源、内容与证明目的；书证宣读忠实原意、物证出示原物、视听资料实际播放',
        '举证方法得当：按时间顺序/犯罪构成/分组举证组织证据，突出争议焦点',
        '质证围绕证据"三性"（真实性、合法性、关联性）展开，意见具体明确',
        '询问规范：直接询问用开放式问题不得诱导，交叉询问可诱导但不得威胁、不得损害人格尊严',
        '审判长主持顺序正确：宣读起诉书→被告人陈述→控辩讯问询问→举证质证→核实证据',
      ],
    },
    {
      key: 'debate',
      name: '法庭辩论',
      roles: ['defender', 'prosecutor', 'judge'],
      points: [
        '围绕争议焦点辩论，不离题、不纠缠无关问题',
        '以已查明的事实和证据为依据，以法律为准绳，说理充分、逻辑严密',
        '先亮明观点再展开论证最后总结，善用对比、预判对方观点并适时反击',
        '文明理性对抗，说服法官而非争强斗胜，见好就收',
        '审判长善于抓住分歧点引导辩论深入，及时宣布辩论终结',
      ],
    },
    {
      key: 'sentencing-negotiation',
      name: '量刑协商',
      roles: ['defender', 'prosecutor'],
      points: [
        '准确提出量刑建议并说明法定/酌定量刑情节依据',
        '控辩双方围绕量刑情节展开协商，有理有据、进退有度',
        '协商结果体现宽严相济刑事政策',
      ],
    },
    {
      key: 'final-statement',
      name: '最后陈述',
      roles: ['defender', 'prosecutor', 'judge'],
      points: [
        '保障被告人最后陈述权，陈述环节程序规范',
        '各方对陈述内容的回应符合角色职责',
      ],
    },
    {
      key: 'judge-deliberation',
      name: '评议讨论',
      roles: ['judge'],
      points: [
        '评议内容全面：罪与非罪、构成何罪、刑罚适用、从重从轻情节',
        '遵循评议规则：多数人意见作出决定，少数意见记入笔录，成员必须表态',
        '评议程序正确：承办法官先发言、审判长最后发言并总结',
      ],
    },
    {
      key: 'judge-verdict',
      name: '宣判与闭庭',
      roles: ['judge'],
      points: [
        '宣判步骤规范：书记员安排起立、宣布继续开庭、宣告认证结论与裁判理由及结果',
        '判决结果宣读完毕敲击法槌，告知上诉权（10日内、上诉法院）',
        '宣布闭庭与散庭程序完整',
      ],
    },
  ],
};

/** 构建"生成案例评分标准"的提示词（教师端重新生成 & 种子脚本共用） */
export function buildScoringGenerationPrompt(caseData: {
  name?: string | null;
  profile?: string | null;
  teach?: string | null;
  case_info?: string | null;
}): string {
  const framework = SYSTEM_SCORING_FRAMEWORK;
  const stageList = framework.stages
    .map(
      (s) =>
        `${s.key}｜${s.name}｜适用角色:${s.roles.join('/')}｜考核要点:\n${s.points
          .map((p) => `  - ${p}`)
          .join('\n')}`,
    )
    .join('\n');

  return `你是模拟法庭教学系统的教学督导，请依据"系统评分框架"和本案资料，为本案例生成一套完整的评分标准。

# 案例资料
案例名称：${caseData.name || ''}
案件概况：${(caseData.profile || '').slice(0, 2000)}
教学目标：${(caseData.teach || '').slice(0, 1500)}
案件详情：${(caseData.case_info || '').slice(0, 3000)}

# 系统评分框架（各环节考核要点，源自系统提示词与知识库）
总标准维度：
${framework.overallDimensions.map((d) => `- ${d.name}（权重${d.weight}%）：${d.desc}`).join('\n')}
等级划分：
${framework.gradingBands.map((b) => `- ${b.band}（${b.range}分）：${b.desc}`).join('\n')}
各环节考核要点：
${stageList}

# 生成要求
1. 结合本案的具体案情（罪名、争议焦点、证据特点、教学目标），将上述框架落实为本案专属评分标准；
2. 各环节保留框架给定的考核要点精神，criteria 必须体现本案特点（引用本案罪名、关键证据类型、争议焦点等）；
3. 每个环节 3-4 个评分维度，权重之和为 100，每个维度 weight 为整数；
4. 输出严格的 JSON（不要markdown代码块、不要任何多余文字），结构如下：
{
  "overall": {
    "dimensions": [{"name":"事实认定与证据运用","weight":25,"criteria":"结合本案…"},{"name":"法律适用与论证","weight":25,"criteria":"…"},{"name":"程序规范","weight":20,"criteria":"…"},{"name":"语言表达与文书规范","weight":20,"criteria":"…"},{"name":"职业伦理与法庭礼仪","weight":10,"criteria":"…"}],
    "grading": [{"band":"优秀","range":"90-100","desc":"…"},{"band":"良好","range":"75-89","desc":"…"},{"band":"基本可以","range":"60-74","desc":"…"},{"band":"需改进","range":"0-59","desc":"…"}]
  },
  "stages": [
    {"key":"环节key（与框架一致）","name":"环节名","roles":["适用角色"],"points":["本案化的考核要点，3-5条"],"dimensions":[{"name":"维度名","weight":整数,"criteria":"结合本案的具体标准"}]}
  ],
  "sampleUnlock": {"scoreThreshold": 60, "evalCountThreshold": 3}
}
5. stages 必须覆盖框架列出的全部 ${framework.stages.length} 个环节，key 与框架完全一致；
6. 所有 criteria 控制在 80 字以内，points 每条控制在 60 字以内。`;
}
