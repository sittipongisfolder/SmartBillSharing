import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import {
  notifyBillUpdated,
  notifyBillAddedYou,
  notifyBillClosed,
} from "@/lib/notify";

type PaymentStatus = "unpaid" | "pending" | "paid";
type SplitType = "equal" | "percentage" | "personal";

type IdLike = string | { toString(): string };

type SlipInfo = {
  imageUrl?: string;
  publicId?: string;
  provider?: string;
  reference?: string;
  checkedAt?: Date;
    verified?: boolean;
};

type ParticipantDoc = {
  userId?: IdLike;
  guestId?: IdLike;
  kind?: "user" | "guest_placeholder" | "guest";
  name: string;
  amount: number;
  paymentStatus?: PaymentStatus;
  slipInfo?: SlipInfo;
  paidAt?: Date;
};

type BillItemDoc = {
  items: string;
  price: number;
  qty?: number;
  unitPrice?: number;
  splitMode?: "equal" | "single" | "shared";
  assignedParticipantIds?: string[];
};

type UpdateBillBody = {
  title?: string;
  description?: string;
  items?: Array<{ items: string; price: number | string }>;
  totalPrice?: number | string;
  splitType?: SplitType;
  participants?: Array<{
    userId: string;
    name: string;
    amount: number | string;
    paymentStatus?: PaymentStatus;
  }>;
};

function toIdString(v: IdLike | null | undefined): string {
  if (!v) return "";
  return typeof v === "string" ? v : v.toString();
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** รองรับทั้ง string/ObjectId และ populated { _id: ... } */
function getIdFromMaybePopulated(v: unknown): string {
  if (!v) return "";

  if (typeof v === "string") return v;

  if (
    typeof (v as { toString?: unknown }).toString === "function" &&
    !isObject(v)
  ) {
    return String((v as { toString: () => string }).toString());
  }

  if (isObject(v) && "_id" in v) {
    const inner = (v as { _id?: unknown })._id;
    return toIdString(inner as IdLike);
  }

  if (
    isObject(v) &&
    typeof (v as { toString?: unknown }).toString === "function"
  ) {
    return String((v as { toString: () => string }).toString());
  }

  return "";
}

function normalizeIdLike(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;

  if (typeof v === "object" && v !== null && "_id" in v) {
    const inner = (v as { _id?: unknown })._id;
    return typeof inner === "string" ? inner : String(inner ?? "");
  }

  if (
    typeof v === "object" &&
    v !== null &&
    "toString" in v &&
    typeof (v as { toString?: unknown }).toString === "function"
  ) {
    return String((v as { toString(): string }).toString());
  }

  return "";
}

function normalizeSlipInfo(slipInfo?: {
  imageUrl?: string;
  publicId?: string;
  provider?: string;
  reference?: string;
  checkedAt?: Date;
  verified?: boolean;
}) {
  if (!slipInfo) return undefined;

  return {
    imageUrl: slipInfo.imageUrl ?? "",
    publicId: slipInfo.publicId ?? "",
    provider: slipInfo.provider ?? "",
    reference: slipInfo.reference ?? "",
    checkedAt: slipInfo.checkedAt
      ? new Date(slipInfo.checkedAt).toISOString()
      : "",
    verified: Boolean(slipInfo.verified),
  };
}

/** ✅ Hybrid: billStatus คิดจาก "ลูกบิล" เท่านั้น (ไม่นับ createdBy) */
function computeBillStatusHybrid(
  participants: Array<{
    userId?: IdLike | null;
    paymentStatus?: PaymentStatus;
  }>,
  createdById: string,
): PaymentStatus {
  if (!participants || participants.length === 0) return "unpaid";

  const others = participants.filter((p) => {
    const pid = toIdString(p.userId);
    return pid.length > 0 && pid !== createdById;
  });

  if (others.length === 0) return "paid";

  const statuses = others.map((p) => p.paymentStatus ?? "unpaid");
  if (statuses.every((s) => s === "paid")) return "paid";
  if (statuses.some((s) => s === "pending" || s === "paid")) return "pending";
  return "unpaid";
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ billId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;

    if (!sessionUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { billId } = await ctx.params;

    await connectMongoDB();

    const bill = await Bill.findById(billId)
      .populate("createdBy", "name email bank bankAccountNumber promptPayPhone")
      .populate("participants.userId", "name email")
      .lean();

    if (!bill) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const rawCreatedBy = (bill as unknown as { createdBy?: unknown }).createdBy;
    const ownerId = getIdFromMaybePopulated(rawCreatedBy);
    const isOwner = String(ownerId) === String(sessionUserId);

    const rawParticipants =
      (bill as unknown as { participants?: ParticipantDoc[] }).participants ?? [];

    const isParticipant = rawParticipants.some((p) => {
      const participantUserId = getIdFromMaybePopulated(p.userId);
      return String(participantUserId) === String(sessionUserId);
    });

    if (!isOwner && !isParticipant) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const normalizedBill = {
      ...(bill as Record<string, unknown>),
      _id: String((bill as { _id: unknown })._id),

      createdBy: isObject(rawCreatedBy)
        ? {
            _id: getIdFromMaybePopulated(rawCreatedBy),
            name: (rawCreatedBy as { name?: string }).name ?? "",
            email: (rawCreatedBy as { email?: string }).email ?? "",
            bank: (rawCreatedBy as { bank?: string }).bank ?? "",
            bankAccountNumber:
              (rawCreatedBy as { bankAccountNumber?: string })
                .bankAccountNumber ?? "",
            promptPayPhone:
              (rawCreatedBy as { promptPayPhone?: string }).promptPayPhone ?? "",
          }
        : rawCreatedBy,

      participants: rawParticipants.map((p) => ({
        _id:
          "_id" in (p as object)
            ? String((p as { _id?: unknown })._id ?? "")
            : "",
        kind: p.kind ?? (p.guestId ? "guest" : "user"),
        userId: getIdFromMaybePopulated(p.userId),
        guestId: getIdFromMaybePopulated(p.guestId),
        name: p.name ?? "",
        amount: Number(p.amount ?? 0),
        paymentStatus: p.paymentStatus ?? "unpaid",
        slipInfo: normalizeSlipInfo(p.slipInfo),
        paidAt: p.paidAt ? new Date(p.paidAt).toISOString() : null,
      })),
    };

    if (isOwner) {
      return NextResponse.json({ bill: normalizedBill }, { status: 200 });
    }

    const safeBill = {
      ...normalizedBill,
      participants: normalizedBill.participants.map((p) => {
        if (String(p.userId) === String(sessionUserId)) return p;
        return { ...p, slipInfo: undefined };
      }),
    };

    return NextResponse.json({ bill: safeBill }, { status: 200 });
  } catch (error) {
    console.error("❌ Error GET bill:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

/* ====== ส่วนอื่นห้ามยุ่งตามที่คุณสั่ง ====== */

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ billId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;

    if (!sessionUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { billId } = await ctx.params;
    const body = (await req.json()) as UpdateBillBody;

    await connectMongoDB();

    const billDoc = await Bill.findById(billId);
    if (!billDoc) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const ownerId = toIdString(billDoc.createdBy as unknown as IdLike);
    const isOwner = String(sessionUserId) === String(ownerId);

    if (!isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const prevTitle = String(billDoc.title ?? "");
    const prevDesc = String(billDoc.description ?? "");
    const prevTotal = Number(billDoc.totalPrice ?? 0) || 0;
    const prevSplit = billDoc.splitType as unknown as SplitType | undefined;
    const prevBillStatus =
      (billDoc.billStatus as unknown as PaymentStatus) ?? "unpaid";

    const prevItems =
      (billDoc.items as unknown as Array<{ items: string; price: number }>) ?? [];
    const prevItemsSig = prevItems
      .map((it) => `${String(it.items ?? "").trim()}:${Number(it.price) || 0}`)
      .join("|");

    const nextTitle = (body.title ?? billDoc.title ?? "").trim();
    if (!nextTitle) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }

    const nextDescription = (
      body.description ??
      billDoc.description ??
      ""
    ).trim();

    const prevItemsRaw =
      (billDoc.items as unknown as BillItemDoc[]) ?? [];

    const rawItems = Array.isArray(body.items)
      ? body.items
      : (billDoc.items as Array<{ items: string; price: number }>);

    const effectiveSplitType =
      (body.splitType ?? (billDoc.splitType as unknown as SplitType)) as SplitType;

    const cleanedItems = rawItems
      .map((it, idx) => {
        const base = {
          items: (it.items || "").trim(),
          price: Number(it.price) || 0,
        };

        if (effectiveSplitType !== "personal") {
          return base;
        }

        const old = prevItemsRaw[idx];
        if (!old) return base;

        return {
          ...old,
          items: base.items,
          price: base.price,
        };
      })
      .filter((it) => it.items.length > 0 && it.price > 0);

    if (cleanedItems.length === 0) {
      return NextResponse.json(
        { error: "items must have at least 1 row (items+price)" },
        { status: 400 },
      );
    }

    const itemsTotal = cleanedItems.reduce((sum, it) => sum + it.price, 0);
    const finalTotal =
      Number(body.totalPrice) && Number(body.totalPrice) > 0
        ? Number(body.totalPrice)
        : itemsTotal;

    const oldParticipants =
      (billDoc.participants as unknown as ParticipantDoc[]) ?? [];

    const hasGuestParticipants = oldParticipants.some(
      (p) =>
        normalizeIdLike(p.guestId) !== "" ||
        p.kind === "guest" ||
        p.kind === "guest_placeholder",
    );

    const oldMap = new Map<string, ParticipantDoc>();
    for (const p of oldParticipants) {
      const uid = toIdString(p.userId);
      if (uid) oldMap.set(uid, p);
    }

    const oldIds = new Set<string>();
    for (const [id] of oldMap) {
      if (id && id !== String(ownerId)) oldIds.add(id);
    }

    let cleanedParticipants: ParticipantDoc[] = oldParticipants.map((p) => ({ ...p }));
    let participantsChanged = false;
    let addedIds: string[] = [];
    let warning: string | undefined;

    if (hasGuestParticipants) {
      warning =
        "บิลนี้มี guest/guest placeholder อยู่แล้ว ระบบจึงอัปเดตได้เฉพาะรายละเอียดบิล และจะไม่แก้ participants เพื่อป้องกันข้อมูลสลิปหาย";
    } else if (effectiveSplitType === "personal") {
      warning =
        "บิลประเภท personal จะคง participants เดิมจากการแมปรายการอาหาร และจะไม่แก้ผู้ร่วมบิลจากหน้านี้";
    } else {
      if (!Array.isArray(body.participants) || body.participants.length === 0) {
        return NextResponse.json(
          { error: "participants is required" },
          { status: 400 },
        );
      }

      cleanedParticipants = body.participants
        .filter((p) => p.userId && p.name)
        .map((p) => {
          const id = String(p.userId);
          const old = oldMap.get(id);

          const isOwnerRow = id === String(ownerId);
          const nextStatus: PaymentStatus = (
            isOwnerRow
              ? "paid"
              : (p.paymentStatus ?? old?.paymentStatus ?? "unpaid")
          ) as PaymentStatus;

          const next: ParticipantDoc = {
            userId: id,
            name: String(p.name).trim(),
            amount: Number(p.amount) || 0,
            paymentStatus: nextStatus,
            slipInfo: old?.slipInfo,
            paidAt: old?.paidAt,
          };

          if (next.paymentStatus === "paid" && !next.paidAt) {
            next.paidAt = new Date();
          }
          if (next.paymentStatus !== "paid") {
            next.paidAt = undefined;
          }

          return next;
        })
        .filter((p) => p.name.length > 0 && Number.isFinite(p.amount));

      const newMap = new Map<
        string,
        { amount: number; paymentStatus: PaymentStatus }
      >();

      for (const p of cleanedParticipants) {
        const id = toIdString(p.userId);
        if (!id) continue;
        newMap.set(id, {
          amount: Number(p.amount) || 0,
          paymentStatus: (p.paymentStatus ?? "unpaid") as PaymentStatus,
        });
      }

      const newIds = new Set<string>();
      for (const id of newMap.keys()) {
        if (id && id !== String(ownerId)) newIds.add(id);
      }

      addedIds = [];
      for (const id of newIds) {
        if (!oldIds.has(id)) addedIds.push(id);
      }

      if (oldIds.size !== newIds.size) {
        participantsChanged = true;
      } else {
        for (const id of newIds) {
          if (!oldIds.has(id)) {
            participantsChanged = true;
            break;
          }
          const old = oldMap.get(id);
          const neu = newMap.get(id);
          const oldAmount = Number(old?.amount ?? 0) || 0;
          const oldStatus = (old?.paymentStatus ?? "unpaid") as PaymentStatus;
          const newAmount = Number(neu?.amount ?? 0) || 0;
          const newStatus = (neu?.paymentStatus ?? "unpaid") as PaymentStatus;
          if (oldAmount !== newAmount || oldStatus !== newStatus) {
            participantsChanged = true;
            break;
          }
        }
      }

      const hasOwner = cleanedParticipants.some(
        (p) => toIdString(p.userId) === String(ownerId),
      );

      if (!hasOwner) {
        const oldOwner = oldMap.get(String(ownerId));
        cleanedParticipants.push(
          oldOwner
            ? { ...oldOwner, paymentStatus: "paid" }
            : {
                userId: String(ownerId),
                name:
                  (session?.user as { name?: string } | undefined)?.name ??
                  "Owner",
                amount: 0,
                paymentStatus: "paid",
              },
        );
      }
    }

    billDoc.title = nextTitle;
    billDoc.description = nextDescription;
    billDoc.items = cleanedItems as unknown as typeof billDoc.items;
    billDoc.totalPrice = finalTotal;

    if (body.splitType) {
      billDoc.splitType = body.splitType;
    }

    if (!hasGuestParticipants) {
      billDoc.participants =
        cleanedParticipants as unknown as typeof billDoc.participants;
    }

    billDoc.billStatus = computeBillStatusHybrid(
      cleanedParticipants,
      String(ownerId),
    );

    await billDoc.save();

    const itemsSigNow = cleanedItems
      .map((it) => `${String(it.items ?? "").trim()}:${Number(it.price) || 0}`)
      .join("|");

    const titleChanged = prevTitle.trim() !== nextTitle.trim();
    const descChanged = prevDesc.trim() !== nextDescription.trim();
    const itemsChanged = prevItemsSig !== itemsSigNow;
    const totalChanged = prevTotal !== finalTotal;
    const splitChanged =
      (prevSplit ?? "") !== ((billDoc.splitType as unknown as string) ?? "");

    const hintParts: string[] = [];
    if (titleChanged) hintParts.push("ชื่อบิล");
    if (itemsChanged) hintParts.push("เมนู/ราคา");
    if (totalChanged) hintParts.push("ยอดรวม");
    if (splitChanged) hintParts.push("วิธีหาร");
    if (participantsChanged) hintParts.push("สมาชิก/จำนวนเงิน");
    if (descChanged) hintParts.push("คำอธิบาย");

    const hint = hintParts.length > 0 ? hintParts.join(", ") : "แก้ไขข้อมูลบิล";

    try {
      await notifyBillUpdated({ billId, actorUserId: sessionUserId, hint });
    } catch (err) {
      console.error("⚠️ notifyBillUpdated failed:", err);
    }

    if (!hasGuestParticipants && addedIds.length > 0) {
      try {
        await notifyBillAddedYou({ billId, actorUserId: sessionUserId });
      } catch (err) {
        console.error("⚠️ notifyBillAddedYou (on edit) failed:", err);
      }
    }

    const nextBillStatus =
      (billDoc.billStatus as unknown as PaymentStatus) ?? "unpaid";
    if (prevBillStatus !== "paid" && nextBillStatus === "paid") {
      try {
        await notifyBillClosed({ billId });
      } catch (err) {
        console.error("⚠️ notifyBillClosed failed:", err);
      }
    }

    const updated = await Bill.findById(billId)
      .populate("createdBy", "name email bank bankAccountNumber promptPayPhone")
      .populate("participants.userId", "name email")
      .lean();

    return NextResponse.json(
      { bill: updated, warning },
      { status: 200 },
    );
  } catch (error) {
    console.error("❌ Error updating bill:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ billId: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    const sessionUserId = (session?.user as { id?: string } | undefined)?.id;

    if (!sessionUserId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { billId } = await ctx.params;

    await connectMongoDB();

    const billDoc = await Bill.findById(billId);
    if (!billDoc) {
      return NextResponse.json({ error: "Bill not found" }, { status: 404 });
    }

    const ownerId = toIdString(billDoc.createdBy as unknown as IdLike);
    const isOwner = String(sessionUserId) === String(ownerId);
    if (!isOwner) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await Bill.deleteOne({ _id: billId });

    return NextResponse.json(
      { message: "Bill deleted successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("❌ Error deleting bill:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}