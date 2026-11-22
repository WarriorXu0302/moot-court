// ===== Core Types =====

export type UserRole = 'judge' | 'prosecutor' | 'defender';
export type ThemeName = 'light-gray' | 'warm' | 'forest' | 'navy' | 'rice';
export type FontName = 'yahei' | 'heiti' | 'songti';
export type FontSize = 'small' | 'medium' | 'large' | 'xlarge';
export type CaseStatus = 'generating' | 'generated' | 'published' | 'offline';

export type AppRole = 'student' | 'teacher';

export interface User {
  id: string;
  studentId: string;
  nickname: string;
  avatar: string;
  avatarColor: string;
  role: AppRole;
  isGuest: boolean;
  fid: string;
  createdAt: string;
}

export interface CaseDocItem {
  title: string;
  book: string;
}

export interface HighlightEntry {
  text: string;
  color: string;
}

export type RoleHighlights = Record<string, HighlightEntry[]>;

export type CaseHighlights = Record<string, RoleHighlights>;

export interface PersonData {
  name: string;
  voice: string;
  set: string;
  message: string;
}

export interface CaseData {
  id: string;
  /** 案件类型，缺省视为刑事（存量数据兼容） */
  caseType?: import('./case-type').CaseType;
  /** 仲裁案例元数据（规则/仲裁地/准据法/争议焦点），见 src/lib/case-type.ts */
  meta?: import('./case-type').ArbitrationMeta;
  name: string;
  profile: string;
  teach: string;
  case: string;
  plead: string;
  record: string;
  evidence: string;
  law: string;
  indictment?: string;
  prosecution?: string;
  defense?: string;
  victim?: string;
  plan?: string;
  person?: string;
  judge?: string;
  /** 评分标准 JSON（总标准+各环节标准，存储于 DB judge 列，见 src/lib/scoring.ts） */
  scoringStandards?: string;
  wrong?: string;
  highlights?: string;
  creatorName?: string;
  status: CaseStatus;
  createdAt: string;
  updatedAt: string;
  workflowExecutionId?: string;
  generateExecuteId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'narrator';
  content: string;
  speaker?: string;
  timestamp: number;
  audioUrl?: string;
}

export interface LifecycleNode {
  stage: string;
  legalActions: string;
  documents: string;
  legalBasis: string;
  /** 是否已完成（已到达的阶段）。已完成才在时间轴上显示 */
  completed?: boolean;
}

export interface CaseLifecycle {
  nodes: LifecycleNode[];
}

export interface LearningRecordEntry {
  pageName: string;
  summary: string;
  evaluation: string;
  suggestion: string;
  score?: number;
  /** 判决书AI评价（审判长评议环节提交判决书后生成） */
  verdictEvaluation?: { content: string; score: number | null };
  conversations: ChatMessage[];
  createdAt: number;
}

export interface LearningRecord {
  caseId: string;
  roleName: UserRole;
  records: LearningRecordEntry[];
}

// 单次学习场次（从选择案例进入训练到结束分析为一次学习）
export interface LearningSession {
  id: string;
  studentId: string;
  studentName: string;
  fid?: string;
  orgName?: string;
  caseId: string;
  caseName: string;
  role: string;
  startedAt: number;        // 毫秒时间戳
  endedAt: number;
  durationSeconds: number;  // 本次学习时长（秒）
  progress: number;
  lastStage: string;
  score: number | null;
  summary: string;
  evaluation: string;
  /** 当次全部学习记录（环节对话/点评/行为轨迹/分析报告），即学生端学习记录面板可见内容 */
  records: LearningRecordEntry[];
  /** 当次完成的文书 */
  documents?: Record<string, string>;
  createdAt?: string;
}

/**
 * 环节实时对话快照（训练进行中持续采集，用于学习记录展示与结束分析遍历）。
 * 与 LearningRecordEntry 的 pageName 对齐，便于合并去重。
 */
export interface StageDialogueEntry {
  pageName: string;
  conversations: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface StudentPerformance {
  id: string;
  studentId: string;
  studentName: string;
  caseId: string;
  caseName: string;
  roleName: UserRole;
  overallScore: number;
  summary: string;
  evaluation: string;
  suggestion: string;
  lastTrainingTime: string;
  lastStage: string;
  progress: number;
  learningRecords: LearningRecordEntry[];
}

// ===== Annotation Types =====

export interface Annotation {
  id: string;
  itemKey: string;
  selectedText: string;
  note: string;
  /** mark = 「标记文字」黄色底色（案件基本资料），按出现次序定位，同一词多处出现时只标选中的那一处 */
  type: 'underline' | 'note' | 'mark';
  /** mark 专用：selectedText 在该条目中第几次出现（从 0 起） */
  occurrence?: number;
  createdAt: number;
}

// API request/response types
export interface LLMStreamRequest {
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  model?: string;
  temperature?: number;
  caching?: boolean;
  previousResponseId?: string;
}

export interface TTSRequest {
  text: string;
  speaker?: string;
  uid: string;
}

export interface WorkflowRunRequest {
  workflowId: string;
  parameters: Record<string, unknown>;
  isAsync?: boolean;
}

export interface WorkflowHistoryRequest {
  workflowId: string;
  executeId: string;
}

// Helper: parse JSON string fields safely
export function parseJsonField<T>(field: string | undefined | null): T | null {
  if (!field) return null;
  try {
    return JSON.parse(field) as T;
  } catch {
    return null;
  }
}

export function stringifyField(data: unknown): string {
  return JSON.stringify(data);
}

// Parse CaseDocItem array from JSON string
export function parseDocItems(jsonStr: string | undefined): CaseDocItem[] {
  const parsed = parseJsonField<CaseDocItem[]>(jsonStr);
  return parsed ?? [];
}

// Parse law array from JSON string
export function parseLawItems(jsonStr: string | undefined): string[] {
  const parsed = parseJsonField<string[]>(jsonStr);
  return parsed ?? [];
}

// Parse person data array from JSON string
export function parsePersonData(jsonStr: string | undefined): PersonData[] {
  const parsed = parseJsonField<PersonData[]>(jsonStr);
  return parsed ?? [];
}
