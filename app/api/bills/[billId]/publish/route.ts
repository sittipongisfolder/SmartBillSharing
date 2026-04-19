import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import mongoose from "mongoose";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import User from "@/models/user";
import { notifyBillAddedYou, notifyBillCreatedOwner } from "@/lib/notify";

type SplitType = "equal" | "percentage" | "personal";
type ParticipantKind = "user" | "guest_placeholder" | "guest";

type PublishBillBody = {
  title?: string;
  splitType?: SplitType;
  description?: string;
  items?: Array<{
    items: string;
    qty?: number;
    unit_price?: number;
    price?: number;
    line_total?: number;
    splitMode?: "equal" | "single" | "shared";
    assignedParticipantKeys?: string[];
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
  receiptImageUrl?: string;
  receiptImagePublicId?: string;
};

type RouteContext = {
  params: Promise<{ billId: string }>;
};

type SlipInfoInput = {
  imageUrl?: string;
  publicId?: string;
  provider?: string;
  reference?: string;
  checkedAt?: Date;
  verified?: boolean;
};

type UserParticipantInput = {
  _id?: mongoose.Types.ObjectId;
  kind: "user";
  userId: string;
  name: string;
  amount: number;
  paymentStatus: "unpaid" | "paid";
  slipInfo?: SlipInfoInput;
  paidAt?: Date;
  joinedAt?: Date;
};

type GuestPlaceholderParticipantInput = {
  _id?: mongoose.Types.ObjectId;
  kind: "guest_placeholder";
  name: string;
  amount: number;
  paymentStatus: "unpaid" | "paid";
  joinedAt?: Date;
};

type GuestParticipantInput = {
  _id?: mongoose.Types.ObjectId;
  kind: "guest";
  guestId: mongoose.Types.ObjectId;
  name: string;
  amount: number;
  paymentStatus: "unpaid" | "paid";
  slipInfo?: SlipInfoInput;
  paidAt?: Date;
  joinedAt?: Date;
};

type ParticipantInput =
  | UserParticipantInput
  | GuestPlaceholderParticipantInput
  | GuestParticipantInput;

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

function resolveParticipantObjectId(
  old: ExistingParticipantLike | undefined,
  participantId?: string,
): mongoose.Types.ObjectId | undefined {
  const oldId = idToString(old?._id);
  if (oldId && mongoose.Types.ObjectId.isValid(oldId)) {
    return new mongoose.Types.ObjectId(oldId);
  }

  if (participantId && mongoose.Types.ObjectId.isValid(participantId)) {
    return new mongoose.Types.ObjectId(participantId);
  }

  return undefined;
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

    const body = (await req.json()) as PublishBillBody;

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
        { error: "ไม่มีสิทธิ์ publish บิลนี้" },
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
        : draftBill.splitType;

    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json(
        { error: "กรุณากรอก Bill Title" },
        { status: 400 },
      );
    }

    type IntermediateItem = {
      items: string;
      qty: number;
      unitPrice: number;
      price: number;
      splitMode: "equal" | "single" | "shared";
      _rawKeys: string[];
    };
    const intermediateItems: IntermediateItem[] = Array.isArray(body.items)
      ? (body.items
          .map((it) => {
            const name = clampName(it?.items);
            if (!name) return null;

            const qty = Math.max(1, parseInt(String(it?.qty ?? 1), 10) || 1);
            const unitPrice = money(toNumber(it?.unit_price, 0));

            const lineTotal = money(
              toNumber(it?.line_total, 0) > 0
                ? toNumber(it?.line_total, 0)
                : toNumber(it?.price, 0) > 0
                  ? toNumber(it?.price, 0)
                  : qty * unitPrice,
            );

            const splitModeRaw = it?.splitMode;
            const splitMode: "equal" | "single" | "shared" =
              splitModeRaw === "single" || splitModeRaw === "shared"
                ? splitModeRaw
                : "equal";

            return {
              items: name,
              qty,
              unitPrice,
              price: lineTotal,
              splitMode,
              _rawKeys: Array.isArray(it?.assignedParticipantKeys)
                ? (it.assignedParticipantKeys as string[])
                : [],
            };
          })
          .filter((x): x is IntermediateItem => x !== null))
      : [];

    if (intermediateItems.length === 0) {
      return NextResponse.json(
        { error: "กรุณาเพิ่มรายการอาหารอย่างน้อย 1 รายการ" },
        { status: 400 },
      );
    }

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

      if (input.kind === "guest_placeholder" && input.name) {
        const inputName = input.name.toLowerCase();

        return existingParticipants.find(
          (p) =>
            p.kind === "guest_placeholder" &&
            clampName(p.name).toLowerCase() === inputName,
        );
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
          _id: resolveParticipantObjectId(old, participantId),
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

        // ✅ ถ้า slot นี้ถูก guest claim ไปแล้วใน draft ให้ preserve guest จริง
        if (old?.kind === "guest" && old.guestId) {
          const oldGuestId = idToString(old.guestId);
          if (!oldGuestId || seenGuestIds.has(oldGuestId)) continue;
          seenGuestIds.add(oldGuestId);

          mergedParticipants.push({
            _id: resolveParticipantObjectId(old, participantId),
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
          _id: resolveParticipantObjectId(old, participantId),
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
          _id: resolveParticipantObjectId(old, participantId),
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

    if (
      !mergedParticipants.some((p) => p.kind === "user" && p.userId === ownerId)
    ) {
      const oldOwner = existingParticipants.find(
        (p) => p.kind === "user" && idToString(p.userId) === ownerId,
      );

      mergedParticipants.unshift({
        _id: resolveParticipantObjectId(oldOwner),
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

    if (mergedParticipants.length === 0) {
      return NextResponse.json(
        { error: "กรุณาเลือก Participants อย่างน้อย 1 คน" },
        { status: 400 },
      );
    }

    // ✅ ยังมี guest slot ที่ยังไม่มีคน claim อยู่
    const pendingGuestSlots = mergedParticipants.filter(
      (p) => p.kind === "guest_placeholder",
    );

    if (pendingGuestSlots.length > 0) {
      return NextResponse.json(
        {
          error:
            "ยังมี Guest Slot ที่ยังไม่ได้เข้าร่วม กรุณาให้ guest เข้าร่วมให้ครบ หรือเอา slot ที่ไม่ใช้ออกก่อนเปิดบิล",
        },
        { status: 400 },
      );
    }

    const itemsTotal = money(
      intermediateItems.reduce((sum, it) => sum + it.price, 0),
    );
    const effectiveTotal =
      money(toNumber(body.totalPrice, 0)) > 0
        ? money(toNumber(body.totalPrice, 0))
        : itemsTotal;

    if (!(effectiveTotal > 0)) {
      return NextResponse.json(
        { error: "ยอดรวมต้องมากกว่า 0 บาท" },
        { status: 400 },
      );
    }

    let finalParticipants: ParticipantInput[] = [...mergedParticipants];

    if (nextSplitType === "equal") {
      const count = finalParticipants.length;
      const share = count > 0 ? money(effectiveTotal / count) : 0;

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

    // ✅ owner paid เสมอ
    finalParticipants = finalParticipants.map((p) => {
      if (p.kind === "user" && p.userId === ownerId) {
        return {
          ...p,
          paymentStatus: "paid" as const,
        };
      }
      return {
        ...p,
        paymentStatus: p.paymentStatus === "paid" ? "paid" : "unpaid",
      };
    });

    // Ensure every participant has _id before resolving assignedParticipantIds
    finalParticipants = finalParticipants.map((p) =>
      p._id ? p : { ...p, _id: new mongoose.Types.ObjectId() },
    ) as ParticipantInput[];

    // ✅ hybrid bill status: ไม่นับ owner แต่นับ guest
    const others = finalParticipants.filter((p) => {
      if (p.kind === "user" && p.userId === ownerId) return false;
      return true;
    });

    const nextBillStatus: "unpaid" | "pending" | "paid" =
      others.length === 0
        ? "paid"
        : others.every((p) => p.paymentStatus === "paid")
          ? "paid"
          : others.some((p) => p.paymentStatus === "paid")
            ? "pending"
            : "unpaid";

    // Build stable-key → participant._id map for resolving assignedParticipantIds
    const participantKeyToId = new Map<string, string>();
    for (const p of finalParticipants) {
      const pid = idToString(p._id);
      if (!pid) continue;
      if (p.kind === "user") {
        participantKeyToId.set(`user:${p.userId}`, pid);
      } else if (p.kind === "guest") {
        const gid = idToString(p.guestId);
        if (gid) participantKeyToId.set(`guest:${gid}`, pid);
      } else if (p.kind === "guest_placeholder") {
        participantKeyToId.set(
          `placeholder:${clampName(p.name).toLowerCase()}`,
          pid,
        );
      }
    }

    // Resolve items: strip _rawKeys and fill real assignedParticipantIds
    const resolvedItems = intermediateItems.map(({ _rawKeys, ...item }) => ({
      ...item,
      assignedParticipantIds: _rawKeys
        .map((key) => participantKeyToId.get(key))
        .filter((id): id is string => id !== undefined),
    }));

    const incomingReceiptUrl = (body.receiptImageUrl ?? "").trim();
    const incomingReceiptPublicId = (body.receiptImagePublicId ?? "").trim();

    draftBill.set({
      title,
      description: String(body.description ?? "").trim(),
      items: resolvedItems,
      totalPrice: effectiveTotal,
      splitType: nextSplitType,
      participants: finalParticipants,
      stage: "active",
      publishedAt: new Date(),
      billStatus: nextBillStatus,
      ...(incomingReceiptUrl ? { receiptImageUrl: incomingReceiptUrl } : {}),
      ...(incomingReceiptPublicId ? { receiptImagePublicId: incomingReceiptPublicId } : {}),
    });

    // ✅ ลบ field draftExpiresAt ออก
    draftBill.set("draftExpiresAt", undefined);

    await draftBill.save();

    try {
      await notifyBillAddedYou({
        billId: draftBill._id,
        actorUserId: me._id,
      });
    } catch (notifyError) {
      console.error("NOTIFY AFTER PUBLISH ERROR:", notifyError);
    }

    try {
      await notifyBillCreatedOwner({
        billId: draftBill._id,
        ownerUserId: me._id,
      });
    } catch (notifyError) {
      console.error("NOTIFY OWNER AFTER PUBLISH ERROR:", notifyError);
    }

    return NextResponse.json({
      ok: true,
      bill: draftBill,
    });
  } catch (error) {
    console.error("PUBLISH BILL ERROR:", error);
    return NextResponse.json(
      { error: "publish bill ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}
