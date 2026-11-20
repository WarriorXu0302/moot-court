import { NextRequest, NextResponse } from 'next/server';
import { burnPasswordCheck, hashPassword, verifyPassword } from '@/lib/password';
import { setSessionCookie } from '@/lib/session';
import { clearFailures, clientIp, isThrottled, recordFailure } from '@/lib/login-throttle';
import { getSupabaseClient } from '@/storage/database/supabase-client';

export const runtime = 'nodejs';

/** 账号不存在与密码错误返回同一句话，不暴露学号是否已注册。 */
const BAD_CREDENTIALS = '学号或密码错误';

export async function POST(request: NextRequest) {
  let body: { studentId?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const studentId = typeof body.studentId === 'string' ? body.studentId.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!studentId || !password) {
    return NextResponse.json({ error: '请输入学号和密码' }, { status: 400 });
  }

  // 限流同时按「来源+账号」和「账号」两个维度，前者防单点爆破，后者防分布式撞同一账号
  const keyByIp = `login:${clientIp(request)}:${studentId.toLowerCase()}`;
  const keyByAccount = `login:acct:${studentId.toLowerCase()}`;
  if (isThrottled(keyByIp) || isThrottled(keyByAccount)) {
    return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429 });
  }

  try {
    const client = getSupabaseClient();
    const { data: student, error } = await client
      .from('students')
      .select('id, student_id, password, nickname, avatar, avatar_color, is_guest')
      .eq('student_id', studentId)
      .maybeSingle();
    if (error) throw error;

    // 游客行与保留命名空间不允许走密码登录
    const loginable = student && !student.is_guest && !/^(guest_|__)/i.test(student.student_id as string);
    if (!loginable) {
      await burnPasswordCheck(password);
      recordFailure(keyByIp);
      recordFailure(keyByAccount);
      return NextResponse.json({ error: BAD_CREDENTIALS }, { status: 401 });
    }

    const check = await verifyPassword(String(student.password ?? ''), password);
    if (!check.ok) {
      recordFailure(keyByIp);
      recordFailure(keyByAccount);
      return NextResponse.json({ error: BAD_CREDENTIALS }, { status: 401 });
    }

    // 旧版明文密码：登录成功顺手改存哈希
    if (check.needsUpgrade) {
      const { error: upgradeError } = await client
        .from('students')
        .update({ password: await hashPassword(password), updated_at: new Date().toISOString() })
        .eq('id', student.id);
      if (upgradeError) console.error('明文密码升级为哈希失败（不影响本次登录）:', upgradeError);
    }

    clearFailures(keyByIp);
    clearFailures(keyByAccount);

    const response = NextResponse.json({
      user: {
        id: student.id,
        studentId: student.student_id,
        nickname: student.nickname || student.student_id,
        avatar: student.avatar || '',
        avatarColor: student.avatar_color || '',
        role: 'student',
      },
    });
    return setSessionCookie(response, student.id as string, 'student');
  } catch (error) {
    console.error('登录失败:', error);
    return NextResponse.json({ error: '登录失败，请稍后重试' }, { status: 500 });
  }
}
