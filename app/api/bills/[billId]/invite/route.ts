import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import Invite from "@/models/invite";
import { createInvitePublicToken, generateToken, hashToken } from "@/lib/tokens";
import { isRecord } from "@/lib/typeGuards";
import GuestAccessLink from "@/models/guestAccessLink";

export const runtime = "nodejs";

type CreateInviteBody = {
  participantId: string;
  maxUses?: number;
};

type RouteContext = {
  params: Promise<{ billId: string }>;
};

function isInviteNotExpired(expiresAt?: Date | null): boolean {
  return !expiresAt || expiresAt.getTime() > Date.now();
}

function idToString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "toString" in v) {
    const fn = (v as { toString?: unknown }).toString;
    if (typeof fn === "function") return String(fn.call(v));
  }
  return "";
}

function isParticipantPaid(participant: { paymentStatus?: unknown } | undefined): boolean {
  return participant?.paymentStatus === "paid";
}

export async function POST(req: Request, { params }: RouteContext) {
  const { billId } = await params;

  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return NextResponse.json({ error: "billId ไม่ถูกต้อง" }, { status: 400 });
  }

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bodyUnknown: unknown = await req.json().catch(() => ({}));

  const body: Partial<CreateInviteBody> = isRecord(bodyUnknown)
    ? {
        participantId:
          typeof bodyUnknown.participantId === "string"
            ? bodyUnknown.participantId.trim()
            : undefined,
        maxUses:
          typeof bodyUnknown.maxUses === "number"
            ? bodyUnknown.maxUses
            : undefined,
      }
    : {};

  if (
    !body.participantId ||
    !mongoose.Types.ObjectId.isValid(body.participantId)
  ) {
    return NextResponse.json(
      { error: "participantId ไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  // ✅ 1 slot = 1 invite = 1 คน เสมอ
  const maxUses = 1;

  await connectMongoDB();

  const bill = await Bill.findById(billId);
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  if (String(bill.createdBy) !== String(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (bill.stage !== "draft") {
    return NextResponse.json(
      { error: "สร้างลิงก์เชิญได้เฉพาะบิลที่ยังเป็น draft" },
      { status: 400 },
    );
  }

  const participant = Array.isArray(bill.participants)
    ? bill.participants.find((p) => idToString(p._id) === body.participantId)
    : undefined;

  if (!participant) {
    return NextResponse.json(
      { error: "ไม่พบ participant slot นี้ในบิล" },
      { status: 404 },
    );
  }

  if (participant.kind !== "guest_placeholder") {
    return NextResponse.json(
      { error: "participant นี้ไม่ใช่ guest placeholder" },
      { status: 400 },
    );
  }

  if (!participant._id) {
    return NextResponse.json(
      { error: "participant slot นี้ไม่มี _id" },
      { status: 500 },
    );
  }

  const expiresAt: Date | null = null;

  const existingInvite = (await Invite.findOne({
    billId: bill._id,
    participantId: participant._id,
    revoked: false,
  })
    .sort({ createdAt: -1 })
    .lean()) as
    | {
        _id: unknown;
        expiresAt?: Date | null;
        maxUses?: number | null;
      }
    | null;

  if (existingInvite && isInviteNotExpired(existingInvite.expiresAt)) {
    const inviteToken = createInvitePublicToken(idToString(existingInvite._id));
    return NextResponse.json({
      invitePath: `/i/${inviteToken}`,
      expiresAt: existingInvite.expiresAt ?? null,
      maxUses: existingInvite.maxUses ?? maxUses,
      participantId: idToString(participant._id),
      participantName: participant.name,
      reused: true,
    });
  }

  await Invite.updateMany(
    {
      billId: bill._id,
      participantId: participant._id,
      revoked: false,
    },
    {
      $set: { revoked: true },
    },
  );

  // Keep a hashed raw token for legacy lookup/index compatibility.
  const rawInviteToken = generateToken(32);
  const inviteTokenHash = hashToken(rawInviteToken);

  const createdInvite = await Invite.create({
    billId: bill._id,
    participantId: participant._id,
    createdBy: userId,
    tokenHash: inviteTokenHash,
    expiresAt,
    maxUses,
    usedCount: 0,
    revoked: false,
  });

  const inviteToken = createInvitePublicToken(idToString(createdInvite._id));

  return NextResponse.json({
    invitePath: `/i/${inviteToken}`,
    expiresAt,
    maxUses,
    participantId: idToString(participant._id),
    participantName: participant.name,
  });
}

export async function GET(req: Request, { params }: RouteContext) {
  const { billId } = await params;

  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return NextResponse.json({ error: "billId ไม่ถูกต้อง" }, { status: 400 });
  }

  const participantId = new URL(req.url).searchParams.get("participantId")?.trim() ?? "";
  if (!participantId || !mongoose.Types.ObjectId.isValid(participantId)) {
    return NextResponse.json(
      { error: "participantId ไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await connectMongoDB();

  const bill = await Bill.findById(billId);
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  if (String(bill.createdBy) !== String(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const participant = Array.isArray(bill.participants)
    ? bill.participants.find((p) => idToString(p._id) === participantId)
    : undefined;

  if (!participant) {
    return NextResponse.json(
      { error: "ไม่พบ participant นี้ในบิล" },
      { status: 404 },
    );
  }

  if (isParticipantPaid(participant as { paymentStatus?: unknown })) {
    return NextResponse.json(
      { error: "participant นี้ชำระเงินแล้ว ลิงก์เชิญจึงไม่สามารถใช้งานต่อได้" },
      { status: 409 },
    );
  }

  const invite = (await Invite.findOne({
    billId: bill._id,
    participantId: participant._id,
    revoked: false,
  })
    .sort({ createdAt: -1 })
    .lean()) as
    | {
        _id: unknown;
        expiresAt?: Date | null;
        maxUses?: number | null;
        guestId?: unknown;
      }
    | null;

  const participantGuestId = idToString((participant as { guestId?: unknown }).guestId);

  const inviteByGuest = !invite && participantGuestId
    ? ((await Invite.findOne({
        billId: bill._id,
        guestId: participantGuestId,
        revoked: false,
      })
        .sort({ createdAt: -1 })
        .lean()) as
        | {
            _id: unknown;
            expiresAt?: Date | null;
            maxUses?: number | null;
            guestId?: unknown;
          }
        | null)
    : null;

  const effectiveInvite = invite ?? inviteByGuest;

  if (effectiveInvite && isInviteNotExpired(effectiveInvite.expiresAt)) {
    const inviteToken = createInvitePublicToken(idToString(effectiveInvite._id));
    return NextResponse.json({
      invitePath: `/i/${inviteToken}`,
      expiresAt: effectiveInvite.expiresAt ?? null,
      maxUses: effectiveInvite.maxUses ?? null,
      participantId,
      participantName: participant.name,
    });
  }

  if (participantGuestId) {
    const rawAccessToken = generateToken(32);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await GuestAccessLink.create({
      guestId: participantGuestId,
      billId: bill._id,
      tokenHash: hashToken(rawAccessToken),
      tokenLast4: rawAccessToken.slice(-4),
      isActive: true,
      expiresAt,
    });

    return NextResponse.json({
      invitePath: `/guest/access/${rawAccessToken}/pay`,
      expiresAt,
      maxUses: null,
      participantId,
      participantName: participant.name,
      fallback: true,
    });
  }

  return NextResponse.json(
    { error: "ไม่พบลิงก์เชิญที่ยังใช้งานได้สำหรับ participant นี้" },
    { status: 404 },
  );
}
