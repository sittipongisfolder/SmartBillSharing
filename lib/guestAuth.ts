import { connectMongoDB } from '@/lib/mongodb';
import GuestSession from '@/models/guestSession';
import { hashToken } from '@/lib/tokens';

export async function getGuestIdFromSessionToken(rawToken: string): Promise<string | null> {
  await connectMongoDB();
  const tokenHash = hashToken(rawToken);

  const session = await GuestSession.findOne({
    tokenHash,
    expiresAt: { $gt: new Date() },
  }).lean();

  return session ? String(session.guestId) : null;
}

