/**
 * 评分标准迁移脚本（幂等，随服务启动执行）
 *
 * 1. 生产环境（COZE_PROJECT_ENV=PROD）：删除过时案例「车超、李勇等强奸、故意杀人、伪证案」
 * 2. 全环境：为 judge 列为空的案例，按 scripts/scoring-seed.json 补加评分标准
 *
 * 数据访问走 Supabase REST（生产/开发运行时均可用的环境变量）。
 * 用法：node scripts/migrate-scoring.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.COZE_SUPABASE_URL || '';
const SERVICE_KEY = process.env.COZE_SUPABASE_SERVICE_ROLE_KEY || '';
const IS_PROD = process.env.COZE_PROJECT_ENV === 'PROD';
const OUTDATED_CASE_ID = 'b29d4d15-5c64-494d-a21e-91944bb3a534'; // 车超、李勇等强奸、故意杀人、伪证案（生产环境删除）
const SEED_PATH = join(__dirname, 'scoring-seed.json');

function headers() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
}

async function main() {
  console.log(`[migrate-scoring] env=${process.env.COZE_PROJECT_ENV || 'DEV'} supabase=${SUPABASE_URL ? 'ok' : 'missing'}`);
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log('[migrate-scoring] 缺少 Supabase 环境变量，跳过迁移');
    return;
  }

  // 生产环境：删除过时案例
  if (IS_PROD) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/cases?id=eq.${OUTDATED_CASE_ID}`, {
      method: 'DELETE',
      headers: headers(),
    });
    console.log(`[migrate-scoring] 删除过时案例(车超案): HTTP ${res.status}`);
  }

  if (!existsSync(SEED_PATH)) {
    console.log('[migrate-scoring] 无种子文件，跳过评分标准补加');
    return;
  }
  const seed = JSON.parse(readFileSync(SEED_PATH, 'utf-8'));

  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/cases?select=id,name,judge,status&order=created_at.desc`, {
    headers: headers(),
  });
  if (!listRes.ok) {
    console.log(`[migrate-scoring] 拉取案例失败: HTTP ${listRes.status}`);
    return;
  }
  const cases = (await listRes.json()) || [];
  console.log(`[migrate-scoring] 案例 ${cases.length} 个，种子 ${Object.keys(seed).length} 条`);

  let patched = 0;
  let skipped = 0;
  for (const row of cases) {
    if (row.judge && String(row.judge).trim()) {
      skipped++; // 已有评分标准
      continue;
    }
    const std = seed[row.id];
    if (!std) {
      console.log(`[migrate-scoring] 无种子（跳过）: ${row.name}`);
      continue;
    }
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/cases?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ judge: JSON.stringify(std), updated_at: new Date().toISOString() }),
    });
    if (patchRes.ok) {
      patched++;
      console.log(`[migrate-scoring] 已补加评分标准: ${row.name}`);
    } else {
      console.log(`[migrate-scoring] 补加失败: ${row.name} HTTP ${patchRes.status}`);
    }
  }
  console.log(`[migrate-scoring] 完成：补加${patched} 已存在${skipped}`);
}

main().catch((e) => {
  console.error('[migrate-scoring] 异常（不阻塞启动）:', e && e.message ? e.message : e);
});
