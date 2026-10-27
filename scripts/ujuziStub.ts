/**
 * Starts the local stand-in for Ujuzi (the same one the tests use) so you can aim the partner tests
 * or the ring check at it without the real Ujuzi:
 *
 *   npx tsx scripts/ujuziStub.ts            # prints its URL, e.g. http://127.0.0.1:4010
 *   npx tsx scripts/ujuziStub.ts --key=abc  # also demands X-API-Key: abc, like Ujuzi will from Week 9
 *
 *   UJUZI_URL=http://127.0.0.1:4010 PARTNER_TESTS_WRITE=true npm run test:partner
 *
 * It follows the DRAFT contract in partner-tests/ujuzi_openapi.yaml, so passing against it proves
 * the tests and this stub agree with that file, not that the real Ujuzi does.
 */
import { startUjuziStub } from '../__tests__/helpers/ujuziStub';

const key = process.argv.find((a) => a.startsWith('--key='))?.slice('--key='.length);

startUjuziStub({ requireKey: key }).then((stub) => {
  console.log(`Local Ujuzi stand-in listening at ${stub.url}${key ? ' (requires X-API-Key)' : ''}`);
  console.log('Press Ctrl+C to stop.');
});
