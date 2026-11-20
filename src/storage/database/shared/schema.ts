import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, integer, boolean, jsonb, index } from "drizzle-orm/pg-core";

export const healthCheck = pgTable("health_check", {
  id: integer().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

// Students table - stores student login info and profile
export const students = pgTable(
  "students",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    student_id: varchar("student_id", { length: 50 }).notNull().unique(),
    password: varchar("password", { length: 255 }).notNull(),
    nickname: varchar("nickname", { length: 100 }).notNull().default("未知用户"),
    avatar: varchar("avatar", { length: 500 }),
    avatar_color: varchar("avatar_color", { length: 50 }),
    fid: varchar("fid", { length: 50 }),
    is_guest: boolean("is_guest").default(false).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("students_student_id_idx").on(table.student_id),
  ]
);

// Cases table - stores all case data from workflow
export const cases = pgTable(
  "cases",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    name: varchar("name", { length: 500 }),
    profile: text("profile"),
    teach: text("teach"),
    case_info: text("case_info"),
    plead: text("plead"),
    record: text("record"),
    evidence: text("evidence"),
    law: text("law"),
    indictment: text("indictment"),
    prosecution: text("prosecution"),
    defense: text("defense"),
    victim: text("victim"),
    plan: text("plan"),
    person: text("person"),
    judge: text("judge"),
    wrong: text("wrong"),
    highlights: jsonb("highlights"),
    // 案件类型：'criminal'（默认）| 'arbitration'；迁移见 scripts/migrations/001-case-type.sql
    case_type: varchar("case_type", { length: 20 }).notNull().default("criminal"),
    // 类型专属元数据（仲裁：规则/仲裁地/准据法/争议焦点，见 src/lib/case-type.ts ArbitrationMeta）
    meta: jsonb("meta"),
    creator_name: varchar("creator_name", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("generating"),
    workflow_execute_id: varchar("workflow_execute_id", { length: 100 }),
    generate_execute_id: varchar("generate_execute_id", { length: 100 }),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("cases_status_idx").on(table.status),
    index("cases_created_at_idx").on(table.created_at),
  ]
);

// Training records - stores student training performance
export const trainingRecords = pgTable(
  "training_records",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    student_id: varchar("student_id", { length: 36 }).notNull().references(() => students.id),
    case_id: varchar("case_id", { length: 36 }).notNull().references(() => cases.id, { onDelete: "cascade" }),
    case_name: varchar("case_name", { length: 500 }),
    role: varchar("role", { length: 20 }).notNull(),
    overall_score: integer("overall_score").default(0),
    summary: text("summary"),
    evaluation: text("evaluation"),
    suggestion: text("suggestion"),
    last_stage: varchar("last_stage", { length: 100 }),
    progress: integer("progress").default(0),
    learning_records: jsonb("learning_records"),
    lifecycle: jsonb("lifecycle"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("training_records_student_id_idx").on(table.student_id),
    index("training_records_case_id_idx").on(table.case_id),
    index("training_records_updated_at_idx").on(table.updated_at),
  ]
);

// Case design requests - tracks the design workflow status
export const caseDesignRequests = pgTable(
  "case_design_requests",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    need: text("need").notNull(),
    workflow_id: varchar("workflow_id", { length: 50 }).notNull(),
    execute_id: varchar("execute_id", { length: 100 }),
    status: varchar("status", { length: 20 }).notNull().default("generating"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("case_design_requests_status_idx").on(table.status),
  ]
);
