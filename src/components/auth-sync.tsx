'use client';

import { useEffect } from 'react';
import { useAppStore } from '@/lib/store';

/**
 * 登录态对账：页面加载时若本地 store 里有用户，向服务端确认会话仍然有效。
 *
 * 业务 API 现在都要求登录，而 store 的 user 持久在 localStorage 里：
 * 会话过期（7 天）、Cookie 被清、或改造前进来的游客（当时没有服务端会话），
 * 都会出现"前端以为已登录、接口全部 401"。对账发现服务端无会话就清掉本地登录态，
 * 各页面既有的登录守卫随后会把用户送回登录页。
 *
 * 只在挂载时检查一次；网络错误不当作未登录处理（避免断网时被误踢）。
 */
export function AuthSync() {
  useEffect(() => {
    const { user, logout } = useAppStore.getState();
    if (!user) return;
    let cancelled = false;
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 401) logout();
      })
      .catch(() => {
        /* 网络异常：保持现状 */
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return null;
}
