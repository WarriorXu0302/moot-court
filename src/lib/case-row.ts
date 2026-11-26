/**
 * 数据库 cases 行 → 前端 CaseData。学生视角（forStudent）在这里剪掉标准答案与裁判小节。
 * 从 api/cases/route.ts 抽出，scripts/hearing-sim.ts 用它得到与学生端完全相同的案件数据。
 */
import { normalizeCaseType, parseArbitrationMeta, isAdversarial } from './case-type';

// Helper: Map DB row to CaseData
export function rowToCaseData(row: Record<string, unknown>, opts: { forStudent?: boolean } = {}) {
  const caseType = normalizeCaseType(row.case_type);
  const metaParsed = isAdversarial(caseType) ? parseArbitrationMeta(row.meta) : undefined;
  // 学生不得看到标准答案（裁判要旨 / 法理分析）。在服务端剪掉，而不是靠前端不渲染——
  // 前端不渲染仍然会让答案出现在网络响应里，F12 就能看到。
  // 案情大纲里的「裁判」小节（一审裁定、二审判决等）就是学生要在庭审中论证的结论，同样在服务端剪掉；
  // 有大纲时，学生拿到的案件基本资料（case）也改为去掉裁判小节后的正文，AI 助教与庭审角色的上下文随之不含结论。
  // 教材原文里数字的千分位用了全角逗号（"2，882，281美元"），读起来像三个数；展示时统一为半角。
  // 只替换"数字，三位数字"且后面不再接数字的情形，"2011年1月17日，天卓…"这类句读不受影响
  const fixThousands = (t: string) => t.replace(/(\d)，(?=\d{3}(?!\d))/g, '$1,');
  if (metaParsed?.outline) {
    metaParsed.outline = metaParsed.outline.map((st) => ({ ...st, sections: st.sections.map((sec) => ({ ...sec, text: fixThousands(sec.text) })) }));
  }
  const studentOutline = metaParsed?.outline
    ?.map((st) => ({ ...st, sections: st.sections.filter((sec) => sec.kind !== 'ruling') }))
    .filter((st) => st.sections.length > 0);
  const meta = metaParsed && opts.forStudent ? { ...metaParsed, reference: undefined, outline: studentOutline } : metaParsed;
  const studentCaseText = opts.forStudent && studentOutline && studentOutline.length > 0
    ? studentOutline.flatMap((st) => st.sections.map((sec) => sec.text)).join('\n')
    : undefined;
  return {
    id: row.id as string,
    caseType,
    meta,
    name: (row.name as string) || '',
    profile: (row.profile as string) || '',
    teach: (row.teach as string) || '',
    case: fixThousands(studentCaseText ?? ((row.case_info as string) || '')),
    plead: (row.plead as string) || '',
    record: (row.record as string) || '',
    evidence: (row.evidence as string) || '',
    law: (row.law as string) || '',
    indictment: (row.indictment as string) || '',
    prosecution: (row.prosecution as string) || '',
    defense: (row.defense as string) || '',
    victim: (row.victim as string) || '',
    plan: (row.plan as string) || '',
    person: (row.person as string) || '',
    judge: '',
    scoringStandards: (row.judge as string) || '',
    wrong: (row.wrong as string) || '',
    highlights: typeof row.highlights === 'string' ? row.highlights : (row.highlights ? JSON.stringify(row.highlights) : ''),
    creatorName: (row.creator_name as string) || '李璎霖',
    status: (row.status as string) || 'generated',
    createdAt: (row.created_at as string) || new Date().toISOString(),
    updatedAt: (row.updated_at as string) || new Date().toISOString(),
    workflowExecutionId: (row.workflow_execute_id as string) || undefined,
    generateExecuteId: (row.generate_execute_id as string) || undefined,
  };
}
