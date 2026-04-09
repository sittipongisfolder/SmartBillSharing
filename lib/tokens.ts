import crypto from 'crypto';

export function generateToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function getInviteTokenSecret(): string {
  const secret = process.env.INVITE_TOKEN_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('Missing INVITE_TOKEN_SECRET (or NEXTAUTH_SECRET fallback)');
  }
  return secret;
}

function signInviteId(inviteId: string): string {
  return crypto
    .createHmac('sha256', getInviteTokenSecret())
    .update(inviteId)
    .digest('hex')
    .slice(0, 32);
}

export function createInvitePublicToken(inviteId: string): string {
  const id = inviteId.trim();
  const sig = signInviteId(id);
  return `${id}.${sig}`;
}

export function getInviteIdFromPublicToken(token: string): string | null {
  const raw = token.trim();
  const dotIndex = raw.indexOf('.');
  if (dotIndex <= 0) return null;

  const inviteId = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (!inviteId || !signature) return null;

  const expected = signInviteId(inviteId);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) return null;

  return crypto.timingSafeEqual(sigBuf, expectedBuf) ? inviteId : null;
}