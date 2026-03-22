import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import mongoose from "mongoose";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import User from "@/models/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SplitType = "equal" | "percentage" | "personal";
type BillStatus = "unpaid" | "pending" | "paid";

/**
 * รองรับ ownerId แบบ:
 * - ObjectId string (user _id)
 * - "__shared__" (รายการแชร์)
 */
type ItemNormalized = {
  id: string;
  name: string; // ใช้ใน UI
  items: string; // เผื่อ schema/หน้าเดิมใช้คำว่า items
  qty: number;
  unit_price: number; // ราคา/ชิ้น
  line_total: number; // qty * unit_price
  price: number; // เผื่อ schema/หน้าเดิมใช้ price = line_total
  ownerId: string; // ObjectId string หรือ "__shared__"
  sharedWith: string[]; // array ของ ObjectId string
};

type BillUpdateBody = Partial<{
  title: string;
  description: string;
  splitType: SplitType;
  total: number;
  billStatus: BillStatus;
  status: "open" | "closed";
  items: Array<Record<string, unknown>>;
  participants: Array<Record<string, unknown>>;
}>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

const makeId = () => new mongoose.Types.ObjectId().toString();

const num = (v: unknown, fallback = 0) => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

const toStr = (v: unknown): string | null => {
  if (typeof v === "string") return v;
  if (v instanceof mongoose.Types.ObjectId) return v.toString();
  if (typeof v === "object" && v && "_id" in v) {
    const idv = (v as { _id: unknown })._id;
    if (typeof idv === "string") return idv;
    if (idv instanceof mongoose.Types.ObjectId) return idv.toString();
    try {
      return String(idv);
    } catch {
      return null;
    }
  }
  try {
    return v != null ? String(v) : null;
  } catch {
    return null;
  }
};

const isObjectIdString = (s: string) => mongoose.Types.ObjectId.isValid(s);

function normalizeOneItem(raw: unknown): ItemNormalized {
  const r = isRecord(raw) ? raw : {};

  // name/items (รองรับหลายชื่อ)
  const name =
    typeof r.name === "string"
      ? r.name
      : typeof r.items === "string"
        ? (r.items as string)
        : typeof r.item === "string"
          ? (r.item as string)
          : "";

  const qtyRaw = r.qty ?? r.quantity ?? 1;
  const qty = Math.max(1, num(qtyRaw, 1));

  // unit_price รองรับหลายชื่อ
  const unitFromField =
    typeof r.unit_price === "number"
      ? (r.unit_price as number)
      : typeof r.unitPrice === "number"
        ? (r.unitPrice as number)
        : typeof r.unit_price === "string"
          ? Number(r.unit_price)
          : typeof r.unitPrice === "string"
            ? Number(r.unitPrice)
            : NaN;

  // line_total รองรับหลายชื่อ
  const lineFromField =
    typeof r.line_total === "number"
      ? (r.line_total as number)
      : typeof r.lineTotal === "number"
        ? (r.lineTotal as number)
        : typeof r.price === "number"
          ? (r.price as number)
          : typeof r.line_total === "string"
            ? Number(r.line_total)
            : typeof r.lineTotal === "string"
              ? Number(r.lineTotal)
              : typeof r.price === "string"
                ? Number(r.price)
                : NaN;

  // ถ้ามี unit_price ใช้เลย / ถ้าไม่มีแต่มี line_total ให้หาร qty เป็น unit_price
  const unit_price = Number.isFinite(unitFromField)
    ? Math.max(0, unitFromField)
    : Number.isFinite(lineFromField)
      ? Math.max(0, lineFromField) / qty
      : 0;

  const line_total = round2(qty * unit_price);

  // ownerId / sharedWith
  const ownerRaw =
    r.ownerId ?? r.owner_id ?? r.owner ?? r.ownerID ?? "__shared__";
  const ownerStr = toStr(ownerRaw);
  const ownerId =
    ownerStr === "__shared__"
      ? "__shared__"
      : ownerStr && isObjectIdString(ownerStr)
        ? ownerStr
        : "__shared__";

  const swRaw = r.sharedWith ?? r.shared_with ?? r.sharedWithIds ?? [];
  const swArr = Array.isArray(swRaw) ? swRaw : [];
  const sharedWith = swArr
    .map((x) => toStr(x))
    .filter((x): x is string => typeof x === "string" && isObjectIdString(x));

  // ถ้าไม่ได้แชร์จริง ให้ sharedWith ว่าง
  const sharedWithFinal =
    ownerId === "__shared__" ? Array.from(new Set(sharedWith)) : [];

  const id =
    typeof r.id === "string"
      ? r.id
      : typeof r._id === "string"
        ? (r._id as string)
        : makeId();

  return {
    id,
    name,
    items: name, // คงไว้ให้หน้าเดิมอ่าน
    qty,
    unit_price: round2(unit_price),
    line_total,
    price: line_total, // คงไว้ให้หน้าเดิมอ่าน (price = line_total)
    ownerId,
    sharedWith: sharedWithFinal,
  };
}

function normalizeItemsFromBillDoc(
  doc: Record<string, unknown>,
): ItemNormalized[] {
  const raw =
    (Array.isArray(doc.items) ? doc.items : null) ??
    (Array.isArray(doc.itemList) ? doc.itemList : null) ??
    (Array.isArray(doc.billItems) ? doc.billItems : null) ??
    (Array.isArray(doc.menuItems) ? doc.menuItems : null) ??
    [];

  return (Array.isArray(raw) ? raw : []).map(normalizeOneItem);
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ billId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { billId } = await ctx.params;
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid billId" },
      { status: 400 },
    );
  }

  await connectMongoDB();

  const billLean = await Bill.findById(billId).lean();
  if (!billLean)
    return NextResponse.json(
      { ok: false, error: "Bill not found" },
      { status: 404 },
    );

  const bill = billLean as Record<string, unknown>;

  const itemsNormalized = normalizeItemsFromBillDoc(bill);

  const ownerIdRaw = bill.ownerId ?? bill.createdBy;
  const ownerId = ownerIdRaw ? String(ownerIdRaw) : null;

  const owner =
    ownerId && mongoose.Types.ObjectId.isValid(ownerId)
      ? await User.findById(ownerId).select("_id name email userId").lean()
      : null;

  return NextResponse.json({
    ok: true,
    bill: {
      ...bill,
      id: String(bill._id),
      items: itemsNormalized,
      owner: owner
        ? {
            id: String(owner._id),
            name: owner.name ?? null,
            email: owner.email ?? null,
            userId:
              (owner as unknown as { userId?: string | null }).userId ?? null,
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
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { billId } = await ctx.params;
  if (!mongoose.Types.ObjectId.isValid(billId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid billId" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => null)) as unknown;
  if (!isRecord(body)) {
    return NextResponse.json(
      { ok: false, error: "Invalid body" },
      { status: 400 },
    );
  }

  const b = body as BillUpdateBody;
  const update: Record<string, unknown> = {};

  if (typeof b.title === "string") update.title = b.title.trim();
  if (typeof b.description === "string") update.description = b.description;

  if (
    b.splitType === "equal" ||
    b.splitType === "percentage" ||
    b.splitType === "personal"
  ) {
    update.splitType = b.splitType;
  }

  if (
    b.billStatus === "unpaid" ||
    b.billStatus === "pending" ||
    b.billStatus === "paid"
  ) {
    update.billStatus = b.billStatus;
  }

  if (b.status === "open" || b.status === "closed") update.status = b.status;

  if (Array.isArray(b.items)) {
    const normalized = b.items.map(normalizeOneItem);

    const totalFromItems = round2(
      normalized.reduce((acc, it) => acc + it.line_total, 0),
    );

    update.items = normalized;
    update.total = totalFromItems;
  } else if (typeof b.total === "number" && Number.isFinite(b.total)) {
    update.total = b.total;
  }

  if (Array.isArray(b.participants)) update.participants = b.participants;

  await connectMongoDB();

  const updatedLean = await Bill.findByIdAndUpdate(
    billId,
    { $set: update },
    { new: true },
  ).lean();
  if (!updatedLean)
    return NextResponse.json(
      { ok: false, error: "Bill not found" },
      { status: 404 },
    );

  const updated = updatedLean as Record<string, unknown>;
  const itemsNormalized = normalizeItemsFromBillDoc(updated);

  return NextResponse.json({
    ok: true,
    bill: { ...updated, id: String(updated._id), items: itemsNormalized },
  });
}
