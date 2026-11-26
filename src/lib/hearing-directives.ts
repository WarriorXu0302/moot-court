/**
 * 庭审发言的"主持权"：只有主持人（审判长 / 首席仲裁员）可以安排程序、点名下一位发言人。
 *
 * 学生反馈（2026-11）：AI 被告代理人发言结尾说"请原告代理人对我方证据发表质证意见""请审判长宣布休庭"，
 * 笔录上看就是当事人在主持庭审，审判长被"架空"。原因是提示词允许"在结尾点名下一位发言人"，对当事人也生效了。
 * 现在：提示词只对主持人开放点名；当事人发言再在落地前剪掉结尾的程序性指令句，作为兜底。
 */

/** 当事人发言结尾的程序性指令句：请×××（陈述/举证/质证/发问/宣布…）、代理意见发表完毕之后的点名等 */
const DIRECTIVE_TAIL = new RegExp(
  [
    // "请原告代理人发表第二轮辩论意见。" "请审判长宣布休庭。" "请审判长向原告代理人发问。"
    '请(?:审判长|首席仲裁员|仲裁庭|合议庭|法庭|本庭|贵庭|原告|被告|申请人|被申请人|对方)[^。！？\\n]{0,40}[。！？]?',
    // "下面请……" "现在请……"
    '(?:下面|现在|接下来)请[^。！？\\n]{0,40}[。！？]?',
  ].join('|'),
);

/**
 * 去掉当事人发言末尾（最后一两句）里替主持人安排程序的句子。
 * 只剪结尾、只剪命中模式的整句，正文中间引用的"请求法院……"等不受影响（"请求"不在模式里：模式要求"请"后紧跟角色名）。
 */
export function stripPartyDirectives(text: string): string {
  let out = text.trimEnd();
  for (let i = 0; i < 2; i++) {
    // 取最后一个句子（以。！？或换行分隔）
    const m = out.match(/([^。！？\n]*[。！？]?)\s*$/);
    if (!m) break;
    const last = m[1];
    // 句子可能是"代理意见发表完毕，请原告代理人发表第二轮辩论意见。"，只剪"请……"那一半
    const idx = last.search(DIRECTIVE_TAIL);
    if (idx < 0) break;
    const kept = last.slice(0, idx).replace(/[，,、\s]+$/, '');
    out = out.slice(0, out.length - m[0].length) + (kept ? `${kept}。` : '');
    out = out.trimEnd();
    if (kept) break;
  }
  return out || text;
}

export function isPresiding(speaker: string): boolean {
  return /审判长|首席仲裁员/.test(speaker);
}
