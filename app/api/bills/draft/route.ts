import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import User from "@/models/user";

type SplitType = "equal" | "percentage" | "personal";
type ParticipantKind = "user" | "guest_placeholder" | "guest";

type CreateDraftBillBody = {
  title?: string;
  splitType: SplitType;
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

type DraftParticipantInput =
  | {
      kind: "user";
      userId: string;
      name: string;
      amount: number;
      paymentStatus: "unpaid" | "paid";
      joinedAt?: Date;
    }
  | {
      kind: "guest_placeholder";
      name: string;
      amount: number;
      paymentStatus: "unpaid" | "paid";
      joinedAt?: Date;
    }
  | {
      kind: "guest";
      guestId: string;
      name: string;
      amount: number;
      paymentStatus: "unpaid" | "paid";
      joinedAt?: Date;
    };

type DraftItemInput = {
  items: string;
  qty: number;
  unitPrice: number;
  price: number;
  splitMode: "equal";
  assignedParticipantIds: string[];
};

const DRAFT_EXPIRE_HOURS = 0.2;

const toNumber = (v: unknown, fallback = 0) => {
  const n =
    typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const money = (n: number) => {
  if (!Number.isFinite(n) || n < 0) return 0;
  return round2(n);
};

const clampName = (v: unknown) =>
  String(v ?? "")
    .trim()
    .slice(0, 80);

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json()) as CreateDraftBillBody;

    if (
      !body?.splitType ||
      !["equal", "percentage", "personal"].includes(body.splitType)
    ) {
      return NextResponse.json(
        { error: "splitType ไม่ถูกต้อง" },
        { status: 400 },
      );
    }

    await connectMongoDB();

    const me = await User.findOne({ email: session.user.email }).lean<{
      _id: string;
      name?: string;
      email?: string;
    } | null>();

    if (!me?._id) {
      return NextResponse.json(
        { error: "ไม่พบผู้ใช้เจ้าของบิล" },
        { status: 404 },
      );
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const cleanedItems = rawItems
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

    const ownerParticipant: DraftParticipantInput = {
      kind: "user",
      userId: String(me._id),
      name: clampName(me.name) || "You",
      amount: 0,
      paymentStatus: "paid",
    };

    const seenUserIds = new Set<string>([String(me._id)]);
    const seenGuestPlaceholderNames = new Set<string>();
    const seenGuestIds = new Set<string>();

    const cleanedParticipants: DraftParticipantInput[] = [];

    for (const p of rawParticipants) {
      const kind = p?.kind;
      const name = clampName(p?.name);
      const amount = money(toNumber(p?.amount, 0));

      if (!name) continue;

      if (kind === "user") {
        const userId = String(p?.userId ?? "").trim();
        if (!userId || seenUserIds.has(userId)) continue;

        seenUserIds.add(userId);
        cleanedParticipants.push({
          kind: "user",
          userId,
          name,
          amount,
          paymentStatus: userId === String(me._id) ? "paid" : "unpaid",
        });
        continue;
      }

      if (kind === "guest_placeholder") {
        const dedupeKey = name.toLowerCase();
        if (seenGuestPlaceholderNames.has(dedupeKey)) continue;

        seenGuestPlaceholderNames.add(dedupeKey);
        cleanedParticipants.push({
          kind: "guest_placeholder",
          name,
          amount,
          paymentStatus: "unpaid",
        });
        continue;
      }

      if (kind === "guest") {
        const guestId = String(p?.guestId ?? "").trim();
        if (!guestId || seenGuestIds.has(guestId)) continue;

        seenGuestIds.add(guestId);
        cleanedParticipants.push({
          kind: "guest",
          guestId,
          name,
          amount,
          paymentStatus: "unpaid",
        });
      }
    }

    let participants: DraftParticipantInput[] = [
      ownerParticipant,
      ...cleanedParticipants,
    ];

    const itemsTotal = money(
      cleanedItems.reduce((sum, it) => sum + it.price, 0),
    );

    const totalPrice =
      money(toNumber(body.totalPrice, 0)) > 0
        ? money(toNumber(body.totalPrice, 0))
        : itemsTotal;

    if (body.splitType === "equal") {
      const count = participants.length;

      if (count > 0) {
        const share = money(totalPrice / count);

        participants = participants.map((p, index) => {
          if (index === count - 1) {
            const subtotal = money(share * (count - 1));
            return {
              ...p,
              amount: money(totalPrice - subtotal),
            };
          }

          return {
            ...p,
            amount: share,
          };
        });
      }
    }

    const draftTitle =
      clampName(body.title) ||
      `Draft Bill ${new Date().toLocaleString("th-TH")}`;

    const now = new Date();
    const draftExpiresAt = new Date(
      now.getTime() + DRAFT_EXPIRE_HOURS * 60 * 60 * 1000,
    );

    const draftBill = await Bill.create({
      title: draftTitle,
      items: cleanedItems,
      totalPrice,
      splitType: body.splitType,
      participants,
      description: String(body.description ?? "").trim(),
      createdBy: me._id,
      createdAt: now,
      stage: "draft",
      billStatus: "unpaid",
      draftExpiresAt,
    });

    return NextResponse.json(
      {
        ok: true,
        bill: draftBill,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("CREATE DRAFT BILL ERROR:", error);
    return NextResponse.json(
      { error: "สร้าง draft bill ไม่สำเร็จ" },
      { status: 500 },
    );
  }
}