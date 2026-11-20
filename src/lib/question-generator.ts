import type { CaseData, UserRole } from "@/lib/types";

/**
 * 根据案件全部资料和用户角色，调用 LLM 生成针对性的思考题
 * 返回问题字符串数组
 */
export async function generateCaseQuestions(
  caseData: CaseData,
  role: UserRole,
): Promise<string[]> {
  const roleLabels: Record<UserRole, string> = {
    defender: "辩护人",
    prosecutor: "公诉人",
    judge: "审判长",
  };

  const roleFocus: Record<UserRole, string> = {
    defender: "辩护角度，重点关注对被告人有利的证据、量刑情节、程序瑕疵、辩护策略",
    prosecutor: "公诉角度，重点关注犯罪构成要件、证据链完整性、量刑建议、认罪认罚",
    judge: "审判长角度，重点关注程序合法性、争议焦点归纳、庭审驾驭、法律适用",
  };

  const caseContext = `案件名称: ${caseData.name || ""}
案件基本介绍: ${caseData.profile || ""}
案件基本资料: ${caseData.case || ""}
诉讼文书卷: ${caseData.plead || ""}
询问笔录: ${caseData.record || ""}
证据材料: ${caseData.evidence || ""}
相关法条和司法解释: ${caseData.law || ""}`;

  const systemPrompt = `你是一位法学教授，请根据以下案件资料，为${roleLabels[role]}角色生成9个有针对性的思考题。

要求：
1. 问题必须紧密结合本案的具体材料（人名、证据名称、法律事实等），不能是泛泛的通用问题
2. 从${roleFocus[role]}出发设计问题
3. 问题应覆盖案件事实认定、证据分析、法律适用、程序审查等维度
4. 每个问题应有明确的分析指向，帮助学生理解案件关键点
5. 只输出问题列表，每行一个问题，用数字编号，不要输出其他内容

输出格式：
1. 本案中[具体内容]...
2. ...
3. ...
（共9个问题）`;

  try {
    const response = await fetch("/api/llm/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: caseContext },
        ],
        temperature: 0.4,
        caching: true,
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
            }
          } catch {
            /* skip */
          }
        }
      }
    }

    // Parse questions from the response
    const questions = fullText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+[.、)]\s*/.test(line))
      .map((line) => line.replace(/^\d+[.、)]\s*/, "").trim())
      .filter((line) => line.length > 0);

    if (questions.length >= 5) {
      // Return up to 9 questions, renumbered
      return questions.slice(0, 9).map((q, i) => `${i + 1}. ${q}`);
    }

    // If parsing failed, try to extract any meaningful lines
    const fallbackQuestions = fullText
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 10 && !l.startsWith("系统") && !l.startsWith("你"));

    if (fallbackQuestions.length >= 5) {
      return fallbackQuestions.slice(0, 9).map((q, i) => `${i + 1}. ${q}`);
    }

    return getFallbackQuestions(role);
  } catch {
    return getFallbackQuestions(role);
  }
}

function getFallbackQuestions(role: UserRole): string[] {
  if (role === "defender") {
    return [
      "1. 本案的犯罪行为人是谁？",
      "2. 本案中证明犯罪嫌疑人有罪、罪重的证据有哪些？",
      "3. 本案中证明犯罪嫌疑人无罪、罪轻的证据有哪些？",
      "4. 有罪证据能否形成完整的证据链，得出排他性的唯一结论？",
      "5. 本案犯罪嫌疑人先后作过多少次供述？其前后是否一致？不一致的原因是什么？",
      "6. 本案其他证据之间有无矛盾？该矛盾的存在如何解释？",
      "7. 如果犯罪嫌疑人构成犯罪，本案中影响对其量刑的情节有哪些？",
      "8. 本案侦查程序是否符合法律规定？",
      "9. 控方证据有哪些问题？",
    ];
  }
  if (role === "prosecutor") {
    return [
      "1. 本案指控的犯罪事实是否清楚？",
      "2. 本案证据是否确实充分？",
      "3. 本案犯罪构成要件是否齐备？",
      "4. 本案是否有从重处罚的情节？",
      "5. 本案犯罪嫌疑人是否认罪认罚？",
      "6. 本案量刑建议的依据是什么？",
      "7. 本案证据收集程序是否合法？",
      "8. 本案是否需要补充侦查？",
      "9. 本案适用的法律条文是否准确？",
    ];
  }
  return [
    "1. 案件是否属于本院管辖？",
    "2. 起诉书指控的犯罪事实是否明确？",
    "3. 起诉书指控的证据是否充分？",
    "4. 起诉书适用的法律条文是否准确？",
    "5. 本案是否有不追究刑事责任的情形？",
    "6. 本案侦查、起诉程序是否合法？",
    "7. 本案的争议焦点是什么？",
    "8. 本案需要重点调查哪些问题？",
    "9. 本案可能影响定罪量刑的情节有哪些？",
  ];
}

/**
 * 审判长起诉审查页面的动态问题生成
 * 根据案件资料生成10项审查问题
 */
export async function generateReviewQuestions(
  caseData: CaseData,
): Promise<string[]> {
  const caseContext = `案件名称: ${caseData.name || ""}
案件基本介绍: ${caseData.profile || ""}
案件基本资料: ${caseData.case || ""}
诉讼文书卷: ${caseData.plead || ""}
相关法条和司法解释: ${caseData.law || ""}`;

  const systemPrompt = `你是一位刑事诉讼法专家。请根据以下案件资料，为审判长生成10项起诉审查问题。

要求：
1. 问题必须结合本案的具体材料，针对起诉书内容、证据目录、程序文书等进行审查
2. 涵盖管辖权、被告人身份、犯罪事实、证据、强制措施、诉讼文书、附带民事诉讼等审查要点
3. 每个问题应明确指向起诉书中需要审查的具体内容
4. 只输出问题列表，每行一个问题，用数字编号

输出格式：
1. 案件是否属于本院管辖？
2. ...
（共10个问题）`;

  try {
    const response = await fetch("/api/llm/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: caseContext },
        ],
        temperature: 0.4,
        caching: true,
      }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    while (true) {
      const { done, value } = await reader!.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
            }
          } catch {
            /* skip */
          }
        }
      }
    }

    const questions = fullText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^\d+[.、)]\s*/.test(line))
      .map((line) => line.replace(/^\d+[.、)]\s*/, "").trim())
      .filter((line) => line.length > 0);

    if (questions.length >= 5) {
      return questions.slice(0, 10).map((q, i) => `${i + 1}. ${q}`);
    }

    return getFallbackReviewQuestions();
  } catch {
    return getFallbackReviewQuestions();
  }
}

function getFallbackReviewQuestions(): string[] {
  return [
    "1. 案件是否属于本院管辖？",
    "2. 起诉书指控的被告人的身份，实施犯罪的时间、地点、手段，犯罪事实、危害后果、罪名，以及其他可能影响定罪量刑的情节等是否明确？",
    "3. 起诉书是否载明被告人被采取强制措施的种类、羁押地点，是否在案以及是否扣押、冻结在案被告人的财物及财物存放地点，是否列明被害人的姓名、住址、通信地址？",
    "4. 是否附有起诉前收集的证据目录？",
    "5. 是否附有能够证明指控犯罪行为性质、情节等内容的主要证据复印件或者照片？",
    "6. 是否附有起诉前提供了证言的证人名单，证人名单是否列明出庭作证和拟不出庭作证的证人的姓名、性别、年龄、职业、住址和通信地址？",
    "7. 已委托辩护人、代理人的，是否附有辩护人、代理人的姓名、住址等？",
    "8. 提起附带民事诉讼的，是否附有相关证据材料？",
    "9. 侦查、起诉程序的各种法律手续和诉讼文书复印件是否完备？",
    "10. 有无《刑事诉讼法》第16条第2~6项规定的不追究刑事责任的情形？",
  ];
}
