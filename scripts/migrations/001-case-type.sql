-- 001: cases 表新增案件类型与元数据（国际仲裁场景，见 docs/arbitration-design.md 第4节）
--
-- 幂等，可重复执行。存量案例自动取默认值 'criminal'，行为零变化。
-- 需由有 DDL 权限的账号在 Supabase SQL Editor（或 psql）执行；应用代码在列缺失时仍可正常运行
-- （只有保存仲裁案例才会写入这两列，刑事案例读写不受影响）。

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS case_type varchar(20) NOT NULL DEFAULT 'criminal',
  ADD COLUMN IF NOT EXISTS meta jsonb;

CREATE INDEX IF NOT EXISTS cases_case_type_idx ON cases (case_type);

-- 校验（执行后应返回 0 行非 criminal 的存量数据）
-- SELECT case_type, count(*) FROM cases GROUP BY case_type;
