import { burnPasswordCheck, hashPassword, verifyPassword } from '@/lib/auth/passwords';

describe('hashPassword / verifyPassword', () => {
  it('stores a self-describing scrypt hash, never the password', async () => {
    const hash = await hashPassword('correct horse battery');
    const [scheme, n, r, p, salt, key] = hash.split('$');
    expect([scheme, n, r, p]).toEqual(['scrypt', '32768', '8', '1']);
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(key, 'base64')).toHaveLength(64);
    expect(hash).not.toContain('correct horse');
  });

  it('accepts the right password and refuses a wrong one', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
    expect(await verifyPassword('Correct horse battery', hash)).toBe(false);
  });

  it('salts each hash, so equal passwords give different hashes', async () => {
    const [a, b] = await Promise.all([hashPassword('same password 1'), hashPassword('same password 1')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same password 1', a)).toBe(true);
    expect(await verifyPassword('same password 1', b)).toBe(true);
  });

  it('treats equivalent Unicode spellings of a password as the same', async () => {
    const hash = await hashPassword('café au lait'); // é as one character
    expect(await verifyPassword('café au lait', hash)).toBe(true); // e + combining accent
  });

  it('handles spaces and long passwords exactly as typed', async () => {
    const long = 'x'.repeat(128);
    expect(await verifyPassword(long, await hashPassword(long))).toBe(true);
    const spaced = '  leading and trailing  ';
    const hash = await hashPassword(spaced);
    expect(await verifyPassword(spaced, hash)).toBe(true);
    expect(await verifyPassword(spaced.trim(), hash)).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    ['the seed account placeholder', 'seed-account-cannot-log-in'],
    ['the wrong scheme', 'bcrypt$10$abc$def$ghi$jkl'],
    ['too few parts', 'scrypt$32768$8$1$c2FsdA=='],
    ['non-numeric parameters', 'scrypt$x$8$1$c2FsdA==$a2V5'],
    ['an absurd cost', `scrypt$${2 ** 40}$8$1$c2FsdA==$a2V5`],
    ['an empty salt', 'scrypt$32768$8$1$$a2V5'],
  ])('never matches %s', async (_label, stored) => {
    expect(await verifyPassword('anything at all', stored)).toBe(false);
  });
});

describe('burnPasswordCheck', () => {
  it('does the work of a real check and returns nothing', async () => {
    const started = Date.now();
    await expect(burnPasswordCheck('whatever')).resolves.toBeUndefined();
    expect(Date.now() - started).toBeGreaterThanOrEqual(10); // a real scrypt run, not a shortcut
  });
});
