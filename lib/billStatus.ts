export type PaymentStatus = 'unpaid' | 'pending' | 'paid';

export function computeBillStatus(
  participants: Array<{ paymentStatus?: PaymentStatus }>
): PaymentStatus {
  if (!participants || participants.length === 0) return 'unpaid';

  const statuses = participants.map((p) => p.paymentStatus ?? 'unpaid');

  if (statuses.every((s) => s === 'paid')) return 'paid';
  if (statuses.some((s) => s === 'pending' || s === 'paid')) return 'pending';
  return 'unpaid';
}
