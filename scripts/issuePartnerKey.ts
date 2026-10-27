/**
 * `npm run partner:key`: makes a new partner API key for a consuming system (Kazi Connect).
 *
 *   npm run partner:key            # a new random key, and the line to store
 *   npm run partner:key -- --hash shk_...   # the hash of a key you already have
 *
 * The key is printed once, here, and is not saved anywhere. Give it to the partner over a secure
 * channel. Sherehe stores only its SHA-256: add that to PARTNER_KEYS in Render's settings (comma
 * separated if there are several). Never put the key itself in git, in .env, or in a chat.
 */
import { randomBytes } from 'node:crypto';
import { sha256Hex } from '@/lib/auth/hash';

const hashArg = process.argv.indexOf('--hash');

if (hashArg !== -1) {
  const key = process.argv[hashArg + 1];
  if (!key) {
    console.error('Usage: npm run partner:key -- --hash <the key>');
    process.exit(1);
  }
  console.log(sha256Hex(key));
} else {
  const key = `shk_${randomBytes(32).toString('base64url')}`;
  console.log('New partner key. Show it to the partner once and do not store it:\n');
  console.log(`  ${key}\n`);
  console.log('Put this line in Render (Environment, PARTNER_KEYS). It is the key\'s SHA-256, safe to store:\n');
  console.log(`  ${sha256Hex(key)}\n`);
  console.log('The partner sends the key on every call:  X-API-Key: <the key>');
}
