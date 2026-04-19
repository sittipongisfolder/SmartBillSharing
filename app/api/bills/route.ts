import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import Bill from "@/models/bill";
import { connectMongoDB } from "@/lib/mongodb";
import { notifyBillAddedYou, notifyBillCreatedOwner } from "@/lib/notify";

type ParticipantPaymentStatus = "unpaid" | "paid";
type BillStatus = "unpaid" | "pending" | "paid";
type SplitType = "equal" | "percentage" | "personal";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface CreateBillBody {
  title: string;
  items: Array<{
    items: string;
    price: number | string;
    splitMode?: "equal" | "single" | "shared";
    assignedParticipantKeys?: string[];
  }>;
  totalPrice?: number | string;
  splitType: SplitType;
  participants: Array<{
    userId: string;
    name: string;
    amount: number | string;
    paymentStatus?: ParticipantPaymentStatus | "pending";
  }>;
  description?: string;

  // ✅ เพิ่ม 2 field นี้
  receiptImageUrl?: string;
  receiptImagePublicId?: string;
}

// ✅ แปลงข้อมูลเก่า: pending -> paid (กันพังถ้ามี record เก่า)
function normalizeParticipantStatus(v: unknown): ParticipantPaymentStatus {
  if (v === "paid" || v === "pending") return "paid";
  return "unpaid";
}

// ✅ helper: แปลง id ให้เป็น string แบบปลอดภัย (รองรับ populate)
function toIdString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;

  if (typeof v === "object" && v !== null) {
    if ("_id" in v) {
      const idVal = (v as { _id?: unknown })._id;
      if (idVal) return String(idVal);
    }
    if (
      "toString" in v &&
      typeof (v as { toString?: unknown }).toString === "function"
    ) {
      return (v as { toString(): string }).toString();
    }
  }

  return "";
}

// ✅ Hybrid: คิด billStatus จาก “ลูกบิล” เท่านั้น (ไม่นับ createdBy)
// ✅ FIX: ข้าม userId ว่าง/undefined และรองรับ populate object
function computeBillStatusHybrid(
  participants: Array<{ userId?: unknown; paymentStatus?: unknown }>,
  createdById: string,
): BillStatus {
  const others = participants.filter((p) => {
    const pid = toIdString(p.userId);
    if (!pid) return false;
    return pid !== String(createdById);
  });

  if (others.length === 0) return "paid";

  const statuses = others.map((p) =>
    normalizeParticipantStatus(p.paymentStatus),
  );

  if (statuses.every((s) => s === "paid")) return "paid";
  if (statuses.some((s) => s === "paid")) return "pending";
  return "unpaid";
}

function getCreatedById(createdBy: unknown): string {
  return toIdString(createdBy);
}

export async function GET() {
  try {
    await connectMongoDB();

    const bills = await Bill.find({ stage: { $ne: "draft" } })
      .populate("createdBy", "name email")
      .populate("participants.userId", "name email")
      .sort({ createdAt: -1 })
      .lean();

    const mapped = bills.map((b) => {
      const bill = b as unknown as {
        billStatus?: BillStatus;
        participants?: Array<{ userId?: unknown; paymentStatus?: unknown }>;
        createdBy?: unknown;
        receiptImageUrl?: string;
        receiptImagePublicId?: string;
      };

      const createdById = getCreatedById(bill.createdBy);
      const fallbackStatus = computeBillStatusHybrid(
        bill.participants ?? [],
        createdById,
      );

      return {
        ...b,
        billStatus: bill.billStatus ?? fallbackStatus,
      };
    });

    return NextResponse.json({ bills: mapped }, { status: 200 });
  } catch (error) {
    console.error("❌ Error fetching bills:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = session.user as SessionUserWithId;
    const userId = user.id;
    if (!userId) {
      return NextResponse.json(
        { error: "Unauthorized: User ID missing" },
        { status: 401 },
      );
    }

    const body = (await req.json()) as CreateBillBody;

    // ✅ ดึง receiptImageUrl / receiptImagePublicId ออกมาด้วย
    const {
      title,
      items,
      totalPrice,
      splitType,
      participants,
      description,
      receiptImageUrl,
      receiptImagePublicId,
    } = body;

    await connectMongoDB();

    const cleanedTitle = (title || "").trim();
    if (!cleanedTitle)
      return NextResponse.json({ error: "title is required" }, { status: 400 });

    if (!splitType)
      return NextResponse.json(
        { error: "splitType is required" },
        { status: 400 },
      );

    const cleanedParticipants = (Array.isArray(participants) ? participants : [])
      .filter((p) => p.userId && p.name)
      .map((p) => {
        const isOwner = String(p.userId) === String(userId);
        return {
          _id: new mongoose.Types.ObjectId(),
          userId: p.userId,
          name: p.name,
          amount: Number(p.amount) || 0,
          paymentStatus: (isOwner ? "paid" : "unpaid") as ParticipantPaymentStatus,
        };
      });

    if (cleanedParticipants.length === 0) {
      return NextResponse.json(
        { error: "participants is required" },
        { status: 400 },
      );
    }

    // Build userId → participant._id map for resolving assignedParticipantIds
    const userIdToParticipantId = new Map<string, string>();
    for (const p of cleanedParticipants) {
      userIdToParticipantId.set(String(p.userId), String(p._id));
    }

    const cleanedItems = (Array.isArray(items) ? items : [])
      .map((it) => {
        const name = (it.items || "").trim();
        const price = Number(it.price) || 0;
        if (!name || !(price > 0)) return null;

        const splitModeRaw = it.splitMode;
        const splitMode: "equal" | "single" | "shared" =
          splitModeRaw === "single" || splitModeRaw === "shared"
            ? splitModeRaw
            : "equal";

        const rawKeys = Array.isArray(it.assignedParticipantKeys)
          ? it.assignedParticipantKeys
          : [];
        const assignedParticipantIds = rawKeys
          .map((key) => {
            if (key.startsWith("user:"))
              return userIdToParticipantId.get(key.slice(5)) ?? null;
            return null;
          })
          .filter((id): id is string => id !== null);

        return { items: name, price, splitMode, assignedParticipantIds };
      })
      .filter(
        (it): it is {
          items: string;
          price: number;
          splitMode: "equal" | "single" | "shared";
          assignedParticipantIds: string[];
        } => it !== null,
      );

    if (cleanedItems.length === 0) {
      return NextResponse.json(
        { error: "items must have at least 1 row (items+price)" },
        { status: 400 },
      );
    }

    const itemsTotal = cleanedItems.reduce((sum, it) => sum + it.price, 0);
    const finalTotal =
      Number(totalPrice) && Number(totalPrice) > 0
        ? Number(totalPrice)
        : itemsTotal;

    if (!(finalTotal > 0)) {
      return NextResponse.json(
        { error: "totalPrice must be greater than 0" },
        { status: 400 },
      );
    }

    const billStatus = computeBillStatusHybrid(cleanedParticipants, userId);

    const newBill = await Bill.create({
      title: cleanedTitle,
      items: cleanedItems,
      totalPrice: finalTotal,
      splitType,
      participants: cleanedParticipants,
      description: description || "",

      // ✅ บันทึกรูปบิลลง DB
      receiptImageUrl: (receiptImageUrl || "").trim(),
      receiptImagePublicId: receiptImagePublicId || undefined,

      createdBy: userId,
      createdAt: new Date(),
      billStatus,
    });

    try {
      await notifyBillAddedYou({ billId: newBill._id, actorUserId: userId });
    } catch (err) {
      console.error("⚠️ notifyBillAddedYou failed:", err);
    }

    try {
      await notifyBillCreatedOwner({ billId: newBill._id, ownerUserId: userId });
    } catch (err) {
      console.error("⚠️ notifyBillCreatedOwner failed:", err);
    }

    return NextResponse.json(
      { message: "Bill created successfully", bill: newBill },
      { status: 201 },
    );
  } catch (error) {
    console.error("❌ Error creating bill:", error);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}