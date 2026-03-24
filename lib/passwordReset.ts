import crypto from 'crypto';

const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30;

function resolveAppUrl() {
  const baseUrl =
    process.env.NEXTAUTH_URL ??
    process.env.APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    'http://localhost:3000';

  return baseUrl.replace(/\/$/, '');
}

export function validatePassword(password: string) {
  return password.trim().length >= 8;
}

export function createPasswordResetToken() {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS);

  return {
    rawToken,
    hashedToken,
    expiresAt,
  };
}

export function hashPasswordResetToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function buildPasswordResetUrl(token: string) {
  return `${resolveAppUrl()}/reset-password?token=${encodeURIComponent(token)}`;
}

export function getPasswordResetExpiryMinutes() {
  return Math.floor(PASSWORD_RESET_TTL_MS / 60000);
}