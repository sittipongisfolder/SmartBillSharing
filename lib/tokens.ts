import crypto from 'crypto';

const PEPPER = process.env.TOKEN_HASH_PEPPER ?? '';

export function generateToken(bytes: number = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(rawToken: string): string {
  if (!PEPPER) throw new Error('Missing TOKEN_HASH_PEPPER');
  return crypto.createHash('sha256').update(rawToken + PEPPER).digest('hex');
}
