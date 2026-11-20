/**
 * 批量生成案例脚本
 * - 调用工作流 7656623831193223210 (案例设计)
 * - 10个案例并行触发，轮询等待完成
 * - 完成后保存到数据库并自动发布
 *
 * 用法: node scripts/batch-generate-cases.mjs
 */

const COZE_API_BASE = process.env.COZE_API_BASE_URL || 'https://api.coze.cn';
const WORKFLOW_CASE_DESIGN_ID = '7656623831193223210';

const CASES = [
  '缅北"四大家族"系列电诈案：涉及明家、白家、魏家、刘家犯罪集团，武装庇护电诈，针对中国公民实施犯罪，相关案件已陆续宣判。',
  '余华英拐卖儿童案：人贩子余华英长期流窜作案，拐卖17名儿童，社会影响极其恶劣，已被依法判处死刑。',
  '邯郸初中生杀害同学埋尸案：未满十四周岁初中生杀害同学，主犯被依法顶格判处无期徒刑，引发对低龄未成年人犯罪治理的广泛讨论。',
  '李铁案及足球领域系列腐败案：涉及中国国家男子足球队原主教练李铁、中国足球协会原主席陈戌源、国家体育总局原副局长杜兆才等，是近年来体育领域最受关注的反腐案件。',
  '"寻亲男孩刘某州"被网暴致死案：此案推动了网络侮辱、诽谤行为在造成严重后果时可转为公诉案件处理的司法实践，成为反网暴领域的标志性案件。',
  '车某等强奸、故意杀人再审改判无罪案：时间跨度超20年的冤错案件，经最高人民检察院抗诉、最高人民法院直接提审后改判无罪，是继聂树斌案后的又一重大纠错案例。',
  '广州天河"1·11"驾车撞人案：罪犯温庆运驾车冲撞行人，造成严重后果，已被执行死刑，案件引发社会对公共安全的高度关注。',
  '游族网络投毒案：被告人许垚向同事投毒致人死亡，该案因其发生在知名互联网企业且手段特殊，备受舆论关注。',
  '"离婚冷静期杀妻案"：案件发生在离婚冷静期期间，因触及婚姻家庭、女性安全等社会敏感议题，引发广泛讨论。',
  '辽宁盘锦"幼儿园虐童案"：案件涉及幼儿权益保护，引发社会对幼教行业监管和儿童安全问题的强烈关注。',
];

function buildHeaders() {
  const headers = {
    Authorization: `Bearer ${process.env.COZE_WORKLOAD_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
  for (const pair of (process.env.COZE_EXTRA_HEADERS || '').split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) headers[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return headers;
}

function log(msg) {
  const ts = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

async function triggerWorkflow(need) {
  const res = await fetch(`${COZE_API_BASE}/v1/workflow/run`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({
      workflow_id: WORKFLOW_CASE_DESIGN_ID,
      parameters: { need },
      is_async: true,
    }),
  });
  const data = await res.json();
  return data;
}

async function pollWorkflow(executeId, caseName) {
  const maxAttempts = 60; // 60 attempts * 30s = 30min max
  const intervalMs = 30000; // 30 seconds

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(
        `${COZE_API_BASE}/v1/workflows/${WORKFLOW_CASE_DESIGN_ID}/run_histories/${executeId}`,
        { headers: buildHeaders() }
      );
      const result = await res.json();

      if (result.code === 0 && Array.isArray(result.data) && result.data.length > 0) {
        const item = result.data[0];
        const execStatus = item.execute_status || 'Running';

        if (execStatus === 'Success' || execStatus === 'Completed') {
          const rawOutput = item.Output ?? item.output;
          let output = {};
          try {
            if (typeof rawOutput === 'string') {
              output = JSON.parse(rawOutput);
            } else if (rawOutput && typeof rawOutput === 'object') {
              output = rawOutput;
            }
          } catch {
            output = { raw: rawOutput };
          }
          // Handle double-nested Output
          const innerOutput = output.Output ?? output.output;
          if (typeof innerOutput === 'string') {
            try {
              const parsed = JSON.parse(innerOutput);
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                output = parsed;
              }
            } catch {
              // keep original
            }
          }
          return { status: 'completed', data: output, debug: item.debug_url };
        } else if (execStatus === 'Failed' || execStatus === 'Error') {
          return { status: 'failed', error: item.error_msg || '执行失败' };
        }
      }

      // Still running
      if (i % 4 === 0) {
        log(`  [${caseName}] 轮询中... (${i + 1}/${maxAttempts})`);
      }
    } catch (e) {
      log(`  [${caseName}] 轮询出错: ${e.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  return { status: 'timeout', error: '轮询超时' };
}

async function saveCaseToDB(caseData) {
  const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;

  const res = await fetch(`${url}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'save',
      caseData: {
        name: caseData.name || '未命名案例',
        profile: caseData.profile || '',
        teach: caseData.teach || '',
        case: caseData.case || '',
        plead: caseData.plead || '',
        record: caseData.record || '',
        evidence: caseData.evidence || '',
        law: caseData.law || '',
        wrong: caseData.wrong || '',
        creatorName: '李璎霖',
        status: 'generated',
      },
    }),
  });
  const data = await res.json();
  return data;
}

async function publishCase(caseId, caseData) {
  const baseUrl = process.env.COZE_PROJECT_DOMAIN_DEFAULT || `http://localhost:${process.env.DEPLOY_RUN_PORT || 5000}`;
  const url = baseUrl.startsWith('http') ? baseUrl : `https://${baseUrl}`;

  const res = await fetch(`${url}/api/cases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'publish',
      caseData: {
        name: caseData.name || '未命名案例',
        profile: caseData.profile || '',
        teach: caseData.teach || '',
        case: caseData.case || '',
        plead: caseData.plead || '',
        record: caseData.record || '',
        evidence: caseData.evidence || '',
        law: caseData.law || '',
        wrong: caseData.wrong || '',
      },
      caseId,
    }),
  });
  const data = await res.json();
  return data;
}

async function main() {
  log('=== 批量生成案例脚本启动 ===');
  log(`共 ${CASES.length} 个案例待生成`);
  log('');

  // Step 1: Trigger all workflows in parallel
  log('Step 1: 并行触发所有工作流...');
  const triggers = await Promise.allSettled(
    CASES.map(async (need, i) => {
      const shortName = need.split('：')[0].substring(0, 15);
      log(`  [${i + 1}] 触发: ${shortName}...`);
      const result = await triggerWorkflow(need);
      log(`  [${i + 1}] 触发完成: executeId=${result.data?.execute_id || 'N/A'}`);
      return { index: i, need, shortName, result };
    })
  );

  const tasks = [];
  for (const t of triggers) {
    if (t.status === 'fulfilled') {
      const execId = t.value.result?.execute_id || t.value.result?.data?.execute_id;
      if (execId) {
        tasks.push({
          index: t.value.index,
          need: t.value.need,
          shortName: t.value.shortName,
          executeId: execId,
        });
      } else {
        log(`  [${t.value.index + 1}] 触发失败: ${JSON.stringify(t.value.result)}`);
      }
    } else {
      log(`  [${t.reason?.index ?? '?'}] 触发异常: ${t.reason?.message}`);
    }
  }

  log(`\n成功触发 ${tasks.length}/${CASES.length} 个工作流`);
  log('');

  // Step 2: Poll all workflows in parallel
  log('Step 2: 并行轮询工作流结果...');
  log('  (每个案例约需5-10分钟，最长等待30分钟)');
  log('');

  const results = await Promise.allSettled(
    tasks.map(async (task) => {
      log(`  [${task.index + 1}] 开始轮询: ${task.shortName} (executeId=${task.executeId})`);
      const result = await pollWorkflow(task.executeId, task.shortName);

      if (result.status === 'completed' && result.data) {
        log(`  [${task.index + 1}] 工作流完成: ${result.data.name || task.shortName}`);

        // Save to DB
        try {
          const saveResult = await saveCaseToDB(result.data);
          if (saveResult.data) {
            log(`  [${task.index + 1}] 已保存到数据库: id=${saveResult.data.id}`);

            // Auto-publish
            try {
              await publishCase(saveResult.data.id, result.data);
              log(`  [${task.index + 1}] 已发布到学生端: ${result.data.name || task.shortName}`);
            } catch (e) {
              log(`  [${task.index + 1}] 发布失败: ${e.message}`);
            }
          } else {
            log(`  [${task.index + 1}] 保存失败: ${JSON.stringify(saveResult)}`);
          }
        } catch (e) {
          log(`  [${task.index + 1}] 保存异常: ${e.message}`);
        }

        return { index: task.index, status: 'success', name: result.data.name, debug: result.debug };
      } else {
        log(`  [${task.index + 1}] 生成失败: ${result.status} - ${result.error || ''}`);
        return { index: task.index, status: result.status, error: result.error };
      }
    })
  );

  // Summary
  log('\n=== 生成结果汇总 ===');
  let success = 0, failed = 0;
  for (const r of results) {
    if (r.status === 'fulfilled') {
      const v = r.value;
      if (v.status === 'success') {
        log(`  [${v.index + 1}] 成功: ${v.name}`);
        success++;
      } else {
        log(`  [${v.index + 1}] 失败: ${v.status} - ${v.error || ''}`);
        failed++;
      }
    } else {
      log(`  异常: ${r.reason?.message}`);
      failed++;
    }
  }
  log(`\n成功: ${success}, 失败: ${failed}, 总计: ${CASES.length}`);
  log('=== 脚本完成 ===');
}

main().catch(e => {
  log(`致命错误: ${e.message}`);
  process.exit(1);
});
