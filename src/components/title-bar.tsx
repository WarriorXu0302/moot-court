'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAppStore } from '@/lib/store';
import type { LearningRecordEntry } from '@/lib/types';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { FileText, ListChecks, ChevronRight, Home, LogOut, GitBranch, Edit3, Save, Menu } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { logoutSession } from '@/lib/session-user';
import { AvatarImage } from '@/components/avatar-image';
import { LawSearchButton } from '@/components/law-search';
import { interruptTts } from '@/lib/audio';
import { stripLifecycleTag } from '@/lib/lifecycle-utils';
import { mergeStageRecords } from '@/lib/learning-log';
import { getRoleLabel, normalizeCaseType, isAdversarial } from '@/lib/case-type';
import { getForumProfile } from '@/lib/forum-profile';
import { TrainingProgress } from '@/components/training-progress';
import { DisplayMenu } from '@/components/page-header';

interface TitleBarProps {
  onSkip?: () => void;
  onContinue?: () => void;
  canContinue?: boolean;
  continueTooltip?: string;
  onEndAnalysis?: () => void;
  pageName: string;
  showHome?: boolean;
  onHome?: () => void;
  showSettings?: boolean;
  isStudent?: boolean;
}

export function TitleBar({
  onSkip,
  onContinue,
  canContinue = false,
  continueTooltip = '',
  onEndAnalysis,
  pageName,
  showHome = false,
  onHome,
  showSettings = true,
  isStudent = false,
}: TitleBarProps) {
  const { learningRecords, stageDialogues, behaviorLog, appendBehavior, selectedRole, selectedCase, documents, setDocument, user, logout, lifecycleVisible, toggleLifecycleVisible, resetSession, setTrainingStartTime } = useAppStore();
  // "已开始学习"：有环节点评、任何一次本人发言（对话里的 user 消息）、或保存过非空文书。
  // 仅浏览案情、展开卷宗、跳过环节不算开始。
  const hasStarted =
    learningRecords.length > 0 ||
    stageDialogues.some((d) => d.conversations.some((m) => m.role === 'user')) ||
    Object.values(documents).some((v) => typeof v === 'string' && v.trim().length > 0);
  const router = useRouter();
  const [showRecords, setShowRecords] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [showWarning, setShowWarning] = useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = useState(false);

  // 学习记录展示 = 已完成环节点评 + 各环节实时对话（同环节取对话更完整者）
  const mergedRecords = useMemo(
    () => mergeStageRecords(learningRecords, stageDialogues),
    [learningRecords, stageDialogues],
  );

  // 角色名随案件类型：仲裁案例显示"申请人代理人"等，而不是刑事的"公诉人"
  const caseType = normalizeCaseType(selectedCase?.caseType);
  const roleLabel = selectedRole ? getRoleLabel(caseType, selectedRole) : '未选择';

  const handleContinue = () => {
    if (!canContinue) {
      setShowWarning(continueTooltip || '当前条件未满足，无法继续');
      setTimeout(() => setShowWarning(null), 3000);
      return;
    }
    // 行为轨迹：完成当前环节并生成AI点评
    appendBehavior(`完成「${pageName}」环节（生成AI点评）`);
    // Gracefully stop any ongoing TTS — the stage is over
    interruptTts();
    onContinue?.();
  };

  // 文书 key 与各写作页 setDocument 的 key 对应：刑事沿用原 key；仲裁页用 claim / answer / award
  const forumDocs = isAdversarial(caseType) ? getForumProfile(caseType).docs : null;
  const docTypes: Record<string, string> = forumDocs
    ? (selectedRole === 'prosecutor' ? { claim: forumDocs.claim.title }
      : selectedRole === 'defender' ? { answer: forumDocs.answer.title }
      : selectedRole === 'judge' ? { award: forumDocs.award.title }
      : {})
    : selectedRole === 'defender'
    ? { defense: '辩护词' }
    : selectedRole === 'prosecutor'
    ? { indictment: '刑事起诉书', prosecution: '公诉意见书' }
    : selectedRole === 'judge'
    ? { plan: '庭审提纲', finalJudge: '刑事判决书' }
    : {};

  return (
    <>
      <div className="sticky top-0 z-40 border-b bg-card">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
          {/* 左区：当前环节是标题（学生最需要知道的），案件与身份是副行 */}
          <div className="min-w-0 flex-1 basis-0">
            <p className="truncate font-display text-[1.05rem] font-semibold leading-tight text-foreground">{pageName}</p>
            <p className="hidden truncate text-xs leading-tight text-muted-foreground sm:block" title={selectedCase?.name}>
              {roleLabel}{selectedCase?.name ? ` · ${selectedCase.name}` : ''}
            </p>
          </div>

          {/* 训练进度：第几步 / 共几步，悬停看完整路线 */}
          {isStudent && selectedRole && <TrainingProgress caseType={caseType} role={selectedRole} />}

          {/* 中区：本页主操作。继续是推进流程的主按钮，跳过是次要动作 */}
          {onSkip && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { interruptTts(); appendBehavior(`跳过「${pageName}」环节`); onSkip(); }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
            >
              <span className="hidden xl:inline">跳过本环节</span>
              <span className="xl:hidden">跳过</span>
            </Button>
          )}
          {onContinue && (
            <Button
              variant={canContinue ? 'default' : 'outline'}
              size="sm"
              onClick={handleContinue}
              className="shrink-0"
            >
              继续
              <ChevronRight className="ml-0.5 h-4 w-4" />
            </Button>
          )}

          {/* 法条检索是高频查阅动作，保持直达 */}
          <LawSearchButton />

          {/* 右区：低频的视图与记录类入口收进一个菜单，避免十几个按钮横排溢出 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" aria-label="更多">
                <Menu className="h-4 w-4" />
                <span className="hidden xl:inline">更多</span>
                {mergedRecords.length > 0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 text-xs leading-5 text-primary">{mergedRecords.length}</span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">本案</DropdownMenuLabel>
              <DropdownMenuItem onClick={toggleLifecycleVisible}>
                <GitBranch className="mr-2 h-4 w-4" />
                案件生命周期
                <span className="ml-auto text-xs text-muted-foreground">{lifecycleVisible ? '已显示' : '已隐藏'}</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowDocs(true)}>
                <FileText className="mr-2 h-4 w-4" />
                我的文书
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setShowRecords(true)}>
                <ListChecks className="mr-2 h-4 w-4" />
                学习记录
                {mergedRecords.length > 0 && <span className="ml-auto text-xs text-muted-foreground">{mergedRecords.length} 条</span>}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <DisplayMenu />

          {/* 尚未开始学习（没发过言、没写文书、没有环节点评）时，允许直接退出、不打分；一旦开始操作就隐藏 */}
          {isStudent && onEndAnalysis && !hasStarted && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                interruptTts();
                resetSession();
                setTrainingStartTime(null);
                router.push('/student/select');
              }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="还没开始学习，直接返回选案页，不生成分析、不保存记录"
            >
              <LogOut className="h-4 w-4" />
              直接退出
            </Button>
          )}

          {/* 结束分析会中止本次训练，属于破坏性动作：保持可见但降为描边，点击先二次确认 */}
          {onEndAnalysis && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmEnd(true)}
              className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              结束分析
            </Button>
          )}

          {/* 头像与账号：首页、退出归到头像菜单，顶栏不再各占一个按钮 */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="ml-1 shrink-0 rounded-full outline-none ring-offset-2 focus-visible:ring-2 focus-visible:ring-ring" aria-label="账号">
                  <AvatarImage src={user.avatar} name={user.nickname} color={user.avatarColor} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="truncate text-sm font-medium">
                  {user.nickname}
                  {user.isGuest && <span className="ml-2 text-xs font-normal text-muted-foreground">游客</span>}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {showHome && onHome && (
                  <DropdownMenuItem onClick={onHome}>
                    <Home className="mr-2 h-4 w-4" />
                    返回首页
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={async () => {
                    // 游客同样持有服务端会话，必须一并清除
                    await logoutSession();
                    logout();
                    router.push('/');
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* 无法继续时的提示：贴在顶栏下方，3 秒后自动消失 */}
        {showWarning && (
          <div role="status" className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
            {showWarning}
          </div>
        )}
      </div>

      {/* 结束分析二次确认：防止误触中止训练 */}
      <AlertDialog open={confirmEnd} onOpenChange={setConfirmEnd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>结束本次训练并生成分析？</AlertDialogTitle>
            <AlertDialogDescription>
              将根据已完成的环节生成训练分析，并保存本次学习记录。保存后会返回案例选择页，未完成的环节不再继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续训练</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmEnd(false);
                interruptTts();
                appendBehavior(`结束分析（结束时所处环节：${pageName}）`);
                onEndAnalysis?.();
              }}
            >
              结束并生成分析
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Learning Records Drawer（各环节点评 + 实时对话记录 + 行为轨迹） */}
      <Sheet open={showRecords} onOpenChange={setShowRecords}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-xl">学习记录</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            {behaviorLog.length > 0 && <BehaviorTimelineCard behaviorLog={behaviorLog} />}
            {mergedRecords.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">{behaviorLog.length > 0 ? '暂无环节学习记录（对话完成后将在此显示）' : '暂无学习记录'}</div>
            ) : (
              <div className="space-y-4">
                {mergedRecords.map((record, idx) => (
                  <LearningRecordCard key={`${record.pageName}-${record.createdAt}-${idx}`} record={record} index={idx} />
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Documents Drawer */}
      <Sheet open={showDocs} onOpenChange={setShowDocs}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-xl">文书</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-4">
            {Object.keys(docTypes).length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                请先选择角色
              </div>
            ) : Object.entries(docTypes).length === 0 || Object.entries(docTypes).every(([, _]) => false) ? (
              <div className="text-center text-muted-foreground py-8">
                {isAdversarial(caseType) ? '请先在对应环节撰写并保存文书后查看' : selectedRole === 'defender' ? '请先撰写辩护词后查看' : selectedRole === 'prosecutor' ? '请先撰写起诉书和公诉意见书后查看' : selectedRole === 'judge' ? '请先撰写庭审提纲后查看' : '暂无文书'}
              </div>
            ) : (
              Object.entries(docTypes).map(([key, label]) => {
                const content = documents[key];
                return (
                  <DocumentCard key={key} docKey={key} label={label} content={content} onSave={(val) => setDocument(key, val)} selectedRole={selectedRole} />
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function LearningRecordCard({ record, index }: { record: LearningRecordEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-lg p-4 bg-card">
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <span className="font-semibold text-primary">第{index + 1}节: {record.pageName}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {new Date(record.createdAt).toLocaleString()}
          </span>
        </div>
        <span className="text-muted-foreground text-sm">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3 text-sm">
          <div>
            <h4 className="font-semibold text-foreground">学习过程概括</h4>
            <p className="text-muted-foreground mt-1">{stripLifecycleTag(record.summary)}</p>
          </div>
          <div>
            <h4 className="font-semibold text-foreground">评价</h4>
            <p className="text-muted-foreground mt-1">{record.evaluation ? stripLifecycleTag(record.evaluation) : '（本环节尚未生成AI点评）'}</p>
          </div>
          <div>
            <h4 className="font-semibold text-foreground">训练建议</h4>
            <p className="text-muted-foreground mt-1">{record.suggestion ? stripLifecycleTag(record.suggestion) : '（暂无）'}</p>
          </div>
          <div>
            <h4 className="font-semibold text-foreground">对话记录</h4>
            <ScrollArea className="h-48 mt-1 border rounded p-2">
              <div className="space-y-2">
                {record.conversations.map((msg) => (
                  <div key={msg.id} className="text-sm">
                    <span className="font-semibold text-primary">
                      {msg.speaker || (msg.role === 'user' ? '学生' : msg.role === 'assistant' ? 'AI' : '旁白')}:
                    </span>{' '}
                    <span className="text-muted-foreground">{stripLifecycleTag(msg.content)}</span>
                  </div>
                ))}
                {record.conversations.length === 0 && (
                  <p className="text-muted-foreground/60 text-sm italic">（本环节暂无对话）</p>
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
      )}
    </div>
  );
}

/** 训练行为轨迹卡片：进入环节、跳过、继续、保存文书、结束分析等用户全部行为 */
function BehaviorTimelineCard({ behaviorLog }: { behaviorLog: { id: string; content: string; timestamp: number }[] }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="border rounded-lg p-4 bg-card mb-4">
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <span className="font-semibold text-primary">训练行为轨迹</span>
          <Badge variant="secondary" className="h-5 px-1.5 text-xs">{behaviorLog.length}项</Badge>
        </div>
        <span className="text-muted-foreground text-sm">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
        <ScrollArea className="h-40 mt-2 border rounded p-2">
          <div className="space-y-1.5">
            {behaviorLog.map((b) => (
              <div key={b.id} className="text-sm flex gap-2">
                <span className="text-xs text-muted-foreground shrink-0 pt-0.5">
                  {new Date(b.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                </span>
                <span className="text-muted-foreground">{b.content}</span>
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function DocumentCard({ docKey, label, content, onSave, selectedRole }: {
  docKey: string;
  label: string;
  content: string | undefined;
  onSave: (val: string) => void;
  selectedRole: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content || '');

  const handleSave = () => {
    onSave(draft);
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(content || '');
    setEditing(false);
  };

  return (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-primary">{label}</h3>
        {content && !editing && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setDraft(content || ''); setEditing(true); }}>
            <Edit3 className="h-3.5 w-3.5 mr-1" />
            修改
          </Button>
        )}
        {editing && (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={handleCancel}>
              取消
            </Button>
            <Button variant="default" size="sm" className="h-7 text-xs" onClick={handleSave}>
              <Save className="h-3.5 w-3.5 mr-1" />
              保存
            </Button>
          </div>
        )}
      </div>
      {content ? (
        editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[300px] text-sm font-mono"
            placeholder="请输入文书内容..."
          />
        ) : (
          <div className="prose prose-sm max-w-none text-sm text-muted-foreground whitespace-pre-wrap">
            {content}
          </div>
        )
      ) : (
        <p className="text-muted-foreground/60 text-sm italic">
          {selectedRole === 'defender' ? '请在辩护词撰写页面完成辩护词' : selectedRole === 'prosecutor' ? '请完成对应文书撰写' : selectedRole === 'judge' ? '请完成庭审提纲撰写' : '暂无内容'}
        </p>
      )}
    </div>
  );
}
