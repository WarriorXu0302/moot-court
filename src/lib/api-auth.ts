import { NextRequest, NextResponse } from 'next/server';
import { readSession, type SessionPayload } from '@/lib/session';

/**
 * API 路由鉴权。
 *
 * - requireLogin：任何有效会话（学生 / 游客 / 教师）
 * - requireTeacher：仅教师会话
 * - requireStudent：仅学生会话（含游客，游客在服务端也是 role=student 的 students 行）
 *
 * 用法：
 *   const auth = requireTeacher(request);
 *   if (!auth.ok) return auth.response;
 *   const { session } = auth;
 */
export type AuthResult =
  | { ok: true; session: SessionPayload }
  | { ok: false; response: NextResponse };

function deny(status: 401 | 403, error: string): AuthResult {
  const response = NextResponse.json({ error }, { status });
  response.headers.set('Cache-Control', 'private, no-store');
  return { ok: false, response };
}

export function requireLogin(request: NextRequest): AuthResult {
  const session = readSession(request);
  if (!session) return deny(401, '请先登录');
  return { ok: true, session };
}

export function requireTeacher(request: NextRequest): AuthResult {
  const auth = requireLogin(request);
  if (!auth.ok) return auth;
  if (auth.session.role !== 'teacher') return deny(403, '仅教师可操作');
  return auth;
}

export function requireStudent(request: NextRequest): AuthResult {
  const auth = requireLogin(request);
  if (!auth.ok) return auth;
  if (auth.session.role !== 'student') return deny(403, '仅学生可操作');
  return auth;
}

export function forbidden(message = '无权访问该数据'): NextResponse {
  const response = NextResponse.json({ error: message }, { status: 403 });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
