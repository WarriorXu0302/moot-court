// 仲裁案例生成输出解析 + 元数据解析的行为校验（不访问网络与数据库）
import { parseArbitrationCaseOutput } from '../src/lib/arbitration-case-prompt';
import { parseArbitrationMeta, normalizeCaseType, getRoleLabel } from '../src/lib/case-type';
import { parseCaseItems, buildArbitrationFileSections } from '../src/lib/arbitration-case-utils';
import { getArbitrationInitialLifecycle } from '../src/lib/arbitration-study';

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  if (!ok) bad++;
};

// 1. 模型输出被 markdown 代码块与前后杂文字包裹，且数组字段给成真数组
const wrapped = '好的，以下是案例：\n```json\n' + JSON.stringify({
  name: '某某公司诉某某公司买卖合同仲裁案',
  profile: '概要', teach: '教学目标', case: '案情正文',
  plead: [{ title: '仲裁申请书', book: '申请书正文' }],
  record: '[{"title":"证人甲","book":"…"}]',
  evidence: [], law: ['《纽约公约》：核心规则……【待核验】'],
  wrong: '易错点', person: [{ name: '首席仲裁员', set: '中立', message: '', voice: '' }],
}) + '\n```\n希望有帮助';
const parsed = parseArbitrationCaseOutput(wrapped);
eq('解析成功且名称正确', parsed?.name, '某某公司诉某某公司买卖合同仲裁案');
eq('数组字段被序列化为字符串', typeof parsed?.plead, 'string');
eq('字符串形式的数组原样保留', parsed?.record, '[{"title":"证人甲","book":"…"}]');
eq('空数组序列化为 []', parsed?.evidence, '[]');

// 2. 缺名称/缺案情/非 JSON → null
eq('缺 name → null', parseArbitrationCaseOutput('{"case":"x"}'), null);
eq('缺 case → null', parseArbitrationCaseOutput('{"name":"x"}'), null);
eq('非 JSON → null', parseArbitrationCaseOutput('抱歉，我无法完成'), null);
eq('截断 JSON → null', parseArbitrationCaseOutput('{"name":"x","case":"y'), null);

// 3. 元数据：非法 rules 回落 CIETAC，字符串 JSON 可解析，垃圾输入 undefined
eq('非法 rules 回落', parseArbitrationMeta({ rules: 'XXX' })?.rules, 'CIETAC');
eq('字符串 JSON 可解析', parseArbitrationMeta('{"rules":"ICC","seat":"香港"}')?.seat, '香港');
eq('垃圾输入 → undefined', parseArbitrationMeta('不是json'), undefined);
eq('null → undefined', parseArbitrationMeta(null), undefined);
eq('issues 过滤非法项', parseArbitrationMeta({ issues: [{ title: 'a', id: '1', type: 'merits' }, 5, { id: 'x' }] })?.issues.length, 1);

// 4. 案件类型兜底：存量数据（列缺失 → undefined）必须视为刑事
eq('undefined → criminal', normalizeCaseType(undefined), 'criminal');
eq('null → criminal', normalizeCaseType(null), 'criminal');
eq('arbitration 保留', normalizeCaseType('arbitration'), 'arbitration');
eq('未知值 → criminal', normalizeCaseType('civil'), 'criminal');

// 5. 角色展示名
eq('仲裁 judge 展示名', getRoleLabel('arbitration', 'judge'), '首席仲裁员');
eq('刑事 judge 展示名不变', getRoleLabel('criminal', 'judge'), '审判长');
eq('未传类型按刑事', getRoleLabel(undefined, 'prosecutor'), '公诉人');

// 6. 卷宗条目解析：对象 / "标题：正文" 字符串 / 非 JSON 全文
eq('对象条目', parseCaseItems('[{"title":"A","book":"B"}]'), [{ title: 'A', book: 'B' }]);
eq('字符串条目拆标题', parseCaseItems('["纽约公约：核心规则"]'), [{ title: '纽约公约', book: '核心规则' }]);
eq('非 JSON 全文', parseCaseItems('一段纯文本'), [{ title: '全文', book: '一段纯文本' }]);
eq('空值', parseCaseItems(undefined), []);
eq('卷宗分区数', buildArbitrationFileSections({ plead: '[]', record: '[]', evidence: '[]', law: '[]' } as never).length, 4);

// 7. 庭前生命周期：申请人 2 个，被申请人 3 个，首席 5 个；全部 completed
eq('申请人庭前节点数', getArbitrationInitialLifecycle('prosecutor').nodes.length, 2);
eq('被申请人庭前节点数', getArbitrationInitialLifecycle('defender').nodes.length, 3);
eq('首席庭前节点数', getArbitrationInitialLifecycle('judge').nodes.length, 5);
eq('节点均已完成', getArbitrationInitialLifecycle('judge').nodes.every((n) => n.completed), true);
eq('无角色按被申请人', getArbitrationInitialLifecycle(null).nodes.length, 3);

console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
process.exit(bad ? 1 : 0);
