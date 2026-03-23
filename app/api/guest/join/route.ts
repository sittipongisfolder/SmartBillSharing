import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import Invite from "@/models/invite";
import Guest from "@/models/guest";
import GuestSession from "@/models/guestSession";
import GuestAccessLink from "@/models/guestAccessLink";
import Bill from "@/models/bill";
import { generateToken, hashToken } from "@/lib/tokens";
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

  const tokenHash = hashToken(token);

  const invite = await Invite.findOne({
    tokenHash,
    revoked: false,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  });

  if (!invite) {
    return NextResponse.json(
      { error: "Invite not found/expired" },
      { status: 404 },
    );
  }

  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
    return NextResponse.json(
      { error: "Invite quota reached" },
      { status: 409 },
    );
  }

  const bill = await Bill.findById(invite.billId);
  if (!bill) {
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });
  }

  // ✅ join ได้เฉพาะตอน draft
  if (bill.stage !== "draft") {
    return NextResponse.json(
      { error: "บิลนี้เปิดใช้งานแล้ว ไม่สามารถใช้ลิงก์เชิญนี้ได้" },
      { status: 409 },
    );
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

  invite.usedCount += 1;
  invite.revoked = true; // ✅ ใช้แล้วปิดเลย
  await invite.save();

  const rawSession = generateToken(32);
  const sessionHash = hashToken(rawSession);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const isHttps = req.headers.get("x-forwarded-proto") === "https";

  await GuestSession.create({
    guestId: guest._id,
    tokenHash: sessionHash,
    expiresAt,
  });

  const rawAccessToken = generateToken(32);
  const accessTokenHash = hashToken(rawAccessToken);

  await GuestAccessLink.create({
    guestId: guest._id,
    billId: bill._id,
    tokenHash: accessTokenHash,
    tokenLast4: rawAccessToken.slice(-4),
    isActive: true,
    expiresAt,
  });

  const res = NextResponse.redirect(
    new URL(`/guest/access/${rawAccessToken}`, req.url),
  );

  res.cookies.set("sb_guest", rawSession, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return res;
}
