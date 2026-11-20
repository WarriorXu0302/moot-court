// 密码哈希 / 会话签名 / 限流 的行为校验（不访问网络与数据库）
import { hashPassword, verifyPassword, isHashedPassword } from '../src/lib/password';
import { isThrottled, recordFailure, clearFailures } from '../src/lib/login-throttle';

let bad = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `\n   got: ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`);
  if (!ok) bad++;
};

async function main() {
  // —— 密码 ——
  const h1 = await hashPassword('abc123');
  const h2 = await hashPassword('abc123');
  eq('哈希带前缀', isHashedPassword(h1), true);
  eq('同密码两次哈希不同(随机盐)', h1 !== h2, true);
  eq('哈希不含明文', h1.includes('abc123'), false);
  eq('正确密码通过', (await verifyPassword(h1, 'abc123')).ok, true);
  eq('错误密码拒绝', (await verifyPassword(h1, 'abc124')).ok, false);
  eq('空密码拒绝', (await verifyPassword(h1, '')).ok, false);
  eq('哈希行不触发升级', (await verifyPassword(h1, 'abc123')).needsUpgrade, false);

  const legacy = await verifyPassword('plain-pass', 'plain-pass');
  eq('遗留明文：正确→通过且需升级', legacy, { ok: true, needsUpgrade: true });
  const legacyBad = await verifyPassword('plain-pass', 'plain-pasX');
  eq('遗留明文：错误→拒绝且不升级', legacyBad, { ok: false, needsUpgrade: false });
  eq('遗留明文：长度不同→拒绝', (await verifyPassword('plain-pass', 'plain')).ok, false);
  // 篡改哈希
  eq('损坏的哈希行→拒绝而不抛错', (await verifyPassword('scrypt$zz', 'x')).ok, false);
  eq('哈希被截断→拒绝', (await verifyPassword(h1.slice(0, -4), 'abc123')).ok, false);

  // 以 "guest" 作为明文行：游客密码是字面量 guest，登录接口靠 is_guest 拒绝；这里确认原语本身会放行，提醒靠接口层拦
  eq('原语层：guest 明文能通过(靠接口层 is_guest 拦截)', (await verifyPassword('guest', 'guest')).ok, true);

  // —— 限流 ——
  const k = 'test:k1';
  clearFailures(k);
  eq('初始不限流', isThrottled(k), false);
  for (let i = 0; i < 7; i++) recordFailure(k);
  eq('7 次失败仍未限流', isThrottled(k), false);
  recordFailure(k);
  eq('第 8 次失败后限流', isThrottled(k), true);
  clearFailures(k);
  eq('成功后清零', isThrottled(k), false);

  // —— 会话 ——（用环境变量提供签名密钥）
  process.env.AUTH_SECRET = 'unit-test-secret-0123456789abcdef0123456789';
  const { NextResponse } = await import('next/server');
  const sess = await import('../src/lib/session');
  const res = sess.setSessionCookie(NextResponse.json({}), 'stu-1', 'student');
  const cookie = res.cookies.get(sess.SESSION_COOKIE);
  eq('签发了 Cookie', !!cookie?.value, true);
  const store = (v: string | undefined) => ({ get: (n: string) => (n === sess.SESSION_COOKIE && v ? { value: v } : undefined) });
  const ok = sess.readSessionFromCookieStore(store(cookie?.value));
  eq('签名正确可读回', [ok?.sid, ok?.role], ['stu-1', 'student']);

  // 篡改：把 student 改成 teacher（保留原签名）
  const [body, sig] = (cookie?.value ?? '').split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
  forged.role = 'teacher';
  const forgedToken = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
  eq('篡改角色→拒绝', sess.readSessionFromCookieStore(store(forgedToken)), null);
  eq('篡改签名→拒绝', sess.readSessionFromCookieStore(store(`${body}.${sig.slice(0, -2)}AA`)), null);
  eq('无签名→拒绝', sess.readSessionFromCookieStore(store(body)), null);
  eq('空值→拒绝', sess.readSessionFromCookieStore(store(undefined)), null);
  eq('乱码→拒绝', sess.readSessionFromCookieStore(store('not.a.token')), null);

  // 过期
  const expired = { sid: 's', role: 'student', exp: Math.floor(Date.now() / 1000) - 10 };
  const eb = Buffer.from(JSON.stringify(expired)).toString('base64url');
  const { createHmac } = await import('crypto');
  const esig = createHmac('sha256', process.env.AUTH_SECRET!).update(eb).digest('base64url');
  eq('过期→拒绝', sess.readSessionFromCookieStore(store(`${eb}.${esig}`)), null);

  // 换密钥后旧 Cookie 失效
  process.env.AUTH_SECRET = 'another-secret-another-secret-another-secret-12';
  eq('密钥更换后旧会话失效', sess.readSessionFromCookieStore(store(cookie?.value)), null);

  const cleared = sess.clearSessionCookie(NextResponse.json({}));
  eq('退出清 Cookie(maxAge=0)', cleared.cookies.get(sess.SESSION_COOKIE)?.maxAge, 0);

  console.log(bad ? `\n${bad} 项失败` : '\n全部通过');
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error('ERR', e); process.exit(2); });
