/**
 * 把 cases 表导出为可重复执行的 SQL（INSERT … ON CONFLICT (id) DO UPDATE），用于在新数据库恢复案例数据。
 *
 * 只导出 cases 表；学生、学习记录、学习场次含个人数据，不导出。
 * 文件头部带 001-case-type 迁移（幂等），保证目标库有 case_type / meta 列。
 *
 * 用法：pnpm exec tsx scripts/export-cases-sql.ts [输出路径] [--types=arbitration,civil] [--no-reference]
 *   --no-reference：剪掉 meta.reference（裁判要旨、法理分析等标准答案），适合放在公开位置
 */
import fs from 'node:fs';
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url).pathname });
import { getSupabaseClient } from '../src/storage/database/supabase-client';

const argv = process.argv.slice(2);
const out = argv.find((a) => !a.startsWith('--')) ?? 'docs/data/cases.sql';
const types = argv.find((a) => a.startsWith('--types='))?.slice(8).split(',').filter(Boolean);
const noReference = argv.includes('--no-reference');

const COLUMNS = [
  'id', 'name', 'profile', 'teach', 'case_info', 'plead', 'record', 'evidence', 'law', 'indictment', 'prosecution',
  'defense', 'victim', 'plan', 'person', 'judge', 'wrong', 'highlights', 'case_type', 'meta', 'creator_name', 'status',
  'workflow_execute_id', 'generate_execute_id', 'created_at', 'updated_at',
] as const;
const JSONB = new Set(['highlights', 'meta']);

/** 标准 SQL 字符串字面量：单引号翻倍。不用 E'' 转义串，反斜杠原样保留 */
function lit(v: unknown, col: string): string {
  if (v === null || v === undefined) return 'NULL';
  if (JSONB.has(col)) return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

async function main() {
  const db = getSupabaseClient();
  let q = db.from('cases').select(COLUMNS.join(',')).order('created_at');
  if (types?.length) q = q.in('case_type', types);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];

  const lines: string[] = [];
  lines.push('-- 案例数据导出（cases 表）。可重复执行：同 id 已存在则覆盖为本文件内容。');
  lines.push(`-- 导出时间：${new Date().toISOString()}　行数：${rows.length}${types ? `　类型：${types.join('/')}` : ''}${noReference ? '　已剪掉 meta.reference' : ''}`);
  lines.push('-- 用法：psql "$DATABASE_URL" -f cases.sql，或粘贴到 Supabase SQL Editor 执行。');
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');
  lines.push('-- 001-case-type 迁移（幂等）');
  lines.push("ALTER TABLE cases ADD COLUMN IF NOT EXISTS case_type varchar(20) NOT NULL DEFAULT 'criminal';");
  lines.push('ALTER TABLE cases ADD COLUMN IF NOT EXISTS meta jsonb;');
  lines.push('CREATE INDEX IF NOT EXISTS cases_case_type_idx ON cases (case_type);');
  lines.push('');
  const update = COLUMNS.filter((c) => c !== 'id').map((c) => `${c} = EXCLUDED.${c}`).join(', ');
  for (const r of rows) {
    if (noReference && r.meta && typeof r.meta === 'object') {
      const { reference: _drop, ...rest } = r.meta as Record<string, unknown>;
      void _drop;
      r.meta = rest;
    }
    lines.push(`-- ${r.case_type} · ${r.status} · ${String(r.name ?? '').replace(/\n/g, ' ')}`);
    lines.push(`INSERT INTO cases (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map((c) => lit(r[c], c)).join(', ')})`);
    lines.push(`ON CONFLICT (id) DO UPDATE SET ${update};`);
    lines.push('');
  }
  lines.push('COMMIT;');
  fs.writeFileSync(out, lines.join('\n') + '\n');
  const byType: Record<string, number> = {};
  for (const r of rows) byType[`${r.case_type}/${r.status}`] = (byType[`${r.case_type}/${r.status}`] ?? 0) + 1;
  console.log(`写入 ${out}：${rows.length} 行`, byType, `${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
