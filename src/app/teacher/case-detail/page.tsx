'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

import { useAppStore } from '@/lib/store';
import type { CaseData, CaseHighlights } from '@/lib/types';
import { parseHighlights, toggleHighlight, HIGHLIGHT_PRESETS, ROLE_HIGHLIGHT_LABELS, FIELD_LABELS, extractPresetSentences, sectionLabelToField, type PresetCategory } from '@/lib/highlights';
import { Plus, Trash2, Upload, Loader2, ChevronUp, ChevronDown, Highlighter, ClipboardList } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkCjkFriendly from 'remark-cjk-friendly';
import { CaseFileViewer } from '@/components/case-file-viewer';

import { CaseReviewPanel } from '@/components/case-review-panel';
import { PageHeader } from '@/components/page-header';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';

const WORKFLOW_DOCUMENTS_ID = '7656793461539356723';

function parseJsonArray(jsonStr: string | undefined): { title: string; book: string }[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}
function parseStringArray(jsonStr: string | undefined): string[] {
  if (!jsonStr) return [];
  try { const arr = JSON.parse(jsonStr); return Array.isArray(arr) ? arr : []; } catch { return []; }
}

function CaseDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const caseId = searchParams.get('id');
  const { user, hydrated } = useAppStore();

  const [data, setData] = useState<CaseData | null>(null);
  const [originalData, setOriginalData] = useState<CaseData | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  // 发布前确认 + 失败提示：原来点"发布"直接生效，失败时 catch 吞掉，老师完全不知道结果
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlights, setHighlights] = useState<CaseHighlights>({});
  const [highlightEditingField, setHighlightEditingField] = useState<string | null>(null);

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
    fetchCase();
  }, [user, hydrated, router, caseId]);

  const fetchCase = async () => {
    if (!caseId) return;
    try {
      const res = await fetch(`/api/cases?id=${caseId}`);
      const result = await res.json();
      if (result.case) {
        setData(result.case);
        setOriginalData(result.case);
        setHighlights(parseHighlights(result.case.highlights));

        // If legal docs are pending (generate_execute_id set but indictment empty),
        // trigger server-side recovery check and resume client polling
        if (result.case.generateExecuteId && !result.case.indictment) {
          checkPendingLegalDocs(caseId, result.case.generateExecuteId);
        }
      } else {
        setError('案例未找到');
      }
    } catch {
      setError('加载失败');
    } finally {
      setLoading(false);
    }
  };

  const checkPendingLegalDocs = (caseId: string, executeId: string) => {
    // Call server-side recovery endpoint
    fetch('/api/cases/check-pending', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).then(() => {
      // Refresh case data to see if docs were recovered
      fetch(`/api/cases?id=${caseId}`).then(r => r.json()).then(result => {
        if (result.case?.indictment) {
          setData(result.case);
          setOriginalData(result.case);
        }
      }).catch(() => {});
    }).catch(() => {});

    // Also start client-side polling for faster feedback
    const poll = async () => {
      try {
        const histRes = await fetch(`/api/workflow/history?executeId=${executeId}&workflowId=${WORKFLOW_DOCUMENTS_ID}`);
        const histResult = await histRes.json();
        if (histResult.status === 'completed' && histResult.data) {
          let docs = histResult.data.Output || histResult.data.output || histResult.data;
          if (typeof docs === 'string') { try { docs = JSON.parse(docs); } catch { /* keep as string */ } }
          await fetch('/api/cases', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'update_documents',
              caseId,
              documents: {
                indictment: docs.indictment || '',
                prosecution: docs.prosecution || '',
                defense: docs.defense || '',
                victim: docs.victim || '',
                plan: docs.plan || '',
                person: docs.person || '',
              },
            }),
          });
          // Refresh case data
          const refetch = await fetch(`/api/cases?id=${caseId}`);
          const refetchResult = await refetch.json();
          if (refetchResult.case) {
            setData(refetchResult.case);
            setOriginalData(refetchResult.case);
          }
        } else if (histResult.status !== 'failed') {
          setTimeout(poll, 30000);
        }
      } catch {
        setTimeout(poll, 30000);
      }
    };
    setTimeout(poll, 30000);
  };

  const serializeAll = (d: CaseData): CaseData => ({
    ...d,
    plead: typeof d.plead === 'string' ? d.plead : JSON.stringify(parseJsonArray(d.plead)),
    record: typeof d.record === 'string' ? d.record : JSON.stringify(parseJsonArray(d.record)),
    evidence: typeof d.evidence === 'string' ? d.evidence : JSON.stringify(parseJsonArray(d.evidence)),
    law: typeof d.law === 'string' ? d.law : JSON.stringify(parseStringArray(d.law)),
  });

  const handleSave = async () => {
    if (!data || !caseId) return;
    setSaving(true);
    try {
      const serialized = serializeAll(data);
      const res = await fetch('/api/cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...serialized, id: caseId, highlights: JSON.stringify(highlights) }),
      });
      if (!res.ok) {
        setActionError(res.status === 401 ? '保存失败：登录已过期，请重新登录后再保存。' : `保存失败（${res.status}），修改仍在页面上，请重试。`);
        setSaving(false);
        return;
      }
      setOriginalData(serialized);
      setEditing(false);
      setActionError(null);
    } catch {
      setActionError('保存失败：网络异常，修改仍在页面上，请重试保存。');
    }
    setSaving(false);
  };

  const handleUndo = () => {
    if (originalData) setData(originalData);
    setEditing(false);
  };

  const handlePublish = async () => {
    if (!data || !caseId) return;
    setPublishing(true);
    setActionError(null);
    try {
      // Save first
      const serialized = serializeAll(data);
      await fetch('/api/cases', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...serialized, id: caseId }),
      });

      // Execute publish logic
      // 首次发布才触发法律文书工作流。仲裁案例跳过：该工作流是刑事专用（起诉书/辩护词/公诉意见书/庭审提纲），
      // 会用刑事内容覆盖仲裁案例的 indictment/defense/prosecution/person 等列；
      // 仲裁案例的申请书、答辩状已在案例生成时写入文书卷（plead），学生端撰写时再评价。
      const isFirstPublish = (data.status === 'generated' || data.status === 'offline') && data.caseType !== 'arbitration';

      const res = await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'publish',
          caseData: serialized,
          caseId,
        }),
      });
      const result = await res.json();
      if (result.success) {
        if (isFirstPublish) {
          // Trigger documents workflow
          try {
            const wfRes = await fetch('/api/workflow/run', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                workflowId: WORKFLOW_DOCUMENTS_ID,
                parameters: {
                  name: serialized.name || '',
                  case: serialized.case || '',
                  plead: serialized.plead,
                  record: serialized.record,
                  evidence: serialized.evidence,
                  law: serialized.law,
                },
                isAsync: true,
              }),
            });
            const wfData = await wfRes.json();
            const executeId = wfData?.data?.execute_id || wfData?.execute_id;
            if (executeId) {
              // Save generate_execute_id to DB so it can be recovered after refresh
              await fetch('/api/cases', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: caseId, generateExecuteId: executeId }),
              });
              // Start polling
              const poll = async () => {
                try {
                  const histRes = await fetch(`/api/workflow/history?executeId=${executeId}&workflowId=7656793461539356723`);
                  const histResult = await histRes.json();
                  if (histResult.status === 'completed' && histResult.data) {
                    let docs = histResult.data.Output || histResult.data.output || histResult.data;
                    if (typeof docs === 'string') { try { docs = JSON.parse(docs); } catch { /* keep as string */ } }
                    await fetch('/api/cases', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'update_documents',
                        caseId,
                        documents: {
                          indictment: docs.indictment || '',
                          prosecution: docs.prosecution || '',
                          defense: docs.defense || '',
                          victim: docs.victim || '',
                          plan: docs.plan || '',
                          person: docs.person || '',
                        },
                      }),
                    });
                  } else if (histResult.status !== 'failed') {
                    setTimeout(poll, 30000);
                  }
                } catch {
                  setTimeout(poll, 30000);
                }
              };
              setTimeout(poll, 30000);
            }
          } catch { /* workflow trigger error */ }
        }
        setData({ ...serialized, status: 'published' });
        setOriginalData({ ...serialized, status: 'published' });
        setEditing(false);
        setActionError(null);
      } else {
        setActionError(`发布失败：${typeof result.error === 'string' ? result.error : '服务器未返回原因'}。请稍后重试。`);
      }
    } catch {
      setActionError('发布失败：网络异常，请检查网络后重试。');
    }
    setPublishing(false);
  };

  const updatePlead = (items: { title: string; book: string }[]) => setData(prev => prev ? { ...prev, plead: JSON.stringify(items) } : prev);
  const updateRecord = (items: { title: string; book: string }[]) => setData(prev => prev ? { ...prev, record: JSON.stringify(items) } : prev);
  const updateEvidence = (items: { title: string; book: string }[]) => setData(prev => prev ? { ...prev, evidence: JSON.stringify(items) } : prev);
  const updateLaw = (items: string[]) => setData(prev => prev ? { ...prev, law: JSON.stringify(items) } : prev);

  if (loading) {
    // 骨架屏：与正式布局同形，避免"一片空白 + 一个圈"让人以为页面卡死
    return (
      <div className="h-screen bg-background flex flex-col overflow-hidden" aria-busy="true" aria-label="正在加载案例">
        <div className="border-b bg-card h-14 shrink-0 flex items-center gap-3 px-4">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-5 w-72" />
          <div className="ml-auto flex gap-2">
            <Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-14" /><Skeleton className="h-8 w-24" />
          </div>
        </div>
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-4 p-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-48 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive mb-4">{error || '加载失败'}</p>
          <Button variant="outline" onClick={() => router.push('/teacher')}>返回</Button>
        </div>
      </div>
    );
  }

  const pleadItems = parseJsonArray(data.plead);
  const recordItems = parseJsonArray(data.record);
  const evidenceItems = parseJsonArray(data.evidence);
  const lawList = parseStringArray(data.law);

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <PageHeader
        back="/teacher"
        backLabel="工作台"
        title={data.name || '未命名案例'}
        subtitle={`${data.caseType === 'arbitration' ? '国际商事仲裁' : '刑事案件'} · ${data.status === 'published' ? '已发布' : data.status === 'offline' ? '已下线' : '待审核'}`}
        badge={editing ? <Badge variant="secondary">编辑中</Badge> : undefined}
        actions={
          <>
            {!editing ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/teacher/scoring?caseId=${encodeURIComponent(caseId || '')}`)}
                >
                  <ClipboardList className="h-4 w-4" />
                  评分标准
                </Button>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>编辑</Button>
                <Button size="sm" onClick={() => setConfirmPublish(true)} disabled={publishing || data.status === 'published'}>
                  {publishing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {data.status === 'published' ? '已发布' : '发布给学生'}
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={handleUndo}>撤销</Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  保存
                </Button>
              </>
            )}
          </>
        }
      />

      {actionError && (
        <div role="alert" className="shrink-0 mx-3 mt-3 lg:mx-4 flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{actionError}</span>
          <Button variant="ghost" size="sm" className="h-7" onClick={() => setActionError(null)}>知道了</Button>
        </div>
      )}

      <AlertDialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>把这个案例发布给学生？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>发布后，所有学生都能在案例列表里看到并开始训练。之后仍可修改，或在教师主页下线。</p>
                {(data.meta?.reference?.aiDrafted?.length ?? 0) > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    本案有 {data.meta?.reference?.aiDrafted?.length} 个栏目由 AI 拟制（见页面顶部黄色区域），请确认已核对。
                  </p>
                )}
                {editing && <p>当前未保存的修改会一并保存。</p>}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再检查一下</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmPublish(false); void handlePublish(); }}>确认发布</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 审核信息：出处、哪些栏目是 AI 拟制、标准答案（仅教师可见） */}
      {data.meta?.reference && (
        <div className="shrink-0 px-3 pt-3 lg:px-4 lg:pt-4">
          <CaseReviewPanel reference={data.meta.reference} status={data.status} />
        </div>
      )}

      {/* Three-column content */}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-3 lg:gap-4 p-3 lg:p-4 overflow-y-auto lg:overflow-hidden scroll-thin">
        {/* Left: name, profile, teach */}
        <div className="flex flex-col gap-3 h-full min-h-0 lg:overflow-hidden">
          <div className="shrink-0">
            <label className="text-sm font-semibold">案例名</label>
            {editing ? (
              <Input value={data.name || ''} onChange={(e) => setData({ ...data, name: e.target.value })} className="mt-1" />
            ) : (
              <p className="text-sm mt-1">{data.name || '暂无'}</p>
            )}
          </div>
          <div className="flex flex-col min-h-0 flex-1">
            <label className="text-sm font-semibold shrink-0">案件基本介绍</label>
            {editing ? (
              <Textarea value={data.profile || ''} onChange={(e) => setData({ ...data, profile: e.target.value })} className="mt-1 flex-1 min-h-0 resize-none" />
            ) : (
              <ScrollArea className="flex-1 min-h-[200px] lg:min-h-0 mt-1 border-2 border-border rounded p-3 bg-card/50 shadow-sm">
                <div className="markdown-content text-sm text-foreground leading-relaxed">
                  {data.profile ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{data.profile}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground">暂无</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
          <div className="flex flex-col min-h-0 flex-1">
            <label className="text-sm font-semibold shrink-0">训练价值</label>
            {editing ? (
              <Textarea value={data.teach || ''} onChange={(e) => setData({ ...data, teach: e.target.value })} className="mt-1 flex-1 min-h-0 resize-none" />
            ) : (
              <ScrollArea className="flex-1 min-h-[200px] lg:min-h-0 mt-1 border-2 border-border rounded p-3 bg-card/50 shadow-sm">
                <div className="markdown-content text-sm text-foreground leading-relaxed">
                  {data.teach ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{data.teach}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground">暂无</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        {/* Middle: case + law */}
        <div className="flex flex-col gap-3 h-full min-h-0 lg:overflow-hidden">
          <div className="flex flex-col min-h-0 flex-[55]">
            <label className="text-sm font-semibold shrink-0">案件基本资料</label>
            {editing ? (
              <Textarea value={data.case || ''} onChange={(e) => setData({ ...data, case: e.target.value })} className="mt-1 flex-1 min-h-0 resize-none" />
            ) : (
              <ScrollArea className="flex-1 min-h-[300px] lg:min-h-0 mt-1 border-2 border-border rounded p-3 bg-card/50 shadow-sm">
                <div className="markdown-content text-sm text-foreground leading-relaxed">
                  {data.case ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{data.case}</ReactMarkdown>
                  ) : (
                    <p className="text-muted-foreground">暂无</p>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
          <div className="flex flex-col min-h-0 flex-[45]">
            <label className="text-sm font-semibold shrink-0">相关法条和司法解释</label>
            <ScrollArea className="flex-1 min-h-[200px] lg:min-h-0 mt-1 border-2 border-border rounded p-3 bg-card/50 shadow-sm">
              <div className="space-y-2">
                {lawList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">暂无</p>
                ) : (
                  lawList.map((law, i) => (
                    <div key={i} className="border rounded p-2 bg-muted/30">
                      {editing ? (
                        <div className="flex gap-1">
                          <Textarea
                            value={law}
                            onChange={(e) => {
                              const newList = [...lawList];
                              newList[i] = e.target.value;
                              updateLaw(newList);
                            }}
                            className="text-xs min-h-[60px]"
                          />
                          <div className="flex flex-col gap-1 shrink-0">
                            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === 0}
                              onClick={() => { const n = [...lawList]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; updateLaw(n); }}>
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6" disabled={i === lawList.length - 1}
                              onClick={() => { const n = [...lawList]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; updateLaw(n); }}>
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-6 w-6"
                              onClick={() => updateLaw(lawList.filter((_, idx) => idx !== i))}>
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{law}</ReactMarkdown></div>
                      )}
                    </div>
                  ))
                )}
                {editing && (
                  <Button size="sm" variant="outline" className="w-full text-xs"
                    onClick={() => updateLaw([...lawList, '新增法条'])}>
                    <Plus className="h-3 w-3 mr-1" /> 新增法条
                  </Button>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>

        {/* Right: plead, record, evidence */}
        <div className="flex flex-col h-full min-h-0 lg:overflow-hidden">
          {editing ? (
            <div className="flex flex-col gap-3 h-full min-h-0 overflow-y-auto scroll-thin pr-1">
              <FileSectionViewer label="诉讼文书" items={pleadItems} onChange={updatePlead} editing={editing} />
              <HighlightEditButton field="plead" fieldText={data.plead || ''} highlights={highlights} setHighlights={setHighlights} />
              <FileSectionViewer label="询问笔录" items={recordItems} onChange={updateRecord} editing={editing} />
              <HighlightEditButton field="record" fieldText={data.record || ''} highlights={highlights} setHighlights={setHighlights} />
              <FileSectionViewer label="证据材料" items={evidenceItems} onChange={updateEvidence} editing={editing} />
              <HighlightEditButton field="evidence" fieldText={data.evidence || ''} highlights={highlights} setHighlights={setHighlights} />
            </div>
          ) : (
            <div className="h-full min-h-[400px] lg:min-h-0 border-2 border-border rounded bg-card/50 overflow-hidden shadow-sm">
              <CaseFileViewer
                title="卷宗材料"
                sections={[
                  { label: '诉讼文书', items: pleadItems },
                  { label: '询问笔录', items: recordItems },
                  { label: '证据材料', items: evidenceItems },
                ]}
                showWrongButton
                wrongContent={data.wrong || ''}
                onWrongContentChange={(c) => setData({ ...data, wrong: c })}
                highlightConfig={highlights}
                showHighlightFilter
                onAddHighlight={(sectionLabel, selectedText, role) => {
                  const fieldKey = sectionLabelToField(sectionLabel);
                  if (fieldKey) {
                    setHighlights(toggleHighlight(highlights, role, fieldKey, selectedText));
                  }
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HighlightEditButton({ field, fieldText, highlights, setHighlights }: {
  field: string;
  fieldText: string;
  highlights: CaseHighlights;
  setHighlights: (h: CaseHighlights) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [text, setText] = useState('');
  const fieldLabel = FIELD_LABELS[field] || field;

  // Flatten fieldText (JSON array of {title, book}) into plain text for sentence extraction
  const fullText = React.useMemo(() => {
    if (!fieldText) return '';
    try {
      const parsed = JSON.parse(fieldText);
      if (Array.isArray(parsed)) {
        return parsed.map((item: { book?: string; title?: string }) => `${item.title || ''} ${item.book || ''}`).join('\n');
      }
    } catch {
      // Not JSON, use as-is
    }
    return fieldText;
  }, [fieldText]);

  const addHighlight = (role: string, t: string) => {
    if (!t.trim()) return;
    setHighlights(toggleHighlight(highlights, role, field, t.trim()));
    setText('');
  };

  const removeHl = (role: string, t: string) => {
    setHighlights(toggleHighlight(highlights, role, field, t));
  };

  // Add all sentences from a preset category
  const addCategorySentences = (role: string, sentences: string[]) => {
    let next = highlights;
    for (const s of sentences) {
      // Only add if not already present
      const existing = next[role]?.[field] || [];
      if (!existing.some((h) => h.text === s)) {
        next = toggleHighlight(next, role, field, s);
      }
    }
    setHighlights(next);
  };

  return (
    <div className="border rounded-lg overflow-hidden shrink-0">
      <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30">
        <button
          className="flex items-center gap-1.5 text-xs font-semibold"
          onClick={() => setExpanded(!expanded)}
        >
          <Highlighter className="h-3 w-3 text-primary" />
          {fieldLabel}高亮管理
          <span className="text-muted-foreground">
            ({Object.values(highlights).reduce((sum, roleHl) => sum + (roleHl[field]?.length || 0), 0)}条)
          </span>
        </button>
      </div>
      {expanded && (
        <div className="p-2 space-y-2">
          <p className="text-[10px] text-muted-foreground">高亮以句子为单位，点击分类可自动提取包含相关内容的完整句子</p>
          {Object.entries(ROLE_HIGHLIGHT_LABELS).map(([roleKey, roleLabel]) => {
            const fieldHls = highlights[roleKey]?.[field] || [];
            const roleClass = roleKey === 'defender' ? 'hl-role-defender' : roleKey === 'prosecutor' ? 'hl-role-prosecutor' : 'hl-role-judge';
            const categories = (HIGHLIGHT_PRESETS as Record<string, PresetCategory[]>)[roleKey] || [];
            return (
              <div key={roleKey}>
                <div className="flex items-center gap-1.5 text-xs font-medium mb-1">
                  <span className={`inline-block w-2.5 h-2.5 rounded-sm ${roleClass}`} />
                  {roleLabel}:
                </div>
                {/* Existing highlight sentences */}
                <div className="flex flex-wrap gap-1 mb-1">
                  {fieldHls.map((hl, i) => (
                    <Badge key={i} variant="outline" className="text-xs max-w-full">
                      <span className={`inline-block w-2 h-2 rounded-sm mr-1 shrink-0 ${roleClass}`} />
                      <span className="truncate max-w-[200px]" title={hl.text}>{hl.text}</span>
                      <button onClick={() => removeHl(roleKey, hl.text)} className="ml-1 hover:text-destructive shrink-0">×</button>
                    </Badge>
                  ))}
                  {fieldHls.length === 0 && <span className="text-xs text-muted-foreground">无</span>}
                </div>
                {/* Manual sentence input */}
                <div className="flex gap-1">
                  <input
                    type="text"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { addHighlight(roleKey, text); } }}
                    placeholder="输入要高亮的完整句子..."
                    className="text-xs px-2 py-1 border rounded flex-1 bg-background"
                  />
                  <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={() => addHighlight(roleKey, text)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
                {/* Preset categories — click to extract sentences */}
                <div className="flex flex-wrap gap-1 mt-1">
                  {categories.map((cat) => {
                    const extracted = extractPresetSentences(fullText, roleKey);
                    const catResult = extracted.find(c => c.category === cat.label);
                    const sentenceCount = catResult?.sentences.length || 0;
                    const allAdded = sentenceCount > 0 && catResult!.sentences.every(s => fieldHls.some(h => h.text === s));
                    return (
                      <button
                        key={cat.label}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors ${
                          allAdded
                            ? 'bg-primary/20 text-primary/70 cursor-default'
                            : sentenceCount > 0
                              ? 'bg-primary/10 text-primary hover:bg-primary/20 cursor-pointer'
                              : 'bg-muted/50 text-muted-foreground cursor-not-allowed'
                        }`}
                        onClick={() => {
                          if (catResult && sentenceCount > 0 && !allAdded) {
                            addCategorySentences(roleKey, catResult.sentences);
                          }
                        }}
                        disabled={sentenceCount === 0 || allAdded}
                        title={sentenceCount > 0 ? `找到${sentenceCount}个句子` : '本文本中未匹配到相关内容'}
                      >
                        {allAdded ? '✓' : sentenceCount > 0 ? `+${sentenceCount}` : '—'} {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CaseDetailPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-screen text-muted-foreground">加载中...</div>}>
      <CaseDetailContent />
    </Suspense>
  );
}

function FileSectionViewer({ label, items, onChange, editing }: {
  label: string;
  items: { title: string; book: string }[];
  onChange: (items: { title: string; book: string }[]) => void;
  editing: boolean;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const safeIdx = Math.min(selectedIdx, Math.max(0, items.length - 1));

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <label className="text-sm font-semibold shrink-0">{label}</label>
      <div className="mt-1 border-2 border-border rounded flex flex-col min-h-0 flex-1 bg-card overflow-hidden shadow-sm">
        <div className="flex overflow-x-auto gap-1 px-2 py-1.5 border-b bg-muted/30 scroll-thin shrink-0">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-0.5 shrink-0">
              {editing ? (
                <input
                  value={item.title}
                  onChange={(e) => {
                    const n = [...items];
                    n[i] = { ...n[i], title: e.target.value };
                    onChange(n);
                  }}
                  className={`text-[11px] px-2 py-1 rounded border outline-none whitespace-nowrap ${safeIdx === i ? 'border-primary bg-primary/10' : 'border-transparent bg-muted'}`}
                  onFocus={() => setSelectedIdx(i)}
                />
              ) : (
                <button
                  onClick={() => setSelectedIdx(i)}
                  className={`text-[11px] px-2 py-1 rounded whitespace-nowrap ${safeIdx === i ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                >
                  {item.title}
                </button>
              )}
              {editing && (
                <div className="flex flex-col">
                  <button onClick={() => { if (i > 0) { const n = [...items]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; onChange(n); setSelectedIdx(i - 1); } }}
                    className="text-muted-foreground hover:text-primary" disabled={i === 0}><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => { if (i < items.length - 1) { const n = [...items]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; onChange(n); setSelectedIdx(i + 1); } }}
                    className="text-muted-foreground hover:text-primary" disabled={i === items.length - 1}><ChevronDown className="h-3 w-3" /></button>
                </div>
              )}
              {editing && (
                <button onClick={() => { const n = items.filter((_, idx) => idx !== i); onChange(n); setSelectedIdx(Math.max(0, safeIdx - 1)); }}
                  className="text-destructive hover:text-destructive/80 ml-0.5"><Trash2 className="h-3 w-3" /></button>
              )}
            </div>
          ))}
          {items.length === 0 && <span className="text-xs text-muted-foreground">暂无</span>}
          {editing && (
            <button onClick={() => { const n = [...items, { title: '新条目', book: '' }]; onChange(n); setSelectedIdx(n.length - 1); }}
              className="text-[11px] px-2 py-1 rounded bg-muted hover:bg-muted/80 flex items-center gap-1 shrink-0">
              <Plus className="h-3 w-3" /> 新增
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex-1 min-h-0 overflow-auto p-3">
            <Textarea
              value={items[safeIdx]?.book || ''}
              onChange={(e) => { const n = [...items]; if (n[safeIdx]) { n[safeIdx] = { ...n[safeIdx], book: e.target.value }; onChange(n); } }}
              className="text-xs w-full h-full min-h-0 border-0 p-0 resize-none bg-transparent focus-visible:ring-0"
              placeholder="请输入内容..."
            />
          </div>
        ) : (
          <ScrollArea className="flex-1 min-h-0 p-3">
            <div className="text-xs text-muted-foreground leading-relaxed markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkCjkFriendly]}>{items[safeIdx]?.book || '暂无内容'}</ReactMarkdown>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
