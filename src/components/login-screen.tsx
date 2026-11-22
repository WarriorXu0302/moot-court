'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAppStore } from '@/lib/store';
import { fetchSessionUser, logoutSession, toStoreUser, type SessionUserPayload } from '@/lib/session-user';
import { GraduationCap, UserCog, UserX, Loader2, LogOut } from 'lucide-react';

/** 服务端读到的登录态，仅用于首页展示"已登录"分支。 */
export interface ActiveSession {
  nickname: string;
  studentId: string;
  role: 'student' | 'teacher';
}

interface LoginScreenProps {
  session: ActiveSession | null;
}

type Mode = 'login' | 'register';

export default function LoginScreen({ session }: LoginScreenProps) {
  const router = useRouter();
  const { login, logout } = useAppStore();

  const [mode, setMode] = useState<Mode>('login');
  const [studentId, setStudentId] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [nickname, setNickname] = useState('');
  const [formError, setFormError] = useState('');
  const [formPending, setFormPending] = useState(false);

  const [sessionPending, setSessionPending] = useState(false);

  const [guestPending, setGuestPending] = useState(false);
  const [guestError, setGuestError] = useState('');

  const [teacherPassword, setTeacherPassword] = useState('');
  const [teacherError, setTeacherError] = useState('');
  const [teacherPending, setTeacherPending] = useState(false);

  // 已有会话时把 zustand store 补齐，用户点"进入"就不必再登录一次。
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchSessionUser().then((user) => {
      if (!cancelled && user) login(user);
    });
    return () => {
      cancelled = true;
    };
  }, [session, login]);

  const handleEnter = () => {
    setSessionPending(true);
    router.push(session?.role === 'teacher' ? '/teacher?from=home' : '/student/select');
  };

  const handleLogoutSession = async () => {
    setSessionPending(true);
    await logoutSession();
    logout();
    router.refresh();
    setSessionPending(false);
  };

  const handleSubmit = async () => {
    setFormError('');
    if (!studentId.trim() || !password) {
      setFormError('请输入学号和密码');
      return;
    }
    // 注册时两次输入必须一致：密码框是掩码，输错一个字母就再也登录不上
    if (mode === 'register' && password !== password2) {
      setFormError('两次输入的密码不一致');
      return;
    }
    setFormPending(true);
    try {
      const response = await fetch(mode === 'login' ? '/api/auth/login' : '/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentId.trim(), password, nickname: nickname.trim() }),
      });
      const data: { user?: SessionUserPayload; error?: string } = await response.json();
      if (!response.ok || !data.user) {
        setFormError(data.error || (mode === 'login' ? '登录失败，请重试' : '注册失败，请重试'));
        return;
      }
      login(toStoreUser(data.user));
      router.push('/student/select');
    } catch {
      setFormError('网络错误，请重试');
    } finally {
      setFormPending(false);
    }
  };

  const handleGuest = async () => {
    setGuestError('');
    setGuestPending(true);
    try {
      const response = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'guest' }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        setGuestError(data.error || '游客访问失败，请重试');
        return;
      }
      login({
        id: data.student.id,
        studentId: data.student.student_id,
        nickname: data.student.nickname || '游客',
        avatar: '',
        avatarColor: data.student.avatar_color || '#94a3b8',
        role: 'student',
        isGuest: true,
        fid: '',
      });
      router.push('/student/select');
    } catch {
      setGuestError('网络错误，请重试');
    } finally {
      setGuestPending(false);
    }
  };

  /** 教师端：服务端校验密码并直接签发教师会话，不再有第二道门。 */
  const handleTeacherLogin = async () => {
    setTeacherError('');
    setTeacherPending(true);
    try {
      const response = await fetch('/api/auth/teacher/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: teacherPassword }),
      });
      const data: { ok?: boolean; next?: string; error?: string } = await response.json();
      if (!response.ok || !data.ok) {
        setTeacherError(data.error || '验证失败，请重试');
        return;
      }
      const user = await fetchSessionUser();
      if (!user) {
        setTeacherError('登录状态建立失败，请重试');
        return;
      }
      login(user);
      router.push(data.next || '/teacher?from=home');
    } catch {
      setTeacherError('网络错误，请重试');
    } finally {
      setTeacherPending(false);
    }
  };

  const anyPending = sessionPending || formPending || guestPending;

  return (
    <div className="min-h-screen flex flex-col lg:flex-row">
      {/* 左：卷宗封面式构图。竖排衬线标题 + 朱砂印章是唯一的强调，下面是真实的训练路线，不再堆叠金边、角饰与摆动天平 */}
      <div className="relative flex min-h-[340px] flex-col justify-between overflow-hidden bg-[#1C2830] px-8 py-10 text-[#E9EEF0] lg:min-h-screen lg:w-[46%] lg:px-14 lg:py-14">
        <p className="text-sm text-[#9FB2BC]">国际私法 · 国际民事诉讼与仲裁 · 实训课程</p>

        <div className="flex items-start gap-8 lg:gap-12">
          <h1
            className="font-display text-[2.6rem] font-semibold leading-[1.15] tracking-[0.18em] text-[#F4F6F7] lg:text-[3.4rem]"
            style={{ writingMode: 'vertical-rl' }}
          >
            国际法实训
          </h1>
          <div className="pt-1">
            {/* 朱砂印：方形、略微倾斜，像盖在卷宗封面上的章 */}
            <div
              className="grid h-[88px] w-[88px] -rotate-3 grid-cols-2 place-items-center rounded-[4px] border-[3px] border-[#C0443C] p-1.5 font-display text-[1.45rem] font-semibold leading-none text-[#C0443C] lg:h-[104px] lg:w-[104px] lg:text-[1.7rem]"
              aria-hidden
            >
              <span>实</span><span>模</span><span>训</span><span>拟</span>
            </div>
            <p className="mt-6 max-w-[17rem] text-[0.95rem] leading-relaxed text-[#C9D5DB]">
              以《中国国际私法经典案例评析》中的真实裁判为卷宗，在涉外民商事诉讼或国际商事仲裁中扮演当事人代理人、审判长或首席仲裁员，走完从研读案情到裁判的完整程序。
            </p>
          </div>
        </div>

        <ol className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-white/10 pt-5 text-sm text-[#9FB2BC] sm:grid-cols-4">
          {['研读案情', '撰写文书', '开庭审理', '裁判与复盘'].map((step, i) => (
            <li key={step} className="flex items-baseline gap-2">
              <span className="font-display text-base text-[#E9EEF0] tabular-nums">{i + 1}</span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      {/* Right: Login */}
      <div className="relative flex flex-1 items-center justify-center bg-background p-6 lg:p-12">
        <Card className="relative w-full max-w-[400px] overflow-hidden border-0 bg-transparent py-0 shadow-none">
          <CardHeader className="px-0">
            <CardTitle className="font-display text-2xl font-semibold">
              {session ? '欢迎回来' : mode === 'login' ? '登录' : '注册账号'}
            </CardTitle>
            <CardDescription>
              {session ? '你已登录，可直接进入。' : mode === 'login' ? '用学号和密码登录，继续你的实训。' : '用学号注册，之后用同一学号登录。'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6 px-0">
            <div className="space-y-3">
              {session ? (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium truncate">已登录：{session.nickname}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {session.role === 'teacher' ? '教师' : session.studentId}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleLogoutSession}
                      disabled={sessionPending}
                      className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      {sessionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                      退出
                    </button>
                  </div>
                  <Button className="w-full" onClick={handleEnter} disabled={anyPending}>
                    {sessionPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在进入...</>
                    ) : (
                      <><GraduationCap className="h-4 w-4 mr-2" />{session.role === 'teacher' ? '进入教师端' : '进入实训'}</>
                    )}
                  </Button>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="student-id" className="text-sm text-muted-foreground">学号</Label>
                    <Input
                      id="student-id"
                      autoComplete="username"
                      placeholder="请输入学号"
                      value={studentId}
                      onChange={(e) => { setStudentId(e.target.value); setFormError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                  </div>
                  {mode === 'register' && (
                    <div className="space-y-2">
                      <Label htmlFor="nickname" className="text-sm text-muted-foreground">姓名 / 昵称（选填）</Label>
                      <Input
                        id="nickname"
                        autoComplete="name"
                        placeholder="用于在教师端显示"
                        maxLength={30}
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="student-pwd" className="text-sm text-muted-foreground">
                      密码{mode === 'register' && '（6-72 位）'}
                    </Label>
                    <Input
                      id="student-pwd"
                      type="password"
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      placeholder="请输入密码"
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setFormError(''); }}
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                  </div>
                  {mode === 'register' && (
                    <div className="space-y-2">
                      <Label htmlFor="student-pwd2" className="text-sm text-muted-foreground">确认密码</Label>
                      <Input
                        id="student-pwd2"
                        type="password"
                        autoComplete="new-password"
                        placeholder="请再次输入密码"
                        value={password2}
                        onChange={(e) => { setPassword2(e.target.value); setFormError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                        aria-invalid={!!password2 && password2 !== password}
                      />
                      {password2 && password2 !== password && <p className="text-xs text-destructive">两次输入的密码不一致</p>}
                    </div>
                  )}
                  {formError && <p className="text-xs text-destructive">{formError}</p>}
                  <Button className="w-full" onClick={handleSubmit} disabled={anyPending || !studentId.trim() || !password || (mode === 'register' && password2 !== password)}>
                    {formPending ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{mode === 'login' ? '正在登录...' : '正在注册...'}</>
                    ) : (
                      <><GraduationCap className="h-4 w-4 mr-2" />{mode === 'login' ? '学生登录' : '注册并进入'}</>
                    )}
                  </Button>
                  <div className="flex items-center justify-between text-sm">
                    <button
                      type="button"
                      onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setFormError(''); setPassword2(''); }}
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {mode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
                    </button>
                    <button
                      type="button"
                      onClick={handleGuest}
                      disabled={anyPending}
                      className="inline-flex items-center gap-1.5 text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                    >
                      {guestPending ? (
                        <><Loader2 className="h-3.5 w-3.5 animate-spin" />正在进入...</>
                      ) : (
                        <><UserX className="h-3.5 w-3.5" />游客访问</>
                      )}
                    </button>
                  </div>
                  {guestError && <p className="text-xs text-destructive">{guestError}</p>}
                </>
              )}
            </div>

            {/* 教师端入口：仅教师密码，低频入口放学生动线之后 */}
            {session?.role !== 'teacher' && (
              <div className="pt-4 border-t space-y-2">
                <Label htmlFor="teacher-pwd" className="text-sm text-muted-foreground">教师端入口</Label>
                <Input
                  id="teacher-pwd"
                  type="password"
                  autoComplete="off"
                  placeholder="请输入教师密码"
                  value={teacherPassword}
                  onChange={(e) => { setTeacherPassword(e.target.value); setTeacherError(''); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleTeacherLogin()}
                />
                <Button variant="outline" className="w-full" onClick={handleTeacherLogin} disabled={teacherPending || !teacherPassword}>
                  {teacherPending ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />正在验证...</>
                  ) : (
                    <><UserCog className="h-4 w-4 mr-2" />教师端登录</>
                  )}
                </Button>
                {teacherError && <p className="text-xs text-destructive">{teacherError}</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
