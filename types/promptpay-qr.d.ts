declare module 'promptpay-qr' {
  export type GeneratePayloadOptions = { amount?: number };
  export function generatePayload(promptpayId: string, options?: GeneratePayloadOptions): string;
}
