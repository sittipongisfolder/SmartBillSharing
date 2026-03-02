import { NextResponse } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import Invite from "@/models/invite";
import Guest from "@/models/guest";
import GuestSession from "@/models/guestSession";
import Bill from "@/models/bill";
import { generateToken, hashToken } from "@/lib/tokens";
import { isString } from "@/lib/typeGuards";

export const runtime = "nodejs";

type PaymentStatus = "unpaid" | "pending" | "paid";

type ParticipantLike = {
  amount: number;
  userId?: unknown;
  kind?: unknown;
  paymentStatus?: PaymentStatus;
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

  // กัน owner ต้องไม่เป็น unpaid (optional แต่แนะนำ)
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
  const token = form.get("token");
  const displayNameRaw = form.get("displayName");

  if (!isString(token) || !isString(displayNameRaw)) {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const displayName = clampName(displayNameRaw);
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

  if (!invite)
    return NextResponse.json(
      { error: "Invite not found/expired" },
      { status: 404 },
    );
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) {
    return NextResponse.json(
      { error: "Invite quota reached" },
      { status: 409 },
    );
  }

  const bill = await Bill.findById(invite.billId);
  if (!bill)
    return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  const guest = await Guest.create({ displayName });

  bill.participants.push({
    kind: "guest",
    guestId: guest._id,
    name: displayName,
    amount: 0, // ใส่ไว้ก่อน เดี๋ยว recalcEqualAmountsInPlace จะเขียนทับ
    paymentStatus: "unpaid",
  });

  // ✅ เพิ่มบรรทัดนี้
  recalcEqualAmountsInPlace({
    splitType: bill.splitType,
    totalPrice: bill.totalPrice,
    createdBy: bill.createdBy,
    participants: bill.participants,
  });

  await bill.save();

  invite.usedCount += 1;
  await invite.save();

  // session 30 วัน
  const rawSession = generateToken(32);
  const sessionHash = hashToken(rawSession);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  await GuestSession.create({
    guestId: guest._id,
    tokenHash: sessionHash,
    expiresAt,
  });

  const res = NextResponse.redirect(
    new URL(`/guest/bills/${bill._id}`, req.url),
  );
  res.cookies.set("sb_guest", rawSession, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  return res;
}
