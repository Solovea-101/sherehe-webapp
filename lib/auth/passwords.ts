import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// scrypt, with the parameters stored beside each hash (scrypt$N$r$p$salt$hash) so they can be
// raised later without locking anyone out. N=2^15, r=8, p=1 takes roughly 80 ms per check.
const N = 32768;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, length: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must cover 128 * N * r bytes; Node's default sits exactly on the limit for N=2^15.
    scrypt(password.normalize('NFKC'), salt, length, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** A salted scrypt hash of the password, safe to store. The password itself is never stored. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, N, R, P, KEY_LENGTH);
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** True when the password matches a hash made by hashPassword. Anything unreadable is a no. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  const sane = [n, r, p].every(Number.isInteger) && n >= 2 && n <= 1 << 20 && r >= 1 && r <= 32 && p >= 1 && p <= 16;
  if (!sane || salt.length === 0 || expected.length === 0) return false;
  try {
    const actual = await derive(password, salt, n, r, p, expected.length);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Spends the same time a real check would. Login runs this when the email is unknown, so the
 * response time does not reveal which emails have accounts.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummyHash);
}
