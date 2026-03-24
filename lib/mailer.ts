import nodemailer from 'nodemailer';
import { getPasswordResetExpiryMinutes } from '@/lib/passwordReset';

type MailOptions = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;

  if (!host || !user || !pass || !from) {
    return null;
  }

  return {
    host,
    port,
    secure,
    from,
    auth: {
      user,
      pass,
    },
  };
}

async function sendMail(options: MailOptions) {
  const smtpConfig = getSmtpConfig();

  if (!smtpConfig) {
    console.warn('SMTP is not configured. Email was not sent.');
    console.info(`Password reset email preview for ${options.to}:\n${options.text}`);
    return { delivered: false };
  }

  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.auth,
  });

  await transporter.sendMail({
    from: smtpConfig.from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  return { delivered: true };
}

export async function sendPasswordResetEmail(args: { to: string; name?: string; resetUrl: string }) {
  const greetingName = args.name?.trim() || 'there';
  const expiryMinutes = getPasswordResetExpiryMinutes();

  const subject = 'Reset your Smart Bill password';
  const text = [
    `Hello ${greetingName},`,
    '',
    'We received a request to reset your Smart Bill password.',
    `Open this link within ${expiryMinutes} minutes:`,
    args.resetUrl,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#1f2937;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;color:#ea580c;">Reset your password</h2>
      <p style="margin:0 0 16px;">Hello ${greetingName},</p>
      <p style="margin:0 0 16px;">We received a request to reset your Smart Bill password.</p>
      <p style="margin:0 0 24px;">Click the button below within ${expiryMinutes} minutes to set a new password.</p>
      <p style="margin:0 0 24px;">
        <a href="${args.resetUrl}" style="display:inline-block;background:#fb8c00;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:700;">Reset Password</a>
      </p>
      <p style="margin:0 0 12px;word-break:break-all;">If the button does not work, open this link:<br />${args.resetUrl}</p>
      <p style="margin:0;">If you did not request this, you can ignore this email.</p>
    </div>
  `;

  return sendMail({ to: args.to, subject, html, text });
}