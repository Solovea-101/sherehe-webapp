import { createHash } from 'node:crypto';

/** SHA-256 as 64 hex characters. Tokens and partner keys are only ever stored as this. */
export const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');
