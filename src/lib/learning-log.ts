import { useAppStore } from './store';
import type { ChatMessage, LearningRecordEntry } from './types';

/** 行为轨迹在学习记录中的条目名 */
export const BEHAVIOR_RECORD_NAME = '训练行为轨迹';

/** 学习时长格式化（秒 → 「1小时23分」/「12分30秒」/「45秒」） */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}分${s % 60}秒` : `${m}分钟`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}小时${m % 60}分` : `${h}小时`;
}

/** 文书类型中文名（分析文本展示用） */
export const DOC_TYPE_LABELS: Record<string, string> = {
  defense: '辩护词',
  indictment: '刑事起诉书',
  prosecution: '公诉意见书',
  plan: '庭审提纲',
  finalJudge: '刑事判决书',
  judge: '判决书',
};

/**
 * 合并已完成的学习记录与各环节实时对话快照：
 * - 同环节已有点评记录：保留点评，对话取更完整的一份；
 * - 无点评记录的环节（学生中途结束）：以「对话记录」条目补入，确保任何环节的对话都不丢失。
 * 返回按时间排序的完整记录。
 */
export function mergeStageRecords(
  records: LearningRecordEntry[],
  dialogues: { pageName: string; conversations: ChatMessage[]; createdAt: number }[],
): LearningRecordEntry[] {
  const merged: LearningRecordEntry[] = records.map((r) => ({ ...r }));
  for (const d of dialogues) {
    if (d.conversations.length === 0) continue;
    const existing = merged.find((r) => r.pageName === d.pageName);
    if (existing) {
      if (d.conversations.length > existing.conversations.length) {
        existing.conversations = d.conversations;
      }
    } else {
      merged.push({
        pageName: d.pageName,
        conversations: d.conversations,
        summary: `本环节对话记录（共${d.conversations.length}条消息；学生结束训练时本环节未完成AI点评）`,
        evaluation: '',
        suggestion: '',
        createdAt: d.createdAt,
      });
    }
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt);
}

/** 行为轨迹打包为一条学习记录（conversations 即行为列表） */
export function behaviorRecord(behaviorLog: ChatMessage[]): LearningRecordEntry | undefined {
  if (behaviorLog.length === 0) return undefined;
  return {
    pageName: BEHAVIOR_RECORD_NAME,
    conversations: behaviorLog,
    summary: `训练全程行为轨迹（共${behaviorLog.length}项：进入环节、跳过、继续、保存文书、结束分析等）`,
    evaluation: '',
    suggestion: '',
    createdAt: behaviorLog[0]?.timestamp ?? Date.now(),
  };
}

/** 收集当前训练的全部学习数据：已完成记录 + 实时对话 + 行为轨迹 + 已保存文书 */
export function collectLearningData(): {
  records: LearningRecordEntry[];
  documents: Record<string, string>;
} {
  const s = useAppStore.getState();
  const records = mergeStageRecords(s.learningRecords, s.stageDialogues);
  const behavior = behaviorRecord(s.behaviorLog);
  if (behavior) records.push(behavior);
  return { records, documents: s.documents };
}

/** 供 endTraining 保存使用的完整记录集（同 collectLearningData 的记录部分） */
export function collectRecordsForSave(): LearningRecordEntry[] {
  return collectLearningData().records;
}

/** 截断单条消息用于分析文本 */
function clip(text: string, max = 400): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}……（后略）` : t;
}

/** 每个环节对话保留首尾若干条，中间省略（防止上下文爆炸） */
function clipConversations(conversations: ChatMessage[], head = 6, tail = 16): ChatMessage[] {
  if (conversations.length <= head + tail + 1) return conversations;
  return [...conversations.slice(0, head), ...conversations.slice(-tail)];
}

/**
 * 将全部学习记录（遍历各环节：点评、对话、行为轨迹）+ 已保存文书
 * 汇总为结束分析用的分析文本。
 */
export function formatRecordsForAnalysis(
  records: LearningRecordEntry[],
  documents: Record<string, string>,
): string {
  const parts: string[] = [];

  const stageRecords = records.filter((r) => r.pageName !== BEHAVIOR_RECORD_NAME);
  const behavior = records.find((r) => r.pageName === BEHAVIOR_RECORD_NAME);

  if (stageRecords.length > 0) {
    parts.push('【各环节学习记录（按时间顺序，遍历全部环节）】');
    for (const r of stageRecords) {
      parts.push(`\n◆ 环节：${r.pageName}`);
      if (r.summary && !r.summary.startsWith('本环节对话记录')) parts.push(`  概括：${clip(r.summary, 300)}`);
      if (r.evaluation) parts.push(`  评价：${clip(r.evaluation, 300)}`);
      if (typeof r.score === 'number') parts.push(`  得分：${r.score}`);
      if (r.verdictEvaluation) parts.push(`  判决书评价：${clip(r.verdictEvaluation.content, 200)}`);
      if (r.conversations.length > 0) {
        parts.push(`  对话记录（共${r.conversations.length}条，摘录）：`);
        for (const m of clipConversations(r.conversations)) {
          parts.push(`    [${m.speaker || (m.role === 'user' ? '学生' : m.role === 'assistant' ? 'AI' : '旁白')}]: ${clip(m.content, 300)}`);
        }
      }
    }
  } else {
    parts.push('（尚无已完成环节的学习记录）');
  }

  const docEntries = Object.entries(documents).filter(([, v]) => v && v.trim());
  if (docEntries.length > 0) {
    parts.push('\n【学生已撰写的法律文书】');
    for (const [key, content] of docEntries) {
      parts.push(`\n◆ ${DOC_TYPE_LABELS[key] || key}（${content.length}字，正文摘录）：\n${content.slice(0, 1200)}${content.length > 1200 ? '……（后略）' : ''}`);
    }
  }

  if (behavior && behavior.conversations.length > 0) {
    parts.push(`\n【训练行为轨迹（共${behavior.conversations.length}项，按时间顺序）】`);
    for (const b of behavior.conversations) {
      parts.push(`  ${new Date(b.timestamp).toLocaleTimeString('zh-CN', { hour12: false })} ${b.content}`);
    }
  }

  return parts.join('\n');
}
