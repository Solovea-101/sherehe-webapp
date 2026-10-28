/**
 * `npm run partner:key`: makes a new partner API key for a consuming system (Kazi Connect).
 *
 *   npm run partner:key -- --name kazi                  # a new random key, and the entry to store
 *   npm run partner:key -- --name kazi --hash shk_...   # the entry for a key you already have
 *
 * The name is the consumer: offers are filed under it, so keep it the same when a key is rotated
 * (list the old and the new key under that one name for a while). The key is printed once, here, and
 * is not saved anywhere. Give it to the partner over a secure channel. Sherehe stores only its
 * SHA-256: add the printed `name:hash` to PARTNER_KEYS in Render's settings (comma separated if there
 * are several). Never put the key itself in git, in .env, or in a chat.
 */
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '@/lib/auth/hash';

const value = (flag: string): string | undefined => {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
};

const name = value('--name')?.trim().toLowerCase();
if (!name || !/^[a-z][a-z0-9_-]{0,31}$/.test(name)) {
  console.error('Usage: npm run partner:key -- --name <consumer> [--hash <a key you already have>]');
  console.error('The name is lower case letters, digits, - or _, starting with a letter (for example: kazi).');
  process.exit(1);
}

const existing = value('--hash');
if (process.argv.includes('--hash') && !existing) {
  console.error('--hash needs the key after it.');
  process.exit(1);
}

if (existing) {
  console.log(`${name}:${sha256Hex(existing)}`);
} else {
  const key = `shk_${randomBytes(32).toString('base64url')}`;
  console.log(`New partner key for "${name}". Show it to the partner once and do not store it:\n`);
  console.log(`  ${key}\n`);
  console.log("Put this in Render (Environment, PARTNER_KEYS), comma separated with any others. It holds the key's SHA-256, safe to store:\n");
  console.log(`  ${name}:${sha256Hex(key)}\n`);
  console.log('The partner sends the key on every call:  X-API-Key: <the key>');
}
