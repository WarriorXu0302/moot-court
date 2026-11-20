'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { stripLifecycleTag } from '@/lib/lifecycle-utils';

import { useAppStore } from '@/lib/store';
import type { CaseData, CaseLifecycle } from '@/lib/types';
import { CaseLifecycleTimeline } from '@/components/case-lifecycle-timeline';

import { Loader2, Users, Send, ChevronUp, ChevronDown, TrendingUp, X, GitBranch } from 'lucide-react';

interface StageRecord {
  pageName: string;
  summary: string;
  evaluation: string;
  suggestion: string;
  verdictEvaluation?: { content: string; score: number | null };
  conversations: Array<{ role: string; content: string; speaker?: string }>;
  createdAt: number;
}

function StageCard({ stage }: { stage: StageRecord }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="px-3 py-2 bg-muted/50 flex items-center justify-between cursor-pointer hover:bg-muted/70 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="font-semibold text-sm">{stage.pageName}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {new Date(stage.createdAt).toLocaleDateString()}
          </span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </div>
      {expanded && (
        <div className="p-3 space-y-3">
          <div>
            <span className="text-xs font-semibold text-primary">学习概括</span>
            <div className="text-sm text-muted-foreground mt-1 markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(stage.summary)}</ReactMarkdown></div>
          </div>
          {stage.conversations && stage.conversations.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-primary">学习内容（对话记录）</span>
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto scroll-thin border rounded p-2 bg-background/50">
                {stage.conversations.map((msg, mi) => (
                  <div key={mi} className={`text-xs ${msg.role === 'user' || msg.role === 'defender' ? 'text-right' : ''}`}>
                    <span className="text-muted-foreground">
                      {msg.speaker ||
                       (msg.role === 'user' || msg.role === 'defender' ? '学生' :
                       msg.role === 'assistant' || msg.role === 'ai' ? 'AI助手' :
                       msg.role === 'narrator' ? '旁白' :
                       msg.role === 'system' ? '系统' : msg.role)}:
                    </span>
                    <div className={`inline-block max-w-[90%] rounded px-2 py-0.5 ml-1 markdown-content ${
                      msg.role === 'user' || msg.role === 'defender' ? 'bg-primary/10' : 'bg-muted'
                    }`}>
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(msg.content)}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {stage.verdictEvaluation?.content && (
            <div>
              <span className="text-xs font-semibold text-primary">
                判决书评价{typeof stage.verdictEvaluation.score === 'number' ? `（${stage.verdictEvaluation.score}分）` : ''}
              </span>
              <div className="text-sm text-muted-foreground mt-1 markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(stage.verdictEvaluation.content)}</ReactMarkdown></div>
            </div>
          )}
          {stage.evaluation && (
            <div>
              <span className="text-xs font-semibold text-primary">评价</span>
              <div className="text-sm text-muted-foreground mt-1 markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stage.evaluation}</ReactMarkdown></div>
            </div>
          )}
          {stage.suggestion && (
            <div>
              <span className="text-xs font-semibold text-primary">训练建议</span>
              <div className="text-sm text-muted-foreground mt-1 markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stage.suggestion}</ReactMarkdown></div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface LearningStatsItem {
  id: string;
  caseName: string;
  studentName: string;
  fid: string;
  orgName: string;
  role: string;
  score: number;
  summary: string;
  evaluation: string;
  suggestion: string;
  lastTrainTime: number;
  lastStage: string;
  progress: number;
  stageRecords: StageRecord[];
  lifecycle: CaseLifecycle | null;
}

type SortField = 'studentName' | 'role' | 'score' | 'lastTrainTime' | 'lastStage' | 'progress';
type SortDir = 'asc' | 'desc';

function LearningDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = searchParams.get('id');
  const { user, hydrated } = useAppStore();

  const [caseData, setCaseData] = useState<CaseData | null>(null);
  const [learningStats, setLearningStats] = useState<LearningStatsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // AI analysis chat
  const [aiMessages, setAiMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiStreaming, setAiStreaming] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<SortField>('lastTrainTime');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Selected student for floating detail
  const [selectedStudent, setSelectedStudent] = useState<LearningStatsItem | null>(null);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user || user.role !== 'teacher') {
      router.push('/');
      return;
    }
    if (!caseId) {
      setError('缺少案例ID');
      setLoading(false);
      return;
    }
    fetchData();
  }, [user, hydrated, router, caseId]);

  const fetchData = async () => {
    if (!caseId) return;
    try {
      const [caseRes, statsRes] = await Promise.all([
        fetch(`/api/cases?id=${caseId}`),
        fetch(`/api/learning-records?case_id=${caseId}`),
      ]);
      const caseResult = await caseRes.json();
      const statsResult = await statsRes.json();

      if (caseResult.case) {
        setCaseData(caseResult.case);
      } else {
        setError('案例未找到');
      }
      if (statsResult.records) {
        setLearningStats(statsResult.records);
      }
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const sendAiMessage = useCallback(async () => {
    if (!aiInput.trim() || aiStreaming) return;
    const userMsg = { role: 'user', content: aiInput.trim() };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiInput('');
    setAiStreaming(true);

    const contextStats = learningStats.map(s => {
      const stages = (s.stageRecords || []).map(sr => {
        // 对话记录摘要（每条消息截断，最多前10条），让AI分析能遍历学生各环节的实际对话表现
        const convDigest = (sr.conversations || [])
          .slice(0, 10)
          .map(m => `[${m.speaker || m.role}] ${String(m.content || '').replace(/\s+/g, ' ').slice(0, 150)}`)
          .join(' / ');
        return `【${sr.pageName}】概括: ${sr.summary}; 评价: ${sr.evaluation}; 建议: ${sr.suggestion}${convDigest ? `; 对话摘要: ${convDigest}` : ''}`;
      }).join('\n');
      return `学生: ${s.studentName}, 角色: ${s.role}, 评分: ${s.score}, 进度: ${s.progress}%\n${stages}`;
    }).join('\n\n');

    try {
      const res = await fetch('/api/llm/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `你是一个学情分析AI助手。请根据学生的训练数据进行学情分析。以下是本训练的全部学情数据:\n${contextStats}` },
            ...aiMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: aiInput.trim() },
          ],
          temperature: 0.5,
          caching: true,
        }),
      });

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      while (true) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullText += parsed.content;
                setAiMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'assistant') {
                    return [...prev.slice(0, -1), { role: 'assistant', content: fullText }];
                  }
                  return [...prev, { role: 'assistant', content: fullText }];
                });
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* error */ }
    setAiStreaming(false);
  }, [aiInput, aiStreaming, aiMessages, learningStats]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortedStats = [...learningStats].sort((a, b) => {
    let cmp = 0;
    if (sortField === 'score' || sortField === 'progress' || sortField === 'lastTrainTime') {
      cmp = (a[sortField] as number) - (b[sortField] as number);
    } else {
      cmp = (a[sortField] as string).localeCompare(b[sortField] as string);
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  if (loading) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !caseData) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error || '加载失败'}</p>
          <Button variant="outline" onClick={() => router.push('/teacher')}>返回</Button>
        </div>
      </div>
    );
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />;
  };

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <PageHeader
        back="/teacher"
        backLabel="工作台"
        title={caseData.name}
        subtitle={`训练学情 · ${learningStats.length} 条记录`}
      />

      {/* Three-column content */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-3 sm:p-4 overflow-y-auto lg:overflow-hidden scroll-thin">
        {/* Left: case info */}
        <div className="space-y-4 lg:overflow-y-auto scroll-thin lg:pr-2">
          <div>
            <h3 className="text-sm font-semibold mb-2">案件基本介绍</h3>
            <div className="border rounded-lg p-3 bg-card">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.profile || '暂无'}</p>
            </div>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-2">训练价值</h3>
            <div className="border rounded-lg p-3 bg-card">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{caseData.teach || '暂无'}</p>
            </div>
          </div>
        </div>

        {/* Middle: AI analysis */}
        <div className="border rounded-lg flex flex-col lg:overflow-hidden min-h-[300px] lg:min-h-0">
          <div className="panel-head px-3 py-2">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              AI学情分析
            </h3>
          </div>
          <div className="flex-1 p-3 min-h-0 overflow-y-auto">
            <div className="space-y-2">
              {aiMessages.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-8">
                  向AI询问本训练的学情分析
                </p>
              ) : (
                aiMessages.map((msg, i) => (
                  <div key={i} className={`text-xs ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <div className={`inline-block max-w-[90%] rounded px-2 py-1 ${
                      msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                    </div>
                  </div>
                ))
              )}
              {aiStreaming && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.2s' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0.4s' }} />
                </div>
              )}
            </div>
          </div>
          <div className="border-t p-2 flex gap-1">
            <Input
              value={aiInput}
              onChange={(e) => setAiInput(e.target.value)}
              placeholder="提问..."
              className="text-xs h-8"
              onKeyDown={(e) => e.key === 'Enter' && sendAiMessage()}
            />
            <Button size="icon" className="h-8 w-8 shrink-0" onClick={sendAiMessage} disabled={aiStreaming}>
              <Send className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Right: student records - list only, click for floating detail */}
        <div className="lg:overflow-y-auto scroll-thin lg:pr-2 lg:min-h-0">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Users className="h-4 w-4" />
            学生表现
          </h3>
          {sortedStats.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">暂无训练记录</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-card z-10">
                <tr className="border-b">
                  <th className="text-left py-1 px-2 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('studentName')}>
                    学生 <SortIcon field="studentName" />
                  </th>
                  <th className="text-left py-1 px-2">单位</th>
                  <th className="text-left py-1 px-2 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('role')}>
                    角色 <SortIcon field="role" />
                  </th>
                  <th className="text-center py-1 px-2 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('score')}>
                    评分 <SortIcon field="score" />
                  </th>
                  <th className="text-center py-1 px-2 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('progress')}>
                    进度 <SortIcon field="progress" />
                  </th>
                  <th className="text-left py-1 px-2 cursor-pointer hover:bg-muted/50" onClick={() => handleSort('lastTrainTime')}>
                    时间 <SortIcon field="lastTrainTime" />
                  </th>
                  <th className="text-center py-1 px-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {sortedStats.map((s) => (
                  <tr key={s.id} className="border-b hover:bg-muted/30">
                    <td className="py-1.5 px-2 font-medium">{s.studentName}</td>
                    <td className="py-1.5 px-2 text-muted-foreground">{s.orgName || '-'}</td>
                    <td className="py-1.5 px-2">
                      <Badge variant="outline" className="text-xs">{s.role === 'defender' ? '辩护人' : s.role === 'prosecutor' ? '公诉人' : s.role}</Badge>
                    </td>
                    <td className="py-1.5 px-2 text-center">{s.score}</td>
                    <td className="py-1.5 px-2 text-center">
                      <div className="flex items-center gap-1">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${s.progress}%` }} />
                        </div>
                        <span className="text-xs">{s.progress}%</span>
                      </div>
                    </td>
                    <td className="py-1.5 px-2 text-muted-foreground">
                      {new Date(s.lastTrainTime).toLocaleDateString()}
                    </td>
                    <td className="py-1.5 px-2 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 px-2 text-xs"
                        onClick={() => setSelectedStudent(s)}
                      >
                        查看
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Floating student detail panel */}
      {selectedStudent && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onClick={() => setSelectedStudent(null)}
        >
          <div
            className="bg-card rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base">{selectedStudent.studentName}</span>
                {selectedStudent.orgName && (
                  <Badge variant="outline" className="text-xs">{selectedStudent.orgName}</Badge>
                )}
                <Badge variant="outline" className="text-xs">{selectedStudent.role === 'defender' ? '辩护人' : selectedStudent.role === 'prosecutor' ? '公诉人' : selectedStudent.role}</Badge>
                <Badge variant="secondary" className="text-xs">评分 {selectedStudent.score}</Badge>
                <Badge variant="outline" className="text-xs">{selectedStudent.progress}%</Badge>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSelectedStudent(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 p-4 overflow-y-auto min-h-0">
              <div className="space-y-4">
                {/* Overall info */}
                <div className="border rounded-lg p-3 bg-muted/30">
                  <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                    <span>案例：{selectedStudent.caseName}</span>
                    <span>{new Date(selectedStudent.lastTrainTime).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${selectedStudent.progress}%` }} />
                    </div>
                    <span className="text-xs font-medium">{selectedStudent.progress}%</span>
                  </div>
                </div>

                {/* Stage records */}
                {selectedStudent.stageRecords && selectedStudent.stageRecords.length > 0 ? (
                  selectedStudent.stageRecords.map((stage, idx) => (
                    <StageCard key={idx} stage={stage} />
                  ))
                ) : (
                  <div className="text-center py-4 text-sm text-muted-foreground">暂无阶段学习记录</div>
                )}

                {/* Case Lifecycle Timeline */}
                {selectedStudent.lifecycle && selectedStudent.lifecycle.nodes && selectedStudent.lifecycle.nodes.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-muted/50 flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-primary" />
                      <span className="font-semibold text-sm">案件生命周期</span>
                    </div>
                    <div className="max-h-96 overflow-y-auto scroll-thin">
                      <CaseLifecycleTimeline lifecycle={selectedStudent.lifecycle} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LearningDetailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-muted-foreground">加载中...</div>}>
      <LearningDetailContent />
    </Suspense>
  );
}
