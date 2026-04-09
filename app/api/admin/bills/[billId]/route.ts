import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import mongoose from "mongoose";

import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import User from "@/models/user";

type SplitType = "equal" | "percentage" | "personal";
type BillStatus = "unpaid" | "pending" | "paid";

type BillUpdateBody = Partial<{
  title: string;
  description: string;
  splitType: SplitType;
  billStatus: BillStatus;
  total: number;
  totalPrice: number;
  items: Array<Record<string, unknown>>;
  participants: Array<Record<string, unknown>>;
}>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toNum(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function normalizeItem(raw: unknown) {
  const row = isRecord(raw) ? raw : {};

  const itemName =
    typeof row.items === "string"
      ? row.items.trim()
      : typeof row.name === "string"
        ? row.name.trim()
        : "";

  const qty = Math.max(1, toNum(row.qty, 1));

  const unitPrice =
    typeof row.unitPrice === "number"
      ? Math.max(0, row.unitPrice)
      : typeof row.unit_price === "number"
        ? Math.max(0, row.unit_price)
        : typeof row.price === "number" && qty > 0
          ? Math.max(0, row.price / qty)
          : toNum(row.unitPrice ?? row.unit_price, 0);

  const lineTotal =
    typeof row.price === "number"
      ? Math.max(0, row.price)
      : typeof row.line_total === "number"
        ? Math.max(0, row.line_total)
        : round2(qty * Math.max(0, unitPrice));

  const splitModeRaw = typeof row.splitMode === "string" ? row.splitMode : "equal";
  const splitMode =
    splitModeRaw === "equal" || splitModeRaw === "single" || splitModeRaw === "shared"
      ? splitModeRaw
      : "equal";

  const assignedParticipantIdsRaw = Array.isArray(row.assignedParticipantIds)
    ? row.assignedParticipantIds
    : [];

  const assignedParticipantIds = assignedParticipantIdsRaw
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => mongoose.Types.ObjectId.isValid(value))
    .map((value) => new mongoose.Types.ObjectId(value));

  return {
    items: itemName,
    qty,
    unitPrice: round2(Math.max(0, unitPrice)),
    price: round2(lineTotal),
    splitMode,
    assignedParticipantIds,
  };
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ billId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { billId } = await ctx.params;
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return NextResponse.json({ ok: false, error: "Invalid billId" }, { status: 400 });
  }

  await connectMongoDB();

  const billDoc = await Bill.findById(billId).lean();
  if (!billDoc) {
    return NextResponse.json({ ok: false, error: "Bill not found" }, { status: 404 });
  }

  const ownerId = String((billDoc as { createdBy?: unknown }).createdBy ?? "");
  const owner = ownerId && mongoose.Types.ObjectId.isValid(ownerId)
    ? await User.findById(ownerId).select("_id name email").lean()
    : null;

  return NextResponse.json({
    ok: true,
    bill: {
      ...billDoc,
      id: String((billDoc as { _id: unknown })._id),
      total: (billDoc as { totalPrice?: number }).totalPrice ?? 0,
      owner: owner
        ? {
            id: String(owner._id),
            name: owner.name ?? null,
            email: owner.email ?? null,
          }
        : null,
    },
  });
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ billId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { billId } = await ctx.params;
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return NextResponse.json({ ok: false, error: "Invalid billId" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as unknown;
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
  }

  const payload = body as BillUpdateBody;
  const update: Record<string, unknown> = {};

  if (typeof payload.title === "string") update.title = payload.title.trim();
  if (typeof payload.description === "string") update.description = payload.description;

  if (
    payload.splitType === "equal" ||
    payload.splitType === "percentage" ||
    payload.splitType === "personal"
  ) {
    update.splitType = payload.splitType;
  }

  if (
    payload.billStatus === "unpaid" ||
    payload.billStatus === "pending" ||
    payload.billStatus === "paid"
  ) {
    update.billStatus = payload.billStatus;
  }

  if (Array.isArray(payload.items)) {
    const normalizedItems = payload.items.map(normalizeItem);
    update.items = normalizedItems;
    update.totalPrice = round2(normalizedItems.reduce((sum, item) => sum + item.price, 0));
  } else if (typeof payload.totalPrice === "number" && Number.isFinite(payload.totalPrice)) {
    update.totalPrice = round2(payload.totalPrice);
  } else if (typeof payload.total === "number" && Number.isFinite(payload.total)) {
    update.totalPrice = round2(payload.total);
  }

  if (Array.isArray(payload.participants)) {
    update.participants = payload.participants;
  }

  await connectMongoDB();

  const updated = await Bill.findByIdAndUpdate(
    billId,
    { $set: update },
    { new: true },
  ).lean();

  if (!updated) {
    return NextResponse.json({ ok: false, error: "Bill not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    bill: {
      ...updated,
      id: String((updated as { _id: unknown })._id),
      total: (updated as { totalPrice?: number }).totalPrice ?? 0,
    },
  });
}
