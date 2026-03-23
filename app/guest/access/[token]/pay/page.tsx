import { notFound } from 'next/navigation';
import { createHash } from 'crypto';

import { connectMongoDB } from '@/lib/mongodb';
import GuestAccessLink from '@/models/guestAccessLink';
import PaySlipClient from '@/app/bills/[billId]/pay/PaySlipClient';

function hashGuestAccessToken(rawToken: string) {
  return createHash('sha256').update(rawToken.trim()).digest('hex');
}

export default async function GuestPayPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  await connectMongoDB();

  const tokenHash = hashGuestAccessToken(token);
  const access = await GuestAccessLink.findOne({
    tokenHash,
    isActive: true,
  })
    .select('billId expiresAt')
    .lean();

  if (!access) notFound();

  if (access.expiresAt && new Date(access.expiresAt).getTime() < Date.now()) {
    notFound();
  }

  return (
    <PaySlipClient
      billId={String(access.billId)}
      forcedGuestAccessToken={token}
    />
  );
}