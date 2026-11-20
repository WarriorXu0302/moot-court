import { NextRequest } from 'next/server';

/**
 * 登录失败限流（进程内存）：同一来源 + 账号 10 分钟内最多 8 次失败。
 * 多实例部署时各实例各自计数，只能降低暴力破解速度，不是强保证；
 * 需要强保证时应换成共享存储（Redis / 数据库）。
 */
const WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_MAX = 8;

const failures = new Map<string, { count: number; resetAt: number }>();

export function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip') || 'unknown';
}

function sweep(now: number): void {
  if (failures.size < 500) return;
  for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k);
}

/**
 * 返回 true 表示当前已被限流，应直接拒绝。
 * max 默认 8（登录失败）；教室/机房多人共用一个出口 IP 的场景（如游客入口）应传更大的值。
 */
export function isThrottled(key: string, max: number = DEFAULT_MAX): boolean {
  const now = Date.now();
  const rec = failures.get(key);
  if (!rec) return false;
  if (rec.resetAt <= now) {
    failures.delete(key);
    return false;
  }
  return rec.count >= max;
}

export function recordFailure(key: string): void {
  const now = Date.now();
  sweep(now);
  const rec = failures.get(key);
  if (!rec || rec.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS });
  else rec.count += 1;
}

export function clearFailures(key: string): void {
  failures.delete(key);
}
