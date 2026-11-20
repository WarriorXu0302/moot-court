import { CaseLifecycle, CaseData, UserRole, LifecycleNode } from "@/lib/types";
import { useAppStore } from "@/lib/store";

/**
 * 字符串感知的括号计数：从 openIdx 开始找到与起始括号配对的闭合位置
 * 正确跳过 JSON 字符串值内部的 { } [ ] 与转义引号
 * @returns 闭合括号的索引，未找到返回 -1
 */
function findMatchingBracket(text: string, openIdx: number): number {
  const open = text[openIdx];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 从 AI 回复文本中解析 LIFECYCLE 标签并更新 store
 * AI 会在回复末尾输出 <LIFECYCLE>{...}</LIFECYCLE> 或 <LIFECYCLE>[...]</LIFECYCLE> 格式的 JSON
 *
 * AI 只输出已完成的阶段节点，所有解析到的节点标记为 completed: true
 *
 * @returns 清理后的文本（彻底去除 LIFECYCLE 标签及其全部内容）
 */
export function parseLifecycleFromAIResponse(fullText: string): string {
  const startIdx = fullText.indexOf('<LIFECYCLE>');
  if (startIdx === -1) return fullText;

  // 定位闭标签；若闭标签缺失（流式中断/格式不规范），剥离标签及其后的所有内容
  const CLOSE_TAG = '</LIFECYCLE>';
  const closeIdx = fullText.indexOf(CLOSE_TAG, startIdx);
  const segmentEnd = closeIdx >= 0 ? closeIdx + CLOSE_TAG.length : fullText.length;
  const segment = fullText.slice(startIdx, segmentEnd);

  // 提取 JSON：支持对象 {}（标准）与数组 [...]（AI 偶发）两种包裹格式
  try {
    const objStart = segment.indexOf('{');
    const arrStart = segment.indexOf('[');
    let jsonStr = '';
    if (arrStart >= 0 && (objStart === -1 || arrStart < objStart)) {
      const end = findMatchingBracket(segment, arrStart);
      if (end > 0) jsonStr = segment.slice(arrStart, end + 1);
    } else if (objStart >= 0) {
      const end = findMatchingBracket(segment, objStart);
      if (end > 0) jsonStr = segment.slice(objStart, end + 1);
    }
    if (jsonStr) {
      const raw = JSON.parse(jsonStr) as CaseLifecycle | LifecycleNode[];
      const nodes = Array.isArray(raw) ? raw : raw.nodes;
      if (Array.isArray(nodes) && nodes.length > 0) {
        const completedNodes = nodes.map(n => ({ ...n, completed: true }));
        useAppStore.getState().setLifecycle({ nodes: completedNodes });
      }
    }
  } catch {
    // JSON parse failed — still strip the raw tag from display
  }

  // 彻底剥离整个标签区间，保证任何格式残片都不泄露
  return (fullText.slice(0, startIdx) + fullText.slice(segmentEnd)).trim();
}

/**
 * 纯展示层兜底：剥离 LIFECYCLE 标签及内容（不写 store）
 * 用于 summary/evaluation 等二级展示场景的保险过滤
 */
export function stripLifecycleTag(text: string): string {
  if (!text) return text;
  const openIdx = text.indexOf('<LIFECYCLE>');
  if (openIdx === -1) return text;
  const CLOSE_TAG = '</LIFECYCLE>';
  const closeIdx = text.indexOf(CLOSE_TAG, openIdx);
  const end = closeIdx >= 0 ? closeIdx + CLOSE_TAG.length : text.length;
  return (text.slice(0, openIdx) + text.slice(end)).trim();
}

/**
 * 流式输出时过滤 LIFECYCLE 标签（包括不完整的标签）
 * 流式过程中标签是逐字到达的，需要同时处理：
 * 1. 完整的 <LIFECYCLE> 开标签
 * 2. 部分开标签（如 <LIF、<LIFECY）— 避免闪烁乱码
 */
export function stripLifecycleForStreaming(text: string): string {
  const TAG = 'LIFECYCLE';
  const idx = text.indexOf('<LIFECYCLE>');
  if (idx >= 0) return text.slice(0, idx).trimEnd();
  // 检查末尾是否有部分开标签：'<' + 'LIFECYCLE' 的前缀（至少2字符，避免误伤普通 '<'）
  const tail = text.slice(-(TAG.length + 1));
  const ltIdx = tail.lastIndexOf('<');
  if (ltIdx >= 0) {
    const fragment = tail.slice(ltIdx);
    if (fragment.length >= 3 && TAG.startsWith(fragment.slice(1))) {
      return text.slice(0, text.length - fragment.length).trimEnd();
    }
  }
  return text;
}

/** 流式期间是否已有用户可见正文（剥离 LIFECYCLE 标签后非空）——用于区分“正在思考”与“已开始输出” */
export function hasVisibleStream(text: string): boolean {
  return stripLifecycleForStreaming(text).trim().length > 0;
}

/**
 * 获取角色对应的案件前阶段（学生进入案件详情页之前已发生的阶段）
 * 不同角色进入案件的时点不同，前置节点也不同
 */
function getPreCaseStages(role: UserRole | null): string[] {
  switch (role) {
    case 'prosecutor':
      // 公诉人在审查起诉阶段介入，之前有：立案→侦查→移送审查起诉
      return ['立案', '侦查', '移送审查起诉'];
    case 'defender':
      // 辩护人在提起公诉后介入，之前有：立案→侦查→移送审查起诉→审查起诉→提起公诉
      return ['立案', '侦查', '移送审查起诉', '审查起诉', '提起公诉'];
    case 'judge':
      // 审判长在提起公诉后介入，之前有：立案→侦查→移送审查起诉→审查起诉→提起公诉
      return ['立案', '侦查', '移送审查起诉', '审查起诉', '提起公诉'];
    default:
      // 默认：立案→侦查→移送审查起诉→审查起诉→提起公诉
      return ['立案', '侦查', '移送审查起诉', '审查起诉', '提起公诉'];
  }
}

/**
 * 获取角色对应的初始生命周期阶段提示词
 */
function getRoleSpecificPrompt(role: UserRole | null): string {
  const preStages = getPreCaseStages(role);
  const roleLabel = role === 'prosecutor' ? '公诉人'
    : role === 'defender' ? '辩护人'
    : role === 'judge' ? '审判长'
    : '学生';

  return `学生当前角色是「${roleLabel}」，该角色在案件诉讼流程中介入的时点如下：
- 学生进入案件详情页时，案件已经经历了以下阶段（均为已完成）：${preStages.join(' → ')}
- 请只为这些已完成的阶段生成生命周期节点
- 不要生成学生尚未到达的未来阶段（如法庭调查、法庭辩论、宣判等）
- 生命周期只覆盖从立案到一审判决生效，不包含二审、死刑复核、执行等后续阶段`;
}

/**
 * 在学生进入案例详情页时，自动生成初始案件生命周期
 * 只生成学生查看案件之前已完成的阶段节点
 * 根据角色判断前置阶段，并结合案件材料和法庭知识库
 */
export async function generateInitialLifecycle(caseData: CaseData, role: UserRole | null): Promise<void> {
  const store = useAppStore.getState();

  // 如果已有生命周期数据，不重复生成
  if (store.lifecycle && store.lifecycle.nodes && store.lifecycle.nodes.length > 0) {
    return;
  }

  store.setLifecycleLoading(true);

  try {
    const caseContext = `案件名称: ${caseData.name || ''}
案件基本介绍: ${caseData.profile || ''}
案件基本资料: ${caseData.case || ''}
诉讼文书卷: ${caseData.plead || ''}
相关法条和司法解释: ${caseData.law || ''}`;

    const systemPrompt = `你是一位刑事诉讼法专家。请根据以下案件材料，智能生成该案件在学生进入前已完成的刑事诉讼阶段节点。

${getRoleSpecificPrompt(role)}

要求：
1. 只生成已完成的阶段节点（学生在进入案件详情页之前已经发生的阶段）
2. 每个节点必须包含：stage(阶段名称)、legalActions(该阶段的法律行为)、documents(该阶段形成的法律文书)、legalBasis(法律依据)
3. 根据案件材料中的具体信息（如罪名、案件经过等）来填充每个节点的详细内容
4. 【重要】每个字段必须详细、具体，起到教学提示作用，禁止使用过于简短的概括性描述：
   - legalActions：详细描述该阶段的具体法律行为，包括谁做了什么、程序如何进行、关键步骤等（不少于30字）
   - documents：列出该阶段形成的法律文书名称，并简要说明文书内容和作用（不少于20字）
   - legalBasis：写明法律条文全称及条文要旨，如"《刑事诉讼法》第194条：法庭调查阶段，公诉人、当事人和辩护人、诉讼代理人可以对证据和案件情况发表意见"
5. 只输出JSON，不要输出其他文字

输出格式（用LIFECYCLE标签包裹）：
<LIFECYCLE>
{"nodes":[{"stage":"立案","legalActions":"公安机关对报案、控告、举报或犯罪嫌疑人自首的材料进行审查，认为有犯罪事实需要追究刑事责任时，决定立案侦查，启动刑事诉讼程序","documents":"受案登记表（记录案件来源和基本情况）、立案决定书（载明立案依据和侦查方向）","legalBasis":"《刑事诉讼法》第112条：公安机关或者人民检察院发现犯罪事实或者犯罪嫌疑人，应当按照管辖范围立案侦查"},{"stage":"侦查","legalActions":"公安机关依法开展侦查活动，包括讯问犯罪嫌疑人、询问证人、勘验检查、搜查、扣押物证书证、鉴定等，全面收集和固定案件证据材料","documents":"侦查终结报告（总结侦查过程和证据情况）、证据材料卷宗（含讯问笔录、证人证言、物证照片、鉴定意见等）","legalBasis":"《刑事诉讼法》第113条：公安机关对已经立案的刑事案件进行侦查，收集、调取犯罪嫌疑人有罪或者无罪、罪轻或者罪重的证据材料；第162条：公安机关侦查终结的案件应当移送同级人民检察院审查决定"},...]}
</LIFECYCLE>`;

    const response = await fetch('/api/llm/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: caseContext },
        ],
        temperature: 0.3,
        caching: true,
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
            }
          } catch { /* skip */ }
        }
      }
    }

    // Parse the LIFECYCLE tag from the response
    let parsed = false;
    const lifecycleMatch = fullText.match(/<LIFECYCLE>([\s\S]*?)<\/LIFECYCLE>/);
    if (lifecycleMatch) {
      try {
        const lifecycleData = JSON.parse(lifecycleMatch[1].trim()) as CaseLifecycle;
        if (lifecycleData && Array.isArray(lifecycleData.nodes) && lifecycleData.nodes.length > 0) {
          const completedNodes = lifecycleData.nodes.map(n => ({ ...n, completed: true }));
          useAppStore.getState().setLifecycle({ nodes: completedNodes });
          parsed = true;
        }
      } catch {
        // JSON parse failed, try to extract JSON directly
        const jsonMatch = fullText.match(/\{[\s\S]*"nodes"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const lifecycleData = JSON.parse(jsonMatch[0]) as CaseLifecycle;
            if (lifecycleData && Array.isArray(lifecycleData.nodes) && lifecycleData.nodes.length > 0) {
              const completedNodes = lifecycleData.nodes.map(n => ({ ...n, completed: true }));
              useAppStore.getState().setLifecycle({ nodes: completedNodes });
              parsed = true;
            }
          } catch {
            // will fallback below
          }
        }
      }
    } else {
      // No LIFECYCLE tag found, try to extract raw JSON
      const jsonMatch = fullText.match(/\{[\s\S]*"nodes"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const lifecycleData = JSON.parse(jsonMatch[0]) as CaseLifecycle;
          if (lifecycleData && Array.isArray(lifecycleData.nodes) && lifecycleData.nodes.length > 0) {
            const completedNodes = lifecycleData.nodes.map(n => ({ ...n, completed: true }));
            useAppStore.getState().setLifecycle({ nodes: completedNodes });
            parsed = true;
          }
        } catch {
          // will fallback below
        }
      }
    }

    if (!parsed) {
      useAppStore.getState().setLifecycle(getFallbackLifecycle(role));
    }
  } catch {
    // On any error, set a fallback lifecycle so UI is not stuck
    useAppStore.getState().setLifecycle(getFallbackLifecycle(role));
  } finally {
    useAppStore.getState().setLifecycleLoading(false);
  }
}

/**
 * Fallback lifecycle when AI generation fails
 * 只生成案件前阶段的节点，全部标记为 completed: true
 */
function getFallbackLifecycle(role: UserRole | null): CaseLifecycle {
  const preStages = getPreCaseStages(role);
  const allNodes: Record<string, LifecycleNode> = {
    '立案': { stage: '立案', legalActions: '公安机关对报案、控告、举报或犯罪嫌疑人自首的材料进行审查，认为有犯罪事实需要追究刑事责任时，决定立案侦查，启动刑事诉讼程序', documents: '受案登记表（记录案件来源和基本情况）、立案决定书（载明立案依据和侦查方向）', legalBasis: '《刑事诉讼法》第112条：公安机关或者人民检察院发现犯罪事实或者犯罪嫌疑人，应当按照管辖范围立案侦查', completed: true },
    '侦查': { stage: '侦查', legalActions: '公安机关依法开展侦查活动，包括讯问犯罪嫌疑人、询问证人、勘验检查、搜查、扣押物证书证、鉴定等，全面收集和固定案件证据材料', documents: '侦查终结报告（总结侦查过程和证据情况）、证据材料卷宗（含讯问笔录、证人证言、物证照片、鉴定意见等）', legalBasis: '《刑事诉讼法》第113条：公安机关对已经立案的刑事案件进行侦查，收集、调取犯罪嫌疑人有罪或者无罪、罪轻或者罪重的证据材料', completed: true },
    '移送审查起诉': { stage: '移送审查起诉', legalActions: '公安机关侦查终结后，认为犯罪事实清楚、证据确实充分，应当追究刑事责任，将案件连同起诉意见书移送同级人民检察院审查决定', documents: '起诉意见书（载明案件事实、证据、定性意见和移送理由）、全部案卷材料和证据', legalBasis: '《刑事诉讼法》第162条：公安机关侦查终结的案件，应当做到犯罪事实清楚，证据确实、充分，并且写出起诉意见书，连同案卷材料、证据一并移送同级人民检察院审查', completed: true },
    '审查起诉': { stage: '审查起诉', legalActions: '人民检察院对移送审查起诉的案件进行全面审查，包括讯问犯罪嫌疑人、听取被害人及辩护人意见、审查证据材料，决定是否提起公诉或作出不起诉决定', documents: '起诉书（载明被告人基本情况、犯罪事实、证据目录和法律适用）、审查起诉报告（记录审查过程和决定依据）', legalBasis: '《刑事诉讼法》第169条：人民检察院对于公安机关移送起诉的案件，应当在一个月以内作出决定，重大、复杂的案件可以延长半个月', completed: true },
    '提起公诉': { stage: '提起公诉', legalActions: '人民检察院认为犯罪嫌疑人的犯罪事实已经查清，证据确实、充分，依法应当追究刑事责任，向有管辖权的人民法院提起公诉，并将起诉书副本送达被告人及其辩护人', documents: '起诉书（正式提交法院的公诉文书，载明指控的犯罪事实和罪名）、证据目录和证人名单', legalBasis: '《刑事诉讼法》第186条：人民法院对提起公诉的案件进行审查后，对于起诉书中有明确的指控犯罪事实的，应当决定开庭审判', completed: true },
  };

  return {
    nodes: preStages.map(s => allNodes[s]).filter(Boolean),
  };
}

/**
 * 页面路径 → 诉讼阶段映射（按角色区分）
 * 当学生跳过某页面时，将该页面对应的阶段标记为已完成
 */
const PAGE_STAGE_MAP: Record<string, { stage: string; legalActions: string; documents: string; legalBasis: string }> = {
  "case-detail": { stage: "案件查阅", legalActions: "学生查阅案件材料，了解案件基本情况，包括案件事实、证据材料、诉讼文书卷宗和相关法条，为后续诉讼角色的工作做好准备", documents: "案件材料汇总（含案件基本资料、诉讼文书卷、询问笔录、证据材料和法条索引）", legalBasis: "《刑事诉讼法》第40条：辩护律师自人民检察院对案件审查起诉之日起，可以查阅、摘抄、复制本案的案卷材料" },
  "indictment-writing": { stage: "审查起诉", legalActions: "公诉人根据案件事实和证据，撰写刑事起诉书，载明被告人的基本情况、犯罪事实、证据目录、适用法律条文和指控罪名，为提起公诉做准备", documents: "刑事起诉书（载明被告人基本情况、犯罪事实、证据目录、法律适用和指控罪名）", legalBasis: "《刑事诉讼法》第176条：人民检察院认为犯罪嫌疑人的犯罪事实已经查清，证据确实、充分，依法应当追究刑事责任的，应当作出起诉决定，按照审判管辖的规定，向人民法院提起公诉" },
  "prosecution-writing": { stage: "审查起诉", legalActions: "公诉人撰写公诉意见书，系统阐述指控犯罪的依据和理由，包括对案件事实的认定、证据分析、法律适用意见和量刑建议，为法庭辩论阶段的公诉发言做准备", documents: "公诉意见书（载明对案件事实的认定、证据分析意见、法律适用和量刑建议）", legalBasis: "《刑事诉讼法》第172条：人民检察院审查案件时，应当讯问犯罪嫌疑人，听取辩护人或者值班律师、被害人及其诉讼代理人的意见，并记录在案" },
  "indictment-review": { stage: "提起公诉", legalActions: "审判长对人民检察院提起公诉的案件进行形式审查，审查起诉书是否有明确的指控犯罪事实、是否属于本院管辖、相关材料是否齐备，决定是否受理案件并开庭审判", documents: "起诉书审查记录（载明审查内容、审查结果和受理决定）、案件受理登记表", legalBasis: "《刑事诉讼法》第186条：人民法院对提起公诉的案件进行审查后，对于起诉书中有明确的指控犯罪事实的，应当决定开庭审判" },
  "trial-outline-writing": { stage: "审判准备", legalActions: "审判长制定庭审提纲，确定庭审重点和程序安排，包括法庭调查的顺序、举证质证的重点、法庭辩论的焦点问题，并完成庭前公告、送达等程序性准备工作", documents: "庭审提纲（载明庭审程序安排、调查重点、辩论焦点和注意事项）、庭前准备笔录", legalBasis: "《刑事诉讼法》第187条：人民法院决定开庭审判后，应当确定合议庭的组成人员，将人民检察院的起诉书副本至迟在开庭十日以前送达被告人及其辩护人" },
  "sentencing-negotiation": { stage: "审查起诉", legalActions: "辩护人与公诉人就量刑问题进行协商沟通，辩护人提出从轻、减轻处罚的量刑意见和理由，双方就量刑建议进行讨论，促进量刑公正和案件繁简分流", documents: "量刑建议书（载明建议量刑幅度、量刑情节和理由）、量刑协商笔录", legalBasis: "《刑事诉讼法》第173条：人民检察院审查案件，应当听取犯罪嫌疑人及其辩护人或者值班律师的意见，并记录在案；犯罪嫌疑人认罪认罚的，应当告知其享有的诉讼权利和认罪认罚的法律规定" },
  "defense-writing": { stage: "审判准备", legalActions: "辩护人根据案件事实和证据，撰写辩护词，系统阐述辩护意见，包括对指控事实的异议、证据的质证意见、法定和酌定从轻减轻情节的论证，为法庭辩论阶段的辩护发言做准备", documents: "辩护词（载明辩护意见、事实分析、证据质证和法律适用论证）", legalBasis: "《刑事诉讼法》第33条：犯罪嫌疑人、被告人除自己行使辩护权外，还可以委托一至二人作为辩护人；第37条：辩护人的责任是根据事实和法律，提出犯罪嫌疑人、被告人无罪、罪轻或者减轻、免除刑事责任的材料和意见" },
  "judge-opening": { stage: "开庭", legalActions: "审判长宣布开庭，依次完成以下程序：查明当事人身份、宣布案由和合议庭组成人员、告知当事人诉讼权利和义务、询问当事人是否申请回避，确保庭审程序合法启动", documents: "开庭笔录（记录开庭全过程，含当事人身份核实、权利告知、回避申请等内容）", legalBasis: "《刑事诉讼法》第190条：开庭的时候，审判长查明当事人是否到庭，宣布案由；宣布合议庭的组成人员、书记员、公诉人、辩护人、诉讼代理人、鉴定人和翻译人员的名单；告知当事人有权对合议庭组成人员、书记员、公诉人、鉴定人和翻译人员申请回避" },
  "court-investigation": { stage: "法庭调查", legalActions: "辩护人参与法庭调查阶段，包括对公诉人出示的证据进行质证、申请出示有利于被告人的证据、对证人证言和鉴定意见发表质证意见，查明案件事实真相", documents: "庭审笔录（记录法庭调查全过程）、证据清单（列明控辩双方出示的全部证据及质证意见）", legalBasis: "《刑事诉讼法》第194条：公诉人、当事人和辩护人、诉讼代理人可以对证据和案件情况发表意见，互相辩论；法庭审理过程中，合议庭对证据有疑问的，可以宣布休庭，对证据进行调查核实" },
  "prosecutor-investigation": { stage: "法庭调查", legalActions: "公诉人在法庭调查阶段向法庭出示证据，宣读证言和鉴定意见，对辩护人出示的证据进行质证，阐明证据的合法性、客观性和关联性，构建完整的证据链条证明指控事实", documents: "庭审笔录（记录公诉人举证和质证过程）、证据清单（公诉方出示的全部证据及证明目的）", legalBasis: "《刑事诉讼法》第194条：公诉人、当事人和辩护人、诉讼代理人可以对证据和案件情况发表意见，互相辩论；第195条：公诉人、辩护人应当向法庭出示物证，让当事人辨认" },
  "judge-investigation": { stage: "法庭调查", legalActions: "审判长主持法庭调查，依次引导公诉人举证、被告人及辩护人质证，控辩双方出示证据并互相质证，审判长对证据的合法性、真实性进行审查，确保法庭调查程序规范有序", documents: "庭审笔录（记录法庭调查全部过程和内容）、证据清单（汇总控辩双方全部证据及质证意见）", legalBasis: "《刑事诉讼法》第194条：公诉人、当事人和辩护人、诉讼代理人可以对证据和案件情况发表意见，互相辩论；第191条：公诉人在法庭上宣读起诉书后，被告人、被害人可以就起诉书指控的犯罪进行陈述，公诉人可以讯问被告人" },
  "court-debate": { stage: "法庭辩论", legalActions: "辩护人在法庭辩论阶段发表辩护意见，围绕案件事实认定、证据采信、法律适用和量刑情节等方面进行论证，与公诉人就争议焦点展开辩论，维护被告人的合法权益", documents: "庭审笔录（记录法庭辩论全过程和双方辩论意见）", legalBasis: "《刑事诉讼法》第198条：法庭审理过程中，对与定罪、量刑有关的事实、证据都应当进行调查、辩论；经审判长许可，公诉人、当事人和辩护人、诉讼代理人可以对证据和案件情况发表意见，互相辩论" },
  "prosecutor-debate": { stage: "法庭辩论", legalActions: "公诉人在法庭辩论阶段发表公诉意见，系统阐述指控犯罪的事实依据和法律依据，对辩护人的辩护意见进行答辩，就定罪量刑问题与辩护人展开辩论，维护国家刑罚权", documents: "庭审笔录（记录公诉人辩论发言和与辩护人的辩论过程）", legalBasis: "《刑事诉讼法》第198条：法庭审理过程中，对与定罪、量刑有关的事实、证据都应当进行调查、辩论；经审判长许可，公诉人、当事人和辩护人、诉讼代理人可以对证据和案件情况发表意见，互相辩论" },
  "judge-debate": { stage: "法庭辩论", legalActions: "审判长主持法庭辩论，引导公诉人发表公诉意见和辩护人发表辩护意见，组织控辩双方就案件事实和法律适用问题展开有序辩论，确保辩论充分、公平进行", documents: "庭审笔录（记录法庭辩论全过程、控辩双方辩论意见和审判长主持情况）", legalBasis: "《刑事诉讼法》第198条：法庭审理过程中，对与定罪、量刑有关的事实、证据都应当进行调查、辩论；审判长应当宣布辩论终结，被告人有最后陈述的权利" },
  "final-statement": { stage: "最后陈述", legalActions: "被告人在法庭辩论结束后作最后陈述，就案件事实、量刑意见和个人情况向法庭表达最终意见，这是被告人享有的法定诉讼权利，法庭应当保障其充分陈述", documents: "庭审笔录（记录被告人最后陈述内容）", legalBasis: "《刑事诉讼法》第198条：审判长在宣布辩论终结后，被告人有最后陈述的权利" },
  "judge-final-statement": { stage: "最后陈述", legalActions: "审判长在法庭辩论终结后，告知被告人享有最后陈述权并保障其充分陈述，被告人陈述完毕后，审判长宣布休庭，合议庭开始进行评议", documents: "庭审笔录（记录被告人最后陈述内容）、休庭宣布笔录", legalBasis: "《刑事诉讼法》第198条：审判长在宣布辩论终结后，被告人有最后陈述的权利；第200条：合议庭进行评议，根据已经查明的事实、证据和有关的法律规定作出判决" },
  "judge-deliberation": { stage: "评议", legalActions: "合议庭在休庭后进行评议，合议庭成员根据法庭审理中查明的事实、证据和法律规定，对案件的定罪量刑问题进行讨论和表决，形成判决意见并制作评议笔录", documents: "评议笔录（记录合议庭成员意见、表决结果和判决理由）", legalBasis: "《刑事诉讼法》第200条：在被告人最后陈述后，审判长宣布休庭，合议庭进行评议，根据已经查明的事实、证据和有关的法律规定，作出判决" },
  "judge-verdict": { stage: "一审宣判", legalActions: "审判长宣告判决，公开宣读判决书主文和理由，告知当事人上诉权利和上诉期限，宣布闭庭，一审判决在法定上诉期满后生效（如无上诉或抗诉）", documents: "判决书（载明案件事实、证据采信、法律适用、判决主文和上诉权利告知）", legalBasis: "《刑事诉讼法》第202条：宣告判决，一律公开进行；当庭宣告判决的，应当在五日以内将判决书送达当事人和提起公诉的人民检察院" },
};

/**
 * 跳过时推进案件生命周期到指定阶段
 * 将该页面对应的阶段标记为已完成（completed: true）
 * 如果生命周期中还没有该阶段的数据，则添加新节点
 */
export function advanceLifecycleForPage(pagePath: string): void {
  const store = useAppStore.getState();
  const current = store.lifecycle;

  // 从路径提取阶段标识
  for (const [key, value] of Object.entries(PAGE_STAGE_MAP)) {
    if (pagePath.includes(key)) {
      const newNode: LifecycleNode = { ...value, completed: true };
      if (current && Array.isArray(current.nodes)) {
        // 检查是否已有该阶段（按 stage 名称匹配）
        const existingIdx = current.nodes.findIndex((n) => n.stage === value.stage);
        if (existingIdx >= 0) {
          // 已有该阶段，标记为已完成
          const newNodes = [...current.nodes];
          newNodes[existingIdx] = { ...newNodes[existingIdx], completed: true };
          store.setLifecycle({ nodes: newNodes });
        } else {
          // 添加该阶段（已完成）
          store.setLifecycle({ nodes: [...current.nodes, newNode] });
        }
      } else {
        // 初始化生命周期
        store.setLifecycle({ nodes: [newNode] });
      }
      return;
    }
  }
}
