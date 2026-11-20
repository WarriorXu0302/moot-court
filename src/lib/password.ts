import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const PREFIX = 'scrypt';
const KEYLEN = 64;

/** 生成密码哈希，格式 `scrypt$<salt hex>$<hash hex>`，每个密码独立随机盐。 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEYLEN);
  return `${PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export function isHashedPassword(stored: string): boolean {
  return stored.startsWith(`${PREFIX}$`);
}

/** 定长比较，避免长度差异与逐字节耗时泄露信息。 */
function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface PasswordCheck {
  ok: boolean;
  /** 命中的是旧版明文密码，调用方应在登录成功后立刻改存哈希。 */
  needsUpgrade: boolean;
}

/**
 * 校验密码。兼容超星上线前遗留的明文密码行：明文命中算通过，并标记 needsUpgrade。
 * 一律走定长比较；哈希行与明文行耗时接近，不靠响应时间区分账号状态。
 */
export async function verifyPassword(stored: string, input: string): Promise<PasswordCheck> {
  if (isHashedPassword(stored)) {
    const [, saltHex, hashHex] = stored.split('$');
    if (!saltHex || !hashHex) return { ok: false, needsUpgrade: false };
    const derived = await scrypt(input, Buffer.from(saltHex, 'hex'), KEYLEN);
    return { ok: safeEqual(derived, Buffer.from(hashHex, 'hex')), needsUpgrade: false };
  }
  // 明文行：补一次等价的 scrypt 开销再比较，缩小与哈希行的耗时差
  await scrypt(input, Buffer.alloc(16), KEYLEN);
  const ok = safeEqual(Buffer.from(stored, 'utf8'), Buffer.from(input, 'utf8'));
  return { ok, needsUpgrade: ok };
}

/** 登录时对不存在的账号也做一次等价开销，避免通过耗时枚举账号。 */
export async function burnPasswordCheck(input: string): Promise<void> {
  await scrypt(input, Buffer.alloc(16), KEYLEN);
}
