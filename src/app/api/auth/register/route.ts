import { NextRequest, NextResponse } from 'next/server';
import { hashPassword } from '@/lib/password';
import { setSessionCookie } from '@/lib/session';
import { clientIp, isThrottled, recordFailure } from '@/lib/login-throttle';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

const AVATAR_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F'];

/** 学号：字母数字及 _ - .，3~32 位。长度上限低于库字段 50，给保留前缀留余量。 */
const STUDENT_ID_RE = /^[A-Za-z0-9_.-]{3,32}$/;
/** 保留名：游客行、历史超星行、教师占位行的命名空间，禁止被注册占用。 */
const RESERVED_RE = /^(guest_|cx_|__)/i;

export async function POST(request: NextRequest) {
  let body: { studentId?: unknown; password?: unknown; nickname?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const nickname = typeof body.nickname === 'string' ? body.nickname.trim().slice(0, 30) : '';

  if (!STUDENT_ID_RE.test(studentId)) {
    return NextResponse.json({ error: '学号只能包含字母、数字、下划线、横线和点，长度 3-32 位' }, { status: 400 });
  }
  if (RESERVED_RE.test(studentId)) {
    return NextResponse.json({ error: '该学号不可使用，请换一个' }, { status: 400 });
  }
  if (password.length < 6 || password.length > 72) {
    return NextResponse.json({ error: '密码长度需为 6-72 位' }, { status: 400 });
  }

  // 注册也限流：防止批量建号刷库
  const throttleKey = `reg:${clientIp(request)}`;
  if (isThrottled(throttleKey)) {
    return NextResponse.json({ error: '操作过于频繁，请稍后再试' }, { status: 429 });
  }

  try {
    const client = getSupabaseClient();
    const { data: existing, error: selectError } = await client
      .from('students')
      .select('id')
      .eq('student_id', studentId)
      .maybeSingle();
    if (selectError) throw selectError;
    if (existing) {
      recordFailure(throttleKey);
      return NextResponse.json({ error: '该学号已被注册，请直接登录' }, { status: 409 });
    }

    const { data: created, error: insertError } = await client
      .from('students')
      .insert({
        student_id: studentId,
        password: await hashPassword(password),
        nickname: nickname || studentId,
        avatar: null,
        avatar_color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
        is_guest: false,
      })
      .select('id, student_id, nickname, avatar, avatar_color')
      .single();
    if (insertError) {
      // 并发注册同一学号：唯一约束兜底
      if ((insertError as { code?: string }).code === '23505') {
        return NextResponse.json({ error: '该学号已被注册，请直接登录' }, { status: 409 });
      }
      throw insertError;
    }

    const response = NextResponse.json({
      user: {
        id: created.id,
        studentId: created.student_id,
        nickname: created.nickname,
        avatar: created.avatar || '',
        avatarColor: created.avatar_color || '',
        role: 'student',
      },
    });
    return setSessionCookie(response, created.id as string, 'student');
  } catch (error) {
    console.error('注册失败:', error);
    return NextResponse.json({ error: '注册失败，请稍后重试' }, { status: 500 });
  }
}
