import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import Bill from "@/models/bill";
import Guest from "@/models/guest";
import GuestAccessLink from "@/models/guestAccessLink";
import type { HydratedDocument } from "mongoose";
import { createHash } from "crypto";
import { cloudinary } from "@/lib/cloudinary";
import { Readable } from "stream";
import type { UploadApiResponse, UploadApiErrorResponse } from "cloudinary";
import {
  notifyBillStatusChanged,
  notifyGuestPaidToOwner,
  notifyBillClosed,
} from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ✅ ลูกบิลไม่มี pending
type ParticipantStatus = "unpaid" | "paid";
// ✅ billStatus มี pending ได้
type BillStatus = "unpaid" | "pending" | "paid";

type IdLike = string | { toString(): string };

type SlipInfoDb = {
  imageUrl: string;
  publicId: string;
  provider: "slipok";
  reference: string; // ใช้ transRef กันซ้ำ
  checkedAt: Date;
  verified: boolean;
};

type SlipInfoRes = {
  imageUrl: string;
  publicId: string;
  provider: "slipok";
  reference: string;
  checkedAt: string; // ISO
  verified: boolean;
};

type ParticipantDoc = {
  userId?: IdLike;
  guestId?: IdLike;
  kind?: "user" | "guest_placeholder" | "guest";
  name?: string;
  amount: number;
  paymentStatus: ParticipantStatus;
  slipInfo?: SlipInfoDb;
  paidAt?: Date;
};

type OwnerPopulated = {
  _id: IdLike;
  name?: string;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
};

type BillDocFields = {
  createdBy: IdLike | OwnerPopulated;
  participants: ParticipantDoc[];
  billStatus: BillStatus;
};

type BillHydrated = HydratedDocument<BillDocFields>;

type SlipCheckOk = {
  ok: true;
  message: string;
  billId: string;
  billStatus: BillStatus;
  checks: {
    qrValid: boolean;
    receiverMatched: boolean;
    nameMatched: boolean;
    amountMatched: boolean;
    duplicate: boolean;
  };
  slipok?: {
    receiverName?: string;
    receiverProxy?: string;
    receiverAccount?: string;
    transRef?: string;
    transTimestamp?: string;
    amount?: number;
  };
  updatedParticipant: {
    userId?: string;
    guestId?: string;
    paymentStatus: ParticipantStatus;
    slipInfo?: SlipInfoRes;
    paidAt?: string | null;
  };
};

type SlipCheckErr = { ok: false; message: string };
type SlipCheckResponse = SlipCheckOk | SlipCheckErr;

type GuestAccessLinkLean = {
  _id?: IdLike;
  guestId: IdLike;
  billId: IdLike;
  tokenHash: string;
  tokenLast4?: string;
  isActive?: boolean;
  expiresAt?: Date | null;
  createdAt?: Date;
  lastUsedAt?: Date | null;
};

type GuestLean = {
  _id?: IdLike;
  name?: string;
  displayName?: string;
  guestName?: string;
};

function bufferToStream(buffer: Buffer) {
  const readable = new Readable();
  readable.push(buffer);
  readable.push(null);
  return readable;
}

async function uploadSlipToCloudinary(args: {
  file: File;
  billId: string;
  actorKey: string;
  transRef: string;
}): Promise<{ imageUrl: string; publicId: string }> {
  const { file, billId, actorKey, transRef } = args;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const publicId = `${billId}_${actorKey}_${transRef}`;

  const result = await new Promise<UploadApiResponse>((resolve, reject) => {
    const upload = cloudinary.uploader.upload_stream(
      {
        folder: `smartbill/slips/${billId}`,
        public_id: publicId,
        resource_type: "image",
        overwrite: true,
      },
      (
        error: UploadApiErrorResponse | undefined,
        res: UploadApiResponse | undefined,
      ) => {
        if (error) return reject(error);
        if (!res) {
          return reject(new Error("Cloudinary upload failed: empty response"));
        }
        resolve(res);
      },
    );

    bufferToStream(buffer).pipe(upload);
  });

  return {
    imageUrl: result.secure_url,
    publicId: result.public_id,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toIdString(v: IdLike | null | undefined): string {
  if (!v) return "";
  return typeof v === "string" ? v : v.toString();
}

function digitsOnly(s?: string): string {
  return (s ?? "").replace(/\D/g, "");
}

function isOwnerPopulated(v: unknown): v is OwnerPopulated {
  if (!isObject(v)) return false;
  return "_id" in v;
}

function hashGuestAccessToken(rawToken: string): string {
  return createHash("sha256").update(rawToken.trim()).digest("hex");
}

/** mask match: 086xxx7894 / xxx-x-x3109-x */
function maskedMatch(maskedRaw: string, plainRaw: string): boolean {
  const masked = (maskedRaw ?? "").toLowerCase().replace(/[^0-9x]/g, "");
  const plain = digitsOnly(plainRaw);

  if (!masked || !plain) return false;

  if (masked.length === plain.length) {
    if (!masked.includes("x")) return masked === plain;
    const re = new RegExp("^" + masked.replace(/x/g, "\\d") + "$");
    return re.test(plain);
  }

  const firstX = masked.indexOf("x");
  const lastX = masked.lastIndexOf("x");
  const prefix = firstX === -1 ? masked : masked.slice(0, firstX);
  const suffix = lastX === -1 ? "" : masked.slice(lastX + 1);

  const prefixOk = prefix ? plain.startsWith(prefix) : true;
  const suffixOk = suffix ? plain.endsWith(suffix) : true;
  return prefixOk && suffixOk;
}

function normalizeName(s: string) {
  return s.replace(/\s+/g, "").toLowerCase();
}

/** ชื่อ SlipOK อาจไม่ครบ -> ทำแบบหลวม ๆ */
function looseNameMatch(ownerName?: string, receiverName?: string): boolean {
  const a = normalizeName(ownerName ?? "");
  const b = normalizeName(receiverName ?? "");
  if (!a || !b) return false;

  const tokens =
    ownerName
      ?.split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2) ?? [];

  return (
    tokens.some((t) =>
      normalizeName(receiverName ?? "").includes(normalizeName(t)),
    ) ||
    b.includes(a) ||
    a.includes(b)
  );
}

/** ✅ billStatus hybrid: ดูเฉพาะลูกบิล (ไม่นับหัวบิล) */
function computeBillStatusHybrid(
  participants: ReadonlyArray<Pick<ParticipantDoc, "userId" | "paymentStatus">>,
  ownerId: string,
): BillStatus {
  const others = participants.filter(
    (p) => toIdString(p.userId) !== String(ownerId),
  );
  if (others.length === 0) return "paid";

  const paidCount = others.filter((p) => p.paymentStatus === "paid").length;
  if (paidCount === 0) return "unpaid";
  if (paidCount === others.length) return "paid";
  return "pending";
}

function getUserIdFromSession(session: Session | null): string | null {
  const id = session?.user && "id" in session.user ? session.user.id : null;
  return typeof id === "string" && id.length > 0 ? id : null;
}

// ---------- SlipOK normalize ----------
type SlipOkNormalized = {
  ok: boolean;
  message: string;
  transRef?: string;
  transTimestamp?: string;
  amount?: number;
  receiverName?: string;
  receiverProxy?: string;
  receiverAccount?: string;
};

function normalizeSlipOk(json: unknown): SlipOkNormalized {
  const base: SlipOkNormalized = {
    ok: false,
    message: "Invalid SlipOK response",
  };
  if (!isObject(json)) return base;

  const successTop =
    typeof (json as Record<string, unknown>).success === "boolean"
      ? ((json as Record<string, unknown>).success as boolean)
      : undefined;

  const messageTop =
    typeof (json as Record<string, unknown>).message === "string"
      ? ((json as Record<string, unknown>).message as string)
      : undefined;

  const data = isObject((json as Record<string, unknown>).data)
    ? ((json as Record<string, unknown>).data as Record<string, unknown>)
    : null;

  const successData =
    data && typeof data.success === "boolean"
      ? (data.success as boolean)
      : undefined;
  const messageData =
    data && typeof data.message === "string"
      ? (data.message as string)
      : undefined;

  const ok = Boolean(successTop) && Boolean(successData);
  const message = messageData ?? messageTop ?? base.message;

  const transRef =
    data && typeof data.transRef === "string"
      ? (data.transRef as string)
      : undefined;
  const transTimestamp =
    data && typeof data.transTimestamp === "string"
      ? (data.transTimestamp as string)
      : undefined;
  const amount =
    data && typeof data.amount === "number"
      ? (data.amount as number)
      : undefined;

  const receiverObj =
    data && isObject(data.receiver)
      ? (data.receiver as Record<string, unknown>)
      : null;
  const receiverName =
    receiverObj && typeof receiverObj.displayName === "string"
      ? (receiverObj.displayName as string)
      : receiverObj && typeof receiverObj.name === "string"
        ? (receiverObj.name as string)
        : undefined;

  const proxyObj =
    receiverObj && isObject(receiverObj.proxy)
      ? (receiverObj.proxy as Record<string, unknown>)
      : null;
  const receiverProxy =
    proxyObj && typeof proxyObj.value === "string"
      ? (proxyObj.value as string)
      : undefined;

  const accountObj =
    receiverObj && isObject(receiverObj.account)
      ? (receiverObj.account as Record<string, unknown>)
      : null;
  const receiverAccount =
    accountObj && typeof accountObj.value === "string"
      ? (accountObj.value as string)
      : undefined;

  return {
    ok,
    message,
    transRef,
    transTimestamp,
    amount,
    receiverName,
    receiverProxy,
    receiverAccount,
  };
}

async function slipokCheckSlip(args: {
  file: File;
  amount?: number;
}): Promise<SlipOkNormalized> {
  const branchId = process.env.SLIPOK_BRANCH_ID;
  const apiKey = process.env.SLIPOK_API_KEY;

  if (!branchId || !apiKey) {
    return {
      ok: false,
      message: "Missing SLIPOK env (SLIPOK_BRANCH_ID / SLIPOK_API_KEY)",
    };
  }

  const fd = new FormData();
  fd.append("files", args.file, args.file.name);

  if (
    typeof args.amount === "number" &&
    Number.isFinite(args.amount) &&
    args.amount > 0
  ) {
    fd.append("amount", String(args.amount));
  }

  const url = `https://api.slipok.com/api/line/apikey/${branchId}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-authorization": apiKey },
    body: fd,
    cache: "no-store",
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    return { ok: false, message: `SlipOK: HTTP ${res.status} (invalid JSON)` };
  }

  const normalized = normalizeSlipOk(json);
  if (!res.ok) {
    return {
      ok: false,
      message: `SlipOK: HTTP ${res.status} - ${normalized.message}`,
    };
  }
  return normalized;
}

// ---------- ✅ กันสลิปซ้ำด้วย transRef ----------
type DupHit = { billId: string; userId?: string; guestId?: string };

async function findDuplicateSlipReference(
  reference: string,
): Promise<DupHit | null> {
  const doc = await Bill.findOne(
    { participants: { $elemMatch: { "slipInfo.reference": reference } } },
    { _id: 1, participants: 1 },
  ).lean();

  if (!doc) return null;

  const d = doc as unknown as {
    _id: IdLike;
    participants?: Array<{
      userId?: IdLike;
      guestId?: IdLike;
      slipInfo?: { reference?: string };
    }>;
  };

  const hit = (d.participants ?? []).find(
    (p) => (p.slipInfo?.reference ?? "") === reference,
  );

  return {
    billId: toIdString(d._id),
    userId: hit?.userId ? toIdString(hit.userId) : undefined,
    guestId: hit?.guestId ? toIdString(hit.guestId) : undefined,
  };
}

async function resolveGuestName(guestId: string): Promise<string> {
  if (!guestId) return "";

  const guest = (await Guest.findById(guestId)
    .select("name displayName guestName")
    .lean()) as GuestLean | null;

  if (!guest) return "";
  return (
    guest.name?.trim() ||
    guest.displayName?.trim() ||
    guest.guestName?.trim() ||
    ""
  );
}

function findParticipantIndexForGuest(
  participants: ParticipantDoc[],
  guestId: string,
  guestName: string,
): number {
  if (guestId) {
    const indexByGuestId = participants.findIndex(
      (participant) => toIdString(participant.guestId) === guestId,
    );
    if (indexByGuestId >= 0) return indexByGuestId;
  }

  const normalizedGuestName = guestName.trim().toLowerCase();
  if (normalizedGuestName) {
    const indexByName = participants.findIndex((participant) => {
      const participantName = (participant.name ?? "").trim().toLowerCase();
      const participantKind = participant.kind ?? "";
      return (
        participantName === normalizedGuestName &&
        (participantKind === "guest" || participantKind === "guest_placeholder")
      );
    });
    if (indexByName >= 0) return indexByName;
  }

  return -1;
}

// ✅ Next 15 params เป็น Promise
type RouteCtx = { params: Promise<{ billId: string }> };

export async function POST(req: NextRequest, { params }: RouteCtx) {
  try {
    const session = await getServerSession(authOptions);
    const sessionUserId = getUserIdFromSession(session);

    const { billId } = await params;

    const form = await req.formData();
    const fileValue = form.get("file");

    if (!(fileValue instanceof File)) {
      return NextResponse.json<SlipCheckResponse>(
        { ok: false, message: "Missing file (field name: file)" },
        { status: 400 },
      );
    }

    const file = fileValue;

    const autoPaidRaw = form.get("autoPaid");
    const autoPaid =
      autoPaidRaw === null || autoPaidRaw === undefined
        ? true
        : String(autoPaidRaw) === "true";

    const guestAccessTokenValue = form.get("guestAccessToken");
    const guestAccessToken =
      typeof guestAccessTokenValue === "string" &&
      guestAccessTokenValue.trim().length > 0
        ? guestAccessTokenValue.trim()
        : "";

    const userIdValue = form.get("userId");
    const explicitUserId =
      typeof userIdValue === "string" && userIdValue.trim().length > 0
        ? userIdValue.trim()
        : null;

    await connectMongoDB();

    const billDocRaw = await Bill.findById(billId).populate(
      "createdBy",
      "name bank bankAccountNumber promptPayPhone",
    );
    const billDoc = billDocRaw as unknown as BillHydrated | null;

    if (!billDoc) {
      return NextResponse.json<SlipCheckResponse>(
        { ok: false, message: "Bill not found" },
        { status: 404 },
      );
    }

    const ownerId = isOwnerPopulated(billDoc.createdBy)
      ? toIdString(billDoc.createdBy._id)
      : toIdString(billDoc.createdBy);

    const ownerObj = isOwnerPopulated(billDoc.createdBy)
      ? billDoc.createdBy
      : null;

    const ownerName = (ownerObj?.name ?? "").trim();
    const ownerPhone = digitsOnly(ownerObj?.promptPayPhone);
    const ownerBankAcc = digitsOnly(ownerObj?.bankAccountNumber);

    let idx = -1;
    let targetUserId: string | null = null;
    let targetGuestId: string | null = null;
    let actorMode: "user" | "guest" = "user";

    // ✅ ถ้ามี guestAccessToken ให้ใช้ guest flow ก่อนเสมอ
    if (guestAccessToken) {
      const tokenHash = hashGuestAccessToken(guestAccessToken);

      const access = (await GuestAccessLink.findOne({
        tokenHash,
        isActive: true,
      }).lean()) as GuestAccessLinkLean | null;

      if (!access) {
        return NextResponse.json<SlipCheckResponse>(
          { ok: false, message: "Invalid guest access token" },
          { status: 403 },
        );
      }

      if (access.expiresAt && access.expiresAt.getTime() < Date.now()) {
        return NextResponse.json<SlipCheckResponse>(
          { ok: false, message: "Guest access token has expired" },
          { status: 403 },
        );
      }

      if (toIdString(access.billId) !== String(billId)) {
        return NextResponse.json<SlipCheckResponse>(
          {
            ok: false,
            message: "This guest access token does not belong to this bill",
          },
          { status: 403 },
        );
      }

      const guestId = toIdString(access.guestId);
      const guestName = await resolveGuestName(guestId);

      idx = findParticipantIndexForGuest(
        billDoc.participants,
        guestId,
        guestName,
      );
      if (idx === -1) {
        return NextResponse.json<SlipCheckResponse>(
          { ok: false, message: "Guest participant not found in this bill" },
          { status: 404 },
        );
      }

      targetGuestId = guestId;
      actorMode = "guest";

      await GuestAccessLink.updateOne(
        { _id: access._id },
        { $set: { lastUsedAt: new Date() } },
      );
    } else {
      if (!sessionUserId) {
        return NextResponse.json<SlipCheckResponse>(
          { ok: false, message: "Unauthorized" },
          { status: 401 },
        );
      }

      const targetFromForm = explicitUserId ?? sessionUserId;
      const isOwner = String(ownerId) === String(sessionUserId);
      const isSelf = String(targetFromForm) === String(sessionUserId);

      if (!isSelf && !isOwner) {
        return NextResponse.json<SlipCheckResponse>(
          { ok: false, message: "Forbidden" },
          { status: 403 },
        );
      }

      idx = billDoc.participants.findIndex(
        (p) => toIdString(p.userId) === String(targetFromForm),
      );

      if (idx === -1) {
        return NextResponse.json<SlipCheckResponse>(
          { ok: false, message: "Participant not found in this bill" },
          { status: 404 },
        );
      }

      targetUserId = targetFromForm;
      actorMode = "user";
    }

    const participant = billDoc.participants[idx];
    if (!participant) {
      return NextResponse.json<SlipCheckResponse>(
        { ok: false, message: "Participant not found in this bill" },
        { status: 404 },
      );
    }

    if (participant.paymentStatus === "paid") {
      return NextResponse.json<SlipCheckResponse>(
        { ok: false, message: "This participant has already paid" },
        { status: 409 },
      );
    }

    const expectedAmount = Number(participant.amount) || 0;

    const slip = await slipokCheckSlip({
      file,
      // amount: expectedAmount > 0 ? expectedAmount : undefined,
    });

    if (!slip.ok) {
      return NextResponse.json<SlipCheckResponse>(
        { ok: false, message: `SlipOK: ${slip.message}` },
        { status: 400 },
      );
    }

    const transRef = (slip.transRef ?? "").trim();
    if (!transRef) {
      return NextResponse.json<SlipCheckResponse>(
        {
          ok: false,
          message:
            "SlipOK ไม่ส่ง transRef กลับมา (กันสลิปซ้ำไม่ได้) กรุณาลองใหม่/ใช้สลิปอื่น",
        },
        { status: 400 },
      );
    }

    const dup = await findDuplicateSlipReference(transRef);
    const sameBill = dup?.billId === String(billId);
    const sameUser = targetUserId
      ? dup?.userId === String(targetUserId)
      : false;
    const sameGuest = targetGuestId
      ? dup?.guestId === String(targetGuestId)
      : false;

    if (dup && !(sameBill && (sameUser || sameGuest))) {
      return NextResponse.json<SlipCheckResponse>(
        {
          ok: false,
          message: `สลิปนี้ถูกใช้ไปแล้ว (transRef: ${transRef}) ห้ามใช้สลิปซ้ำ`,
        },
        { status: 409 },
      );
    }

    const actorKey =
      actorMode === "guest"
        ? `guest_${targetGuestId ?? "unknown"}`
        : `user_${targetUserId ?? "unknown"}`;

    const { imageUrl, publicId } = await uploadSlipToCloudinary({
      file,
      billId,
      actorKey,
      transRef,
    });

    const qrValid = true;

    const receiverMatched =
      (ownerPhone && slip.receiverProxy
        ? maskedMatch(slip.receiverProxy, ownerPhone)
        : false) ||
      (ownerBankAcc && slip.receiverAccount
        ? maskedMatch(slip.receiverAccount, ownerBankAcc)
        : false);

    const nameMatched =
      ownerName && slip.receiverName
        ? looseNameMatch(ownerName, slip.receiverName)
        : false;

    const amountMatched =
      typeof slip.amount === "number" && expectedAmount > 0
        ? slip.amount >= expectedAmount - 0.01
        : true;

    const verified = qrValid && receiverMatched && amountMatched;

    const slipInfoDb: SlipInfoDb = {
      imageUrl,
      publicId,
      provider: "slipok",
      reference: transRef,
      checkedAt: new Date(),
      verified,
    };

    const nextParticipantStatus: ParticipantStatus =
      verified && autoPaid ? "paid" : "unpaid";
    const prevParticipantStatus = participant.paymentStatus;
    const prevBillStatus = billDoc.billStatus;

    billDoc.participants[idx].slipInfo = slipInfoDb;
    billDoc.participants[idx].paymentStatus = nextParticipantStatus;

    if (nextParticipantStatus === "paid") {
      billDoc.participants[idx].paidAt = new Date();
    } else {
      billDoc.participants[idx].paidAt = undefined;
    }

    billDoc.billStatus = computeBillStatusHybrid(billDoc.participants, ownerId);
    billDoc.markModified("participants");
    await billDoc.save();

    if (!verified) {
      const reason = !receiverMatched
        ? "ผู้รับไม่ตรงหัวบิล"
        : !amountMatched
          ? "ยอดเงินไม่ตรง"
          : "ไม่ผ่านเงื่อนไข";

      return NextResponse.json<SlipCheckResponse>(
        { ok: false, message: `SlipOK: ${slip.message} (${reason})` },
        { status: 422 },
      );
    }

    try {
      const nextBillStatus = billDoc.billStatus;
      const nextStatus = billDoc.participants[idx].paymentStatus;
      const action =
        autoPaid && nextStatus === "paid" ? "paid" : "slip_uploaded";

      if (
        verified &&
        actorMode === "user" &&
        targetUserId &&
        sessionUserId &&
        (prevParticipantStatus !== nextStatus || action === "slip_uploaded")
      ) {
        await notifyBillStatusChanged({
          billId,
          targetUserId,
          actorUserId: sessionUserId,
          action,
        });
      }

      if (
        verified &&
        actorMode === "guest" &&
        targetGuestId &&
        (prevParticipantStatus !== nextStatus || action === "slip_uploaded")
      ) {
        const guestName =
          (billDoc.participants[idx].name ?? "").trim() ||
          (await resolveGuestName(targetGuestId)) ||
          "Guest";

        await notifyGuestPaidToOwner({
          billId,
          guestId: targetGuestId,
          guestName,
          action,
        });
      }

      if (prevBillStatus !== "paid" && nextBillStatus === "paid") {
        await notifyBillClosed({ billId });
      }
    } catch (err) {
      console.error("⚠️ notify (slip-check) failed:", err);
    }

    const updated = billDoc.participants[idx];
    const billIdStr = toIdString((billDoc as unknown as { _id: IdLike })._id);

    return NextResponse.json<SlipCheckResponse>({
      ok: true,
      message: `โอนเงินสำเร็จ (ตรวจสอบผ่าน SlipOK แล้ว)`,
      billId: billIdStr,
      billStatus: billDoc.billStatus,
      checks: {
        qrValid,
        receiverMatched,
        nameMatched,
        amountMatched,
        duplicate: Boolean(dup),
      },
      slipok: {
        receiverName: slip.receiverName,
        receiverProxy: slip.receiverProxy,
        receiverAccount: slip.receiverAccount,
        transRef: slip.transRef,
        transTimestamp: slip.transTimestamp,
        amount: slip.amount,
      },
      updatedParticipant: {
        userId: updated.userId ? toIdString(updated.userId) : undefined,
        guestId: updated.guestId ? toIdString(updated.guestId) : undefined,
        paymentStatus: updated.paymentStatus,
        slipInfo: updated.slipInfo
          ? {
              imageUrl: updated.slipInfo.imageUrl,
              publicId: updated.slipInfo.publicId,
              provider: updated.slipInfo.provider,
              reference: updated.slipInfo.reference,
              checkedAt: updated.slipInfo.checkedAt.toISOString(),
              verified: updated.slipInfo.verified,
            }
          : undefined,
        paidAt: updated.paidAt ? updated.paidAt.toISOString() : null,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Internal Server Error";
    return NextResponse.json<SlipCheckResponse>(
      { ok: false, message },
      { status: 500 },
    );
  }
}
