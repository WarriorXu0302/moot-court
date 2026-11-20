'use client';

import type { User } from './types';

const AVATAR_COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
];

/** 头像底色只是展示兜底，按学号取模保证同一用户每次登录颜色一致。 */
function avatarColorFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export interface SessionUserPayload {
  id: string;
  studentId: string;
  nickname: string;
  avatar?: string;
  avatarColor?: string;
  role?: string;
  isGuest?: boolean;
}

/** 把服务端返回的用户资料映射成 store 里的 User。 */
export function toStoreUser(u: SessionUserPayload): User {
  return {
    id: u.id,
    studentId: u.studentId,
    nickname: u.nickname || u.studentId || '未知用户',
    avatar: u.avatar || '',
    avatarColor: u.avatarColor || avatarColorFor(u.studentId || u.id),
    role: u.role === 'teacher' ? 'teacher' : 'student',
    isGuest: u.isGuest === true,
    fid: '',
    createdAt: new Date().toISOString(),
  };
}

/**
 * 读取当前登录会话并映射成 store 里的 User。
 * 未登录（401）或网络异常时返回 null，由调用方决定是否跳转登录页。
 */
export async function fetchSessionUser(): Promise<User | null> {
  try {
    const response = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!response.ok) return null;
    const data: { user?: SessionUserPayload } = await response.json();
    if (!data.user?.id) return null;
    return toStoreUser(data.user);
  } catch {
    return null;
  }
}

/** 退出登录；失败也不抛错，调用方随后清本地 store 即可。 */
export async function logoutSession(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    console.error('退出登录失败:', error);
  }
}
