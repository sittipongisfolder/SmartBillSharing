import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import Invite from "@/models/invite";
import { generateToken, hashToken } from "@/lib/tokens";
import { isRecord } from "@/lib/typeGuards";

export const runtime = "nodejs";

type CreateInviteBody = {
  participantId: string;
  expiresInDays?: number;
  maxUses?: number;
};

type RouteContext = {
  params: Promise<{ billId: string }>;
};

function idToString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "toString" in v) {
    const fn = (v as { toString?: unknown }).toString;
    if (typeof fn === "function") return String(fn.call(v));
  }
  return "";
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
        expiresInDays:
          typeof bodyUnknown.expiresInDays === "number"
            ? bodyUnknown.expiresInDays
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

  const expiresInDaysRaw = body.expiresInDays ?? 7;
  const expiresInDays = Math.max(1, Math.min(30, Math.trunc(expiresInDaysRaw)));

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

  const rawToken = generateToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

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

  await Invite.create({
    billId: bill._id,
    participantId: participant._id,
    createdBy: userId,
    tokenHash,
    expiresAt,
    maxUses,
    usedCount: 0,
    revoked: false,
  });

  return NextResponse.json({
    invitePath: `/i/${rawToken}`,
    expiresAt,
    maxUses,
    participantId: idToString(participant._id),
    participantName: participant.name,
  });
}
