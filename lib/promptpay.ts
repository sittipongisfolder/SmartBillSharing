import { generatePayload } from 'promptpay-qr';

export function normalizePromptPayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length !== 10 || !digits.startsWith('0')) {
    throw new Error('Invalid PromptPay phone number');
  }
  return digits;
}

export function buildPromptPayPayloadByPhone(phone: string, amount?: number): string {
  const id = normalizePromptPayPhone(phone);
  const a = typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : undefined;
  return generatePayload(id, a ? { amount: a } : undefined);
}
