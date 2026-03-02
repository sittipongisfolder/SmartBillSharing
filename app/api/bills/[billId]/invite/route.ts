import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import Invite from '@/models/invite';
import { generateToken, hashToken } from '@/lib/tokens';
import { isRecord } from '@/lib/typeGuards';

export const runtime = 'nodejs';

type CreateInviteBody = {
  expiresInDays?: number;
  maxUses?: number;
};

type RouteContext = {
  params: Promise<{ billId: string }>;
};

export async function POST(req: Request, { params }: RouteContext) {
  const { billId } = await params; // ✅ สำคัญ: ต้อง await

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const bodyUnknown: unknown = await req.json().catch(() => ({}));
  const body: CreateInviteBody = isRecord(bodyUnknown)
    ? {
        expiresInDays: typeof bodyUnknown.expiresInDays === 'number' ? bodyUnknown.expiresInDays : undefined,
        maxUses: typeof bodyUnknown.maxUses === 'number' ? bodyUnknown.maxUses : undefined,
      }
    : {};

  const expiresInDays = body.expiresInDays ?? 7;
  const maxUses = body.maxUses ?? 50;

  await connectMongoDB();

  const bill = await Bill.findById(billId).lean(); // ✅ ใช้ billId ที่ await มาแล้ว
  if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

  if (String(bill.createdBy) !== String(userId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  await Invite.create({
    billId: bill._id,
    createdBy: userId,
    tokenHash,
    expiresAt,
    maxUses,
    usedCount: 0,
    revoked: false,
  });

  return NextResponse.json({ invitePath: `/i/${rawToken}`, expiresAt, maxUses });
}