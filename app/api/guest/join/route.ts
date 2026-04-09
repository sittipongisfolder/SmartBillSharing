import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import Invite from "@/models/invite";
import Guest from "@/models/guest";
import GuestAccessLink from "@/models/guestAccessLink";
import Bill from "@/models/bill";
import { generateToken, getInviteIdFromPublicToken, hashToken } from "@/lib/tokens";
import { isString } from "@/lib/typeGuards";

export const runtime = "nodejs";

type PaymentStatus = "unpaid" | "pending" | "paid";

type ParticipantLike = {
  _id?: unknown;
  amount: number;
  userId?: unknown;
  guestId?: unknown;
  kind?: unknown;
  name?: string;
  paymentStatus?: PaymentStatus;
  joinedAt?: Date;
};

type BillLike = {
  splitType?: unknown;
  totalPrice: number;
  createdBy?: unknown;
  participants: ParticipantLike[];
};

function idToString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "toString" in v) {
    const fn = (v as { toString?: unknown }).toString;
    if (typeof fn === "function") return String(fn.call(v));
  }
  return null;
}

function recalcEqualAmountsInPlace(bill: BillLike) {
  if (String(bill.splitType) !== "equal") return;

  const n = bill.participants.length;
  if (n <= 0) return;

  const total = Number(bill.totalPrice) || 0;
  const centsTotal = Math.max(0, Math.round(total * 100));

  const base = Math.floor(centsTotal / n);
  const rem = centsTotal - base * n;

  bill.participants.forEach((p, idx) => {
    const cents = base + (idx < rem ? 1 : 0);
    p.amount = cents / 100;
  });

  const ownerId = idToString(bill.createdBy);
  if (ownerId) {
    bill.participants.forEach((p) => {
      const uid = idToString(p.userId);
      if (uid && uid === ownerId) {
        p.paymentStatus = "paid";
      }
    });
  }
}

function clampName(name: string): string {
  return name.trim().slice(0, 80);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const tokenRaw = form.get("token");
  const displayNameRaw = form.get("displayName");

  if (!isString(tokenRaw) || !isString(displayNameRaw)) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const token = tokenRaw.trim();
  const displayName = clampName(displayNameRaw);

  if (!token) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  if (displayName.length < 1) {
    return NextResponse.json(
      { error: "Display name required" },
      { status: 400 },
    );
  }

  await connectMongoDB();

  const inviteId = getInviteIdFromPublicToken(token);

  const invite = inviteId
    ? await Invite.findOne({
        _id: inviteId,
        revoked: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      })
    : await Invite.findOne({
        tokenHash: hashToken(token),
        revoked: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      });

  if (!invite) {
    return NextResponse.json(
      { error: "Invite not found/expired" },
      { status: 404 },
    );
  }

  const bill = await Bill.findById(invite.billId);
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  const participantId = idToString(invite.participantId);
  if (!participantId || !mongoose.Types.ObjectId.isValid(participantId)) {
    return NextResponse.json(
      { error: "Invite participant invalid" },
      { status: 400 },
    );
  }

  const slot = Array.isArray(bill.participants)
    ? bill.participants.find((p) => idToString(p._id) === participantId)
    : undefined;

  if (!slot) {
    return NextResponse.json(
      { error: "Guest slot not found" },
      { status: 404 },
    );
  }

  const rawAccessToken = generateToken(32);
  const accessTokenHash = hashToken(rawAccessToken);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const redirectToGuestAccess = async (guestId: unknown) => {
    await GuestAccessLink.create({
      guestId,
      billId: bill._id,
      tokenHash: accessTokenHash,
      tokenLast4: rawAccessToken.slice(-4),
      isActive: true,
      expiresAt,
    });

    const res = NextResponse.redirect(
      new URL(`/guest/access/${rawAccessToken}?inviteToken=${encodeURIComponent(token)}`, req.url),
    );

    return res;
  };

  if (slot.kind === "guest" && slot.guestId) {
    if (slot.paymentStatus === "paid") {
      return NextResponse.json(
        { error: "ลิงก์นี้สิ้นสุดแล้ว เนื่องจาก guest รายการนี้ชำระเงินเรียบร้อย" },
        { status: 409 },
      );
    }

    if (!invite.guestId) {
      invite.guestId = slot.guestId;
      await invite.save();
    }
    return redirectToGuestAccess(slot.guestId);
  }

  // ✅ join ใหม่ได้เฉพาะตอน draft
  if (bill.stage !== "draft") {
    return NextResponse.json(
      { error: "บิลนี้เปิดใช้งานแล้ว ไม่สามารถใช้ลิงก์เชิญนี้ได้" },
      { status: 409 },
    );
  }

  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
    return NextResponse.json(
      { error: "Invite quota reached" },
      { status: 409 },
    );
  }

  if (slot.kind !== "guest_placeholder") {
    return NextResponse.json(
      { error: "Invite slot is not a guest placeholder" },
      { status: 409 },
    );
  }

  if (slot.guestId) {
    return NextResponse.json(
      { error: "This guest slot has already been claimed" },
      { status: 409 },
    );
  }

  const guest = await Guest.create({ displayName });

  slot.kind = "guest";
  slot.guestId = guest._id;
  slot.name = displayName;
  slot.joinedAt = new Date();
  slot.paymentStatus = "unpaid";

  recalcEqualAmountsInPlace({
    splitType: bill.splitType,
    totalPrice: bill.totalPrice,
    createdBy: bill.createdBy,
    participants: bill.participants,
  });

  await bill.save();

  invite.guestId = guest._id;
  await invite.save();

  return redirectToGuestAccess(guest._id);
}
