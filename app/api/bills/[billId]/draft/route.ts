import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import User from "@/models/user";

type SplitType = "equal" | "percentage" | "personal";
type ParticipantKind = "user" | "guest_placeholder" | "guest";
type PaymentStatus = "unpaid" | "paid";

type UpdateDraftBillBody = {
  title?: string;
  splitType?: SplitType;
  description?: string;
  items?: Array<{
    items?: string;
    qty?: number;
    unit_price?: number;
    price?: number;
    line_total?: number;
  }>;
  participants?: Array<{
    participantId?: string;
    kind?: ParticipantKind;
    userId?: string;
    guestId?: string;
    name: string;
    amount?: number;
    percent?: number | "";
  }>;
  totalPrice?: number;
};

type SlipInfoInput = {
  imageUrl?: string;
  publicId?: string;
  provider?: string;
  reference?: string;
  checkedAt?: Date;
  verified?: boolean;
};

type ExistingParticipantLike = {
  _id?: unknown;
  kind?: unknown;
  userId?: unknown;
  guestId?: unknown;
  name?: unknown;
  amount?: unknown;
  paymentStatus?: unknown;
  slipInfo?: {
    imageUrl?: string;
    publicId?: string;
    provider?: string;
    reference?: string;
    checkedAt?: Date;
    verified?: boolean;
  };
  paidAt?: Date;
  joinedAt?: Date;
};

type UserParticipantInput = {
  _id?: unknown;
  kind: "user";
  userId: string;
  name: string;
  amount: number;
  paymentStatus: PaymentStatus;
  slipInfo?: SlipInfoInput;
  paidAt?: Date;
  joinedAt?: Date;
};

type GuestPlaceholderParticipantInput = {
  _id?: unknown;
  kind: "guest_placeholder";
  name: string;
  amount: number;
  paymentStatus: PaymentStatus;
  joinedAt?: Date;
};

type GuestParticipantInput = {
  _id?: unknown;
  kind: "guest";
  guestId: mongoose.Types.ObjectId;
  name: string;
  amount: number;
  paymentStatus: PaymentStatus;
  slipInfo?: SlipInfoInput;
  paidAt?: Date;
  joinedAt?: Date;
};

type ParticipantInput =
  | UserParticipantInput
  | GuestPlaceholderParticipantInput
  | GuestParticipantInput;

type DraftItemInput = {
  items: string;
  qty: number;
  unitPrice: number;
  price: number;
  splitMode: "equal";
  assignedParticipantIds: string[];
};

type RouteContext = {
  params: Promise<{ billId: string }>;
};

const DRAFT_EXPIRE_HOURS = 24;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const money = (n: number) => {
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
};

const toNumber = (v: unknown, fallback = 0) => {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const clampName = (v: unknown) =>
  String(v ?? "")
    .trim()
    .slice(0, 80);

function idToString(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "toString" in v) {
    const fn = (v as { toString?: unknown }).toString;
    if (typeof fn === "function") return String(fn.call(v));
  }
  return "";
}

function copySlipInfo(
  slip?: ExistingParticipantLike["slipInfo"],
): SlipInfoInput | undefined {
  if (!slip) return undefined;
  return {
    imageUrl: slip.imageUrl,
    publicId: slip.publicId,
    provider: slip.provider,
    reference: slip.reference,
    checkedAt: slip.checkedAt,
    verified: slip.verified,
  };
}

function computeBillStatusHybrid(
  participants: ParticipantInput[],
  ownerId: string,
): "unpaid" | "pending" | "paid" {
  const others = participants.filter((p) => {
    if (p.kind === "user" && p.userId === ownerId) return false;
    return true;
  });

  if (others.length === 0) return "paid";
  if (others.every((p) => p.paymentStatus === "paid")) return "paid";
  if (others.some((p) => p.paymentStatus === "paid")) return "pending";
  return "unpaid";
}

export async function PATCH(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { billId } = await context.params;

    if (!mongoose.Types.ObjectId.isValid(billId)) {
      return NextResponse.json({ error: "billId ไม่ถูกต้อง" }, { status: 400 });
    }

    const body = (await req.json()) as UpdateDraftBillBody;

    await connectMongoDB();

    const me = await User.findOne({ email: session.user.email }).lean<{
      _id: mongoose.Types.ObjectId;
      name?: string;
      email?: string;
    } | null>();

    if (!me?._id) {
      return NextResponse.json(
        { error: "ไม่พบผู้ใช้เจ้าของบิล" },
        { status: 404 },
      );
    }

    const draftBill = await Bill.findById(billId);

    if (!draftBill) {
      return NextResponse.json({ error: "ไม่พบ draft bill" }, { status: 404 });
    }

    if (String(draftBill.createdBy) !== String(me._id)) {
      return NextResponse.json(
        { error: "ไม่มีสิทธิ์แก้ draft bill นี้" },
        { status: 403 },
      );
    }

    if (draftBill.stage !== "draft") {
      return NextResponse.json(
        { error: "บิลนี้ไม่ได้อยู่ในสถานะ draft" },
        { status: 400 },
      );
    }

    const nextSplitType: SplitType =
      body.splitType &&
      ["equal", "percentage", "personal"].includes(body.splitType)
        ? body.splitType
        : (draftBill.splitType as SplitType);

    const title =
      clampName(body.title) ||
      clampName(draftBill.title) ||
      `Draft Bill ${new Date().toLocaleString("th-TH")}`;

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const cleanedItems: DraftItemInput[] = rawItems
      .map((it): DraftItemInput | null => {
        const name = clampName(it?.items);
        if (!name) return null;

        const qty = Math.max(1, Math.trunc(toNumber(it?.qty, 1)));
        const unitPrice = money(toNumber(it?.unit_price, 0));

        const lineTotal = money(
          toNumber(it?.line_total, 0) > 0
            ? toNumber(it?.line_total, 0)
            : toNumber(it?.price, 0) > 0
              ? toNumber(it?.price, 0)
              : qty * unitPrice,
        );

        return {
          items: name,
          qty,
          unitPrice,
          price: lineTotal,
          splitMode: "equal",
          assignedParticipantIds: [],
        };
      })
      .filter((x): x is DraftItemInput => x !== null);

    const rawParticipants = Array.isArray(body.participants)
      ? body.participants
      : [];

    const existingParticipants = Array.isArray(draftBill.participants)
      ? (draftBill.participants as ExistingParticipantLike[])
      : [];

    const findExistingParticipant = (input: {
      participantId?: string;
      kind?: ParticipantKind;
      userId?: string;
      guestId?: string;
      name?: string;
    }) => {
      if (input.participantId) {
        const byId = existingParticipants.find(
          (p) => idToString(p._id) === input.participantId,
        );
        if (byId) return byId;
      }

      if (input.kind === "user" && input.userId) {
        return existingParticipants.find(
          (p) => p.kind === "user" && idToString(p.userId) === input.userId,
        );
      }

      if (input.kind === "guest" && input.guestId) {
        return existingParticipants.find(
          (p) => p.kind === "guest" && idToString(p.guestId) === input.guestId,
        );
      }

      if (
        (input.kind === "guest_placeholder" || input.kind === "guest") &&
        input.name
      ) {
        const inputName = input.name.toLowerCase();
        return existingParticipants.find((p) => {
          const oldName = clampName(p.name).toLowerCase();
          const oldKind = p.kind;
          return (
            oldName === inputName &&
            (oldKind === "guest_placeholder" || oldKind === "guest")
          );
        });
      }

      return undefined;
    };

    const mergedParticipants: ParticipantInput[] = [];
    const seenUserIds = new Set<string>();
    const seenGuestIds = new Set<string>();
    const seenPlaceholderKeys = new Set<string>();

    for (const p of rawParticipants) {
      const kind = p?.kind;
      const participantId = String(p?.participantId ?? "").trim();
      const userId = String(p?.userId ?? "").trim();
      const guestId = String(p?.guestId ?? "").trim();
      const name = clampName(p?.name);
      const amount = money(toNumber(p?.amount, 0));

      if (!name) continue;

      const old = findExistingParticipant({
        participantId,
        kind,
        userId,
        guestId,
        name,
      });

      if (kind === "user") {
        if (!userId || seenUserIds.has(userId)) continue;
        seenUserIds.add(userId);

        mergedParticipants.push({
          _id: old?._id,
          kind: "user",
          userId,
          name,
          amount,
          paymentStatus:
            old?.paymentStatus === "paid" || userId === String(me._id)
              ? "paid"
              : "unpaid",
          slipInfo: copySlipInfo(old?.slipInfo),
          paidAt: old?.paidAt,
          joinedAt: old?.joinedAt,
        });
        continue;
      }

      if (kind === "guest_placeholder") {
        const placeholderKey = participantId || name.toLowerCase();
        if (seenPlaceholderKeys.has(placeholderKey)) continue;
        seenPlaceholderKeys.add(placeholderKey);

        if (old?.kind === "guest" && old.guestId) {
          const oldGuestId = idToString(old.guestId);
          if (!oldGuestId || seenGuestIds.has(oldGuestId)) continue;

          seenGuestIds.add(oldGuestId);

          mergedParticipants.push({
            _id: old._id,
            kind: "guest",
            guestId: new mongoose.Types.ObjectId(oldGuestId),
            name: clampName(old.name) || name,
            amount,
            paymentStatus: old.paymentStatus === "paid" ? "paid" : "unpaid",
            slipInfo: copySlipInfo(old.slipInfo),
            paidAt: old.paidAt,
            joinedAt: old.joinedAt,
          });
          continue;
        }

        mergedParticipants.push({
          _id: old?._id,
          kind: "guest_placeholder",
          name,
          amount,
          paymentStatus: "unpaid",
          joinedAt: old?.joinedAt,
        });
        continue;
      }

      if (kind === "guest") {
        const effectiveGuestId = guestId || idToString(old?.guestId);
        if (!effectiveGuestId || seenGuestIds.has(effectiveGuestId)) continue;

        seenGuestIds.add(effectiveGuestId);

        mergedParticipants.push({
          _id: old?._id,
          kind: "guest",
          guestId: new mongoose.Types.ObjectId(effectiveGuestId),
          name,
          amount,
          paymentStatus: old?.paymentStatus === "paid" ? "paid" : "unpaid",
          slipInfo: copySlipInfo(old?.slipInfo),
          paidAt: old?.paidAt,
          joinedAt: old?.joinedAt,
        });
      }
    }

    const ownerId = String(me._id);
    const oldOwner = existingParticipants.find(
      (p) => p.kind === "user" && idToString(p.userId) === ownerId,
    );

    if (
      !mergedParticipants.some((p) => p.kind === "user" && p.userId === ownerId)
    ) {
      mergedParticipants.unshift({
        _id: oldOwner?._id,
        kind: "user",
        userId: ownerId,
        name: clampName(me.name) || "You",
        amount: 0,
        paymentStatus: "paid",
        slipInfo: copySlipInfo(oldOwner?.slipInfo),
        paidAt: oldOwner?.paidAt,
        joinedAt: oldOwner?.joinedAt,
      });
    }

    let finalParticipants = [...mergedParticipants];

    const itemsTotal = money(cleanedItems.reduce((sum, it) => sum + it.price, 0));
    const effectiveTotal =
      money(toNumber(body.totalPrice, 0)) > 0
        ? money(toNumber(body.totalPrice, 0))
        : itemsTotal;

    if (effectiveTotal < 0) {
      return NextResponse.json(
        { error: "ยอดรวมต้องไม่น้อยกว่า 0 บาท" },
        { status: 400 },
      );
    }

    if (nextSplitType === "equal") {
      const count = finalParticipants.length;

      if (count > 0) {
        const share = money(effectiveTotal / count);

        finalParticipants = finalParticipants.map((p, index) => {
          if (index === count - 1) {
            const subtotal = money(share * (count - 1));
            return {
              ...p,
              amount: money(effectiveTotal - subtotal),
            };
          }

          return {
            ...p,
            amount: share,
          };
        });
      }
    }

    finalParticipants = finalParticipants.map((p) => {
      if (p.kind === "user" && p.userId === ownerId) {
        return {
          ...p,
          paymentStatus: "paid" as const,
        };
      }
      return p;
    });

    const nextBillStatus = computeBillStatusHybrid(finalParticipants, ownerId);

    const now = new Date();
    const draftExpiresAt = new Date(
      now.getTime() + DRAFT_EXPIRE_HOURS * 60 * 60 * 1000,
    );

    draftBill.set({
      title,
      description: String(body.description ?? "").trim(),
      items: cleanedItems,
      totalPrice: effectiveTotal,
      splitType: nextSplitType,
      participants: finalParticipants,
      billStatus: nextBillStatus,
      draftExpiresAt,
    });

    draftBill.markModified("participants");
    await draftBill.save();

    return NextResponse.json({
      ok: true,
      bill: draftBill,
    });
  } catch (error) {
    console.error("UPDATE DRAFT BILL ERROR:", error);
    return NextResponse.json(
      { error: "อัปเดต draft bill ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}