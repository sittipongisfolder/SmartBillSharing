import { notFound } from 'next/navigation';

export const runtime = 'nodejs';

export default async function GuestBillPage() {
  notFound();
}