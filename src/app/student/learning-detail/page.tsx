'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { PageHeader } from '@/components/page-header';
import { useRouter, useSearchParams } from 'next/navigation';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { useAppStore } from '@/lib/store';
import { stripLifecycleTag } from '@/lib/lifecycle-utils';
import { Loader2, ChevronUp, ChevronDown, Clock, Award } from 'lucide-react';

interface StageRecord {
  pageName: string;
  summary: string;
  evaluation: string;
  suggestion: string;
  score?: number;
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
          {stage.score !== undefined && stage.score > 0 && (
            <Badge variant={stage.score >= 80 ? 'default' : stage.score >= 60 ? 'secondary' : 'destructive'} className="text-xs">
              {stage.score}分
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            {stage.createdAt ? new Date(stage.createdAt).toLocaleDateString() : ''}
          </span>
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </div>
      {expanded && (
        <div className="p-3 space-y-3">
          {stage.summary && (
            <div>
              <span className="text-xs font-semibold text-primary">学习概括</span>
              <div className="text-sm text-muted-foreground mt-1 markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(stage.summary)}</ReactMarkdown>
              </div>
            </div>
          )}
          {stage.conversations && stage.conversations.length > 0 && (
            <div>
              <span className="text-xs font-semibold text-primary">学习内容（对话记录）</span>
              <div className="mt-1 space-y-1 max-h-48 overflow-y-auto scroll-thin border rounded p-2 bg-background/50">
                {stage.conversations.map((msg, mi) => (
                  <div key={mi} className={`text-xs ${msg.role === 'user' ? 'text-right' : ''}`}>
                    <span className="text-muted-foreground">
                      {msg.speaker || (msg.role === 'user' ? '学生' : msg.role === 'assistant' ? 'AI助手' : msg.role)}:
                    </span>
                    <div className={`inline-block max-w-[90%] rounded px-2 py-0.5 ml-1 markdown-content ${
                      msg.role === 'user' ? 'bg-primary/10' : 'bg-muted'
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
              <div className="text-sm text-muted-foreground mt-1 markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(stage.verdictEvaluation.content)}</ReactMarkdown>
              </div>
            </div>
          )}
          {stage.evaluation && (
            <div>
              <span className="text-xs font-semibold text-primary">评价</span>
              <div className="text-sm text-muted-foreground mt-1 markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(stage.evaluation)}</ReactMarkdown>
              </div>
            </div>
          )}
          {stage.suggestion && (
            <div>
              <span className="text-xs font-semibold text-primary">训练建议</span>
              <div className="text-sm text-muted-foreground mt-1 markdown-content">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{stripLifecycleTag(stage.suggestion)}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LearningDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseName = searchParams.get('caseName');
  const { user, hydrated } = useAppStore();

  const [loading, setLoading] = useState(true);
  const [stageRecords, setStageRecords] = useState<StageRecord[]>([]);
  const [overallScore, setOverallScore] = useState(0);
  const [lastTrainTime, setLastTrainTime] = useState(0);
  const [lastStage, setLastStage] = useState('');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    // 登录态尚未从 localStorage 恢复：此刻 user 恒为 null，不能据此判断未登录
    if (!hydrated) return;
    if (!user) {
      router.push('/');
      return;
    }
    if (!caseName) {
      router.push('/student/select');
      return;
    }
    fetchRecords();
  }, [user, hydrated, caseName, router]);

  const fetchRecords = async () => {
    if (!user?.id) return;
    try {
      const res = await fetch(`/api/learning-records?student_id=${user.id}`);
      const data = await res.json();
      if (data.records) {
        // Filter by case name
        const filtered = data.records.filter((r: { caseName: string }) => r.caseName === caseName);
        if (filtered.length > 0) {
          // Sort by lastTrainTime ascending (oldest first)
          filtered.sort((a: { lastTrainTime: number }, b: { lastTrainTime: number }) => a.lastTrainTime - b.lastTrainTime);
          // Use the latest record's stage records
          const latest = filtered[filtered.length - 1];
          setStageRecords(latest.stageRecords || []);
          setOverallScore(latest.score || 0);
          setLastTrainTime(latest.lastTrainTime || 0);
          setLastStage(latest.lastStage || '');
          setProgress(latest.progress || 0);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      <PageHeader back="/student/select" backLabel="选择案例" title={caseName} subtitle="我的训练记录" />

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="container mx-auto px-3 sm:px-4 py-6 max-w-4xl">
          {/* Summary card */}
          <Card className="mb-4">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Award className="h-5 w-5 text-primary" />
                训练概况
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">得分</div>
                  {overallScore > 0 ? (
                    <Badge variant={overallScore >= 80 ? 'default' : overallScore >= 60 ? 'secondary' : 'destructive'} className="text-base">
                      {overallScore}
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">暂未评分</span>
                  )}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">进度</div>
                  <span className="text-sm font-semibold">{progress}%</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">最后训练阶段</div>
                  <span className="text-sm">{lastStage || '-'}</span>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">最后训练时间</div>
                  <span className="text-sm text-muted-foreground flex items-center">
                    <Clock className="h-3 w-3 inline mr-1" />
                    {lastTrainTime > 0 ? new Date(lastTrainTime).toLocaleString() : '-'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stage records */}
          {stageRecords.length > 0 ? (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground mb-2">训练阶段记录</h3>
              {stageRecords.map((stage, i) => (
                <StageCard key={i} stage={stage} />
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-muted-foreground">暂无训练阶段记录</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LearningDetailPage() {
  return (
    <Suspense fallback={<div className="h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin" /></div>}>
      <LearningDetailContent />
    </Suspense>
  );
}
