import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseServiceRoleKey } from '@/storage/database/supabase-client';

/**
 * 站内登录会话：一个 HMAC 签名的 httpOnly Cookie，只存 students.id 与角色。
 * 取代原先的 Supabase Auth Session。角色只信 Cookie 里的签名值，客户端改不了。
 */
export const SESSION_COOKIE = 'court_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type SessionRole = 'student' | 'teacher';

export interface SessionPayload {
  /** students.id */
  sid: string;
  role: SessionRole;
  /** 过期时间（秒级时间戳） */
  exp: number;
}

/**
 * 签名密钥：优先 AUTH_SECRET；未配置时由服务端私有的 service role key 派生，
 * 这样不新增必填配置也能工作。该 key 只在服务端存在，派生值不可逆推出原 key。
 */
function getSecret(): string {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit) return explicit;
  const fallback = getSupabaseServiceRoleKey();
  if (!fallback) throw new Error('缺少 AUTH_SECRET，且无法由 service role key 派生会话密钥');
  return createHash('sha256').update(`court-session-v1:${fallback}`).digest('hex');
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('base64url');
}

function encodeToken(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${body}.${sign(body)}`;
}

function decodeToken(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const idx = token.indexOf('.');
  if (idx <= 0) return null;
  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<SessionPayload>;
    if (typeof parsed.sid !== 'string' || !parsed.sid) return null;
    if (parsed.role !== 'student' && parsed.role !== 'teacher') return null;
    if (typeof parsed.exp !== 'number' || parsed.exp * 1000 < Date.now()) return null;
    return { sid: parsed.sid, role: parsed.role, exp: parsed.exp };
  } catch {
    return null;
  }
}

/**
 * 是否给 Cookie 打 Secure。只看运行环境，不看请求域名：
 * 在实际以 http 提供服务的环境里误打 Secure，浏览器会直接丢弃 Cookie，表现为"登录后一刷新就退出"。
 */
function shouldUseSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COZE_PROJECT_ENV === 'PROD';
}

export function readSession(request: NextRequest): SessionPayload | null {
  return decodeToken(request.cookies.get(SESSION_COOKIE)?.value);
}

/** 读取 Server Component 里的 cookies() 返回值（首页判断登录态用）。 */
export function readSessionFromCookieStore(store: { get(name: string): { value: string } | undefined }): SessionPayload | null {
  return decodeToken(store.get(SESSION_COOKIE)?.value);
}

export function setSessionCookie(response: NextResponse, sid: string, role: SessionRole): NextResponse {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  response.cookies.set(SESSION_COOKIE, encodeToken({ sid, role, exp }), {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export function clearSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookie(),
    path: '/',
    maxAge: 0,
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}
