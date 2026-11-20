/**
 * LIFECYCLE 泄露修复验证脚本（针对真实源码 lifecycle-utils.ts）
 * 覆盖场景：
 * 1. 标准对象格式 {"nodes":[...]}
 * 2. 数组格式 [...]（量刑协商曾出现的泄露形态）
 * 3. JSON 字符串值内含 { } [ ] 转义引号
 * 4. 闭标签缺失（流式中断）
 * 5. 无标签原文（正常透传）
 * 6. stripLifecycleForStreaming 部分标签（<LIF、<LIFECYC 等）
 * 7. stripLifecycleTag 展示兜底
 */
import {
  parseLifecycleFromAIResponse,
  stripLifecycleForStreaming,
  stripLifecycleTag,
} from '../src/lib/lifecycle-utils';
import { useAppStore } from '../src/lib/store';

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  PASS ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const node1 = { stage: '立案', legalActions: '公安机关于2023年1月11日接到群众报警后立案侦查', documents: '受案登记表、立案决定书', legalBasis: '《刑事诉讼法》第112条', completed: false };
const node2 = { stage: '侦查', legalActions: '讯问犯罪嫌疑人、询问证人、勘验检查', documents: '侦查终结报告、证据卷宗', legalBasis: '《刑事诉讼法》第113条', completed: false };

console.log('\n== 1. 标准对象格式 ==');
{
  const text = `审判长：现在开始法庭调查。首先由公诉人宣读起诉书。\n\n<LIFECYCLE>\n{"nodes":[${JSON.stringify(node1)},${JSON.stringify(node2)}]}\n</LIFECYCLE>`;
  const out = parseLifecycleFromAIResponse(text);
  assert('正文保留', out.includes('现在开始法庭调查'));
  assert('开标签剥离', !out.includes('<LIFECYCLE'));
  assert('JSON不泄露', !out.includes('"stage"') && !out.includes('立案'));
  assert('闭标签剥离', !out.includes('</LIFECYCLE'));
  assert('store写入2节点', useAppStore.getState().lifecycle?.nodes.length === 2);
  assert('节点标记completed', (useAppStore.getState().lifecycle?.nodes ?? []).every(n => n.completed === true));
}

console.log('\n== 2. 数组格式（量刑协商泄露形态）==');
{
  const text = `公诉人：我方认为应当判处有期徒刑三年。\n<LIFECYCLE>[${JSON.stringify(node1)},${JSON.stringify(node2)}]</LIFECYCLE>`;
  const out = parseLifecycleFromAIResponse(text);
  assert('正文保留', out.includes('有期徒刑三年'));
  assert('数组JSON不泄露', !out.includes('"stage"') && !out.includes('受案登记表'));
  assert('数组被解析', useAppStore.getState().lifecycle?.nodes.length === 2);
}

console.log('\n== 3. 字符串值含花括号/方括号/转义引号 ==');
{
  const tricky = { ...node1, legalActions: '讯问记录含特殊符号 {"a":[1,2]} 与 "引号" 和 \\ 反斜杠' };
  const text = `辩护人：请求法庭注意证据瑕疵。\n<LIFECYCLE>{"nodes":[${JSON.stringify(tricky)}]}</LIFECYCLE>`;
  const out = parseLifecycleFromAIResponse(text);
  assert('正文保留', out.includes('证据瑕疵'));
  assert('tricky JSON不泄露', !out.includes('"stage"'));
  assert('tricky 数组解析成功', useAppStore.getState().lifecycle?.nodes.length === 1);
  assert('tricky 内容进store', (useAppStore.getState().lifecycle?.nodes[0]?.legalActions ?? '').includes('特殊符号'));
}

console.log('\n== 4. 闭标签缺失（流式中断）==');
{
  const text = `审判长：请公诉人举证。\n<LIFECYCLE>{"nodes":[${JSON.stringify(node1)}`;
  const out = parseLifecycleFromAIResponse(text);
  assert('正文保留', out.includes('请公诉人举证'));
  assert('截断JSON不泄露', !out.includes('"stage"') && !out.includes('受案登记表'));
  assert('未闭合标签剥离', !out.includes('<LIFECYCLE'));
}

console.log('\n== 5. 无标签原文透传 ==');
{
  const text = `审判长：法庭辩论结束，现在由被告人作最后陈述。`;
  const out = parseLifecycleFromAIResponse(text);
  assert('原文不变', out === text);
}

console.log('\n== 6. 流式部分标签过滤 ==');
{
  assert('完整开标签截断', stripLifecycleForStreaming('发言正文<LIFECYCLE>{"nod') === '发言正文');
  assert('部分标签<LIF', stripLifecycleForStreaming('发言正文<LIF') === '发言正文');
  assert('部分标签<LIFECYC', stripLifecycleForStreaming('发言正文<LIFECYC') === '发言正文');
  assert('单个<不误伤', stripLifecycleForStreaming('5 < 6 的比较') === '5 < 6 的比较');
  assert('正常文本透传', stripLifecycleForStreaming('审判长敲响法槌。') === '审判长敲响法槌。');
  assert('含中文<后正常', stripLifecycleForStreaming('数值应<100，即小于100') === '数值应<100，即小于100');
}

console.log('\n== 7. stripLifecycleTag 展示兜底 ==');
{
  assert('剥离完整标签', stripLifecycleTag('概括内容<LIFECYCLE>{"nodes":[]}</LIFECYCLE') === '概括内容');
  assert('剥离未闭合', stripLifecycleTag('概括<LIFECYCLE>{"nodes"') === '概括');
  assert('空字符串安全', stripLifecycleTag('') === '');
  assert('无标签透传', stripLifecycleTag('普通文本') === '普通文本');
}

console.log(`\n结果: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
