import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { setSessionCookie } from '@/lib/session';
import { clearFailures, clientIp, isThrottled, recordFailure } from '@/lib/login-throttle';

export const runtime = 'nodejs';

/** 教师登录后落到的页面（教师页靠 from=home 触发加载动画与数据拉取）。 */
const TEACHER_NEXT_PATH = '/teacher?from=home';

/**
 * 教师密码必须通过环境变量 TEACHER_PASSWORD 配置，不再有默认值。
 * 原先的默认 123 之所以可以接受，是因为后面还有超星登录这第二道门；
 * 去掉超星后这是教师端唯一的门槛，弱默认值等于教师端不设防。
 */
function expectedPassword(): string | null {
  const v = process.env.TEACHER_PASSWORD?.trim();
  return v ? v : null;
}

/** 哈希后再定长比较，避免长度差异泄露密码信息。 */
function passwordMatches(input: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(input), hash(expected));
}

export async function POST(request: NextRequest) {
  const expected = expectedPassword();
  if (!expected) {
    console.error('教师登录不可用：未配置 TEACHER_PASSWORD');
    return NextResponse.json({ error: '教师端未启用：管理员尚未配置教师密码' }, { status: 503 });
  }

  let body: { password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  const password = typeof body.password === 'string' ? body.password : '';

  const key = `teacher:${clientIp(request)}`;
  if (isThrottled(key)) {
    return NextResponse.json({ error: '尝试次数过多，请 10 分钟后再试' }, { status: 429 });
  }

  if (!passwordMatches(password, expected)) {
    recordFailure(key);
    return NextResponse.json({ error: '教师密码错误' }, { status: 401 });
  }
  clearFailures(key);

  // 教师没有 students 行：会话里用固定标识 'teacher'，教师不产生实训记录，不需要外键
  const response = NextResponse.json({ ok: true, next: TEACHER_NEXT_PATH });
  return setSessionCookie(response, 'teacher', 'teacher');
}
