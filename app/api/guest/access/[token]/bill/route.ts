import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { createHash } from 'crypto';

import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import Guest from '@/models/guest';
import GuestAccessLink from '@/models/guestAccessLink';
import User from '@/models/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ObjectIdLike = mongoose.Types.ObjectId | string | null | undefined;
type PaymentStatus = 'unpaid' | 'paid';
type BillStatus = 'unpaid' | 'pending' | 'paid';

type BillOwner = {
  _id?: ObjectIdLike;
  name?: string;
  email?: string;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
};

type SlipInfo = {
  imageUrl?: string;
  publicId?: string;
  provider?: 'slipok';
  reference?: string;
  checkedAt?: Date | string;
  verified?: boolean;
};

type BillParticipant = {
  _id?: ObjectIdLike;
  kind?: 'user' | 'guest_placeholder' | 'guest';
  userId?: ObjectIdLike | { _id?: ObjectIdLike };
  guestId?: ObjectIdLike;
  name: string;
  amount: number;
  paymentStatus?: PaymentStatus;
  slipInfo?: SlipInfo;
};

type BillLean = {
  _id: ObjectIdLike;
  title: string;
  billStatus?: BillStatus;
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: BillOwner | ObjectIdLike;
  participants: BillParticipant[];
};

type GuestAccessLinkLean = {
  _id?: ObjectIdLike;
  guestId: ObjectIdLike;
  billId: ObjectIdLike;
  tokenHash: string;
  tokenLast4?: string;
  isActive?: boolean;
  expiresAt?: Date | null;
  createdAt?: Date;
  lastUsedAt?: Date | null;
};

type GuestLean = {
  _id?: ObjectIdLike;
  name?: string;
  displayName?: string;
  guestName?: string;
};

function toIdString(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (value instanceof mongoose.Types.ObjectId) return value.toString();

  if (typeof value === 'object' && value !== null && '_id' in value) {
    return toIdString((value as { _id?: unknown })._id);
  }

  return '';
}

function hashGuestAccessToken(rawToken: string): string {
  return createHash('sha256').update(rawToken.trim()).digest('hex');
}

function computeBillStatus(participants: BillParticipant[]): BillStatus {
  if (!participants.length) return 'unpaid';

  const paidCount = participants.filter((p) => p.paymentStatus === 'paid').length;

  if (paidCount === 0) return 'unpaid';
  if (paidCount === participants.length) return 'paid';
  return 'pending';
}

async function resolveOwner(createdBy: BillLean['createdBy']): Promise<BillOwner | null> {
  if (!createdBy) return null;

  if (typeof createdBy === 'object' && createdBy !== null) {
    const maybeOwner = createdBy as BillOwner;

    if (
      maybeOwner.name ||
      maybeOwner.email ||
      maybeOwner.bank ||
      maybeOwner.bankAccountNumber ||
      maybeOwner.promptPayPhone
    ) {
      return {
        _id: maybeOwner._id,
        name: maybeOwner.name ?? '',
        email: maybeOwner.email ?? '',
        bank: maybeOwner.bank ?? '',
        bankAccountNumber: maybeOwner.bankAccountNumber ?? '',
        promptPayPhone: maybeOwner.promptPayPhone ?? '',
      };
    }
  }

  const ownerId = toIdString(createdBy);
  if (!ownerId) return null;

  const owner = (await User.findById(ownerId)
    .select('name email bank bankAccountNumber promptPayPhone')
    .lean()) as BillOwner | null;

  if (!owner) return null;

  return {
    _id: owner._id,
    name: owner.name ?? '',
    email: owner.email ?? '',
    bank: owner.bank ?? '',
    bankAccountNumber: owner.bankAccountNumber ?? '',
    promptPayPhone: owner.promptPayPhone ?? '',
  };
}

async function resolveGuestName(guestId: ObjectIdLike): Promise<string> {
  const guestIdStr = toIdString(guestId);
  if (!guestIdStr) return '';

  const guest = (await Guest.findById(guestIdStr)
    .select('name displayName guestName')
    .lean()) as GuestLean | null;

  if (!guest) return '';

  return guest.name?.trim() || guest.displayName?.trim() || guest.guestName?.trim() || '';
}

function findParticipantIndexForGuest(
  participants: BillParticipant[],
  guestId: ObjectIdLike,
  guestName: string,
): number {
  const guestIdStr = toIdString(guestId);

  if (guestIdStr) {
    const indexByGuestId = participants.findIndex(
      (participant) => toIdString(participant.guestId) === guestIdStr,
    );
    if (indexByGuestId >= 0) return indexByGuestId;
  }

  const normalizedGuestName = guestName.trim().toLowerCase();
  if (normalizedGuestName) {
    const indexByName = participants.findIndex((participant) => {
      const participantName = participant.name.trim().toLowerCase();
      const participantKind = participant.kind ?? '';
      return (
        participantName === normalizedGuestName &&
        (participantKind === 'guest' || participantKind === 'guest_placeholder')
      );
    });

    if (indexByName >= 0) return indexByName;
  }

  return -1;
}

function errorJson(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const rawToken = token?.trim();

    if (!rawToken) {
      return errorJson('Guest access token is required', 400);
    }

    await connectMongoDB();

    const tokenHash = hashGuestAccessToken(rawToken);

    const access = (await GuestAccessLink.findOne({
      tokenHash,
      isActive: true,
    }).lean()) as GuestAccessLinkLean | null;

    if (!access) {
      return errorJson('Guest access not found', 404);
    }

    if (access.expiresAt && access.expiresAt.getTime() < Date.now()) {
      return errorJson('Guest access token has expired', 403);
    }

    const bill = (await Bill.findById(access.billId).lean()) as BillLean | null;

    if (!bill) {
      return errorJson('Bill not found', 404);
    }

    const guestName = await resolveGuestName(access.guestId);
    const participantIndex = findParticipantIndexForGuest(
      bill.participants,
      access.guestId,
      guestName,
    );

    if (participantIndex < 0) {
      return errorJson('This guest access is not linked to a participant in this bill', 403);
    }

    const me = bill.participants[participantIndex];
    const owner = await resolveOwner(bill.createdBy);
    const billStatus = bill.billStatus ?? computeBillStatus(bill.participants);

    await GuestAccessLink.updateOne(
      { _id: access._id },
      { $set: { lastUsedAt: new Date() } },
    );

    return NextResponse.json({
      ok: true,
      bill: {
        _id: toIdString(bill._id),
        title: bill.title,
        billStatus,
        createdAt: bill.createdAt ?? null,
        updatedAt: bill.updatedAt ?? null,
        createdBy: owner,
        participants: bill.participants.map((participant, index) => ({
          _id: toIdString(participant._id),
          kind: participant.kind ?? (toIdString(participant.guestId) ? 'guest' : 'user'),
          userId: toIdString(participant.userId),
          guestId: toIdString(participant.guestId),
          name: participant.name,
          amount: Number(participant.amount ?? 0),
          paymentStatus: participant.paymentStatus ?? 'unpaid',
          slipInfo: participant.slipInfo ?? null,
          canUploadSlip: index === participantIndex && participant.paymentStatus !== 'paid',
        })),
      },

      guest: {
        guestId: toIdString(me.guestId || access.guestId),
        name: me.name,
        amount: Number(me.amount ?? 0),
        paymentStatus: me.paymentStatus ?? 'unpaid',
        slipInfo: me.slipInfo ?? null,
      },

      me: {
        participantIndex,
        participantId: toIdString(me._id),
        guestId: toIdString(me.guestId),
        name: me.name,
        amount: Number(me.amount ?? 0),
        paymentStatus: me.paymentStatus ?? 'unpaid',
        slipInfo: me.slipInfo ?? null,
      },

      guestAccess: {
        token: rawToken,
        tokenLast4: access.tokenLast4 ?? rawToken.slice(-4),
        expiresAt: access.expiresAt ?? null,
        lastUsedAt: new Date(),
      },
    });
  } catch (error) {
    console.error('GET /api/guest/access/[token]/bill error:', error);
    return errorJson('Failed to load bill via guest access', 500);
  }
}