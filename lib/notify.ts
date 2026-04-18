// lib/notify.ts
import mongoose from 'mongoose';
import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import User from '@/models/user';
import Notification from '@/models/notification';
import NotificationSettings from '@/models/notificationSettings';
import { pushToUserLine, pushToUserLineWithImage } from '@/lib/lineNotify';

type ObjectIdLike = mongoose.Types.ObjectId | string;

type NotificationType =
  | 'BILL_CREATED_OWNER'
  | 'BILL_ADDED_YOU'
  | 'BILL_UPDATED'
  | 'BILL_STATUS_CHANGED'
  | 'BILL_CLOSED'
  | 'DAILY_UNPAID_SUMMARY'
  | 'FRIEND_REQUEST';

type BillLean = {
  _id: mongoose.Types.ObjectId;
  title: string;
  billStatus: 'unpaid' | 'pending' | 'paid';
  receiptImageUrl?: string;
  createdAt: Date;
  createdBy?: mongoose.Types.ObjectId;
  participants: Array<{
    userId?: mongoose.Types.ObjectId;
    guestId?: mongoose.Types.ObjectId;
    name: string;
    amount: number;
    paymentStatus: 'unpaid' | 'paid';
    slipInfo?: { imageUrl?: string };
  }>;
};

const FALLBACK_APP_URL = 'https://smart-bill-sharing.vercel.app';

function normalizeBaseUrl(input: string | undefined): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;

  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;

  try {
    const u = new URL(withProtocol);
    const host = u.hostname.toLowerCase();

    // LINE เปิดลิงก์จากมือถือไม่ได้ถ้าเป็น localhost/loopback
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') {
      return null;
    }

    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function resolveAppUrl() {
  const fromPublicAppUrl = normalizeBaseUrl(process.env.PUBLIC_APP_URL);
  if (fromPublicAppUrl) return fromPublicAppUrl;

  const fromNextPublic = normalizeBaseUrl(process.env.NEXT_PUBLIC_APP_URL);
  if (fromNextPublic) return fromNextPublic;

  const fromNextAuth = normalizeBaseUrl(process.env.NEXTAUTH_URL);
  if (fromNextAuth) return fromNextAuth;

  const fromVercel = normalizeBaseUrl(process.env.VERCEL_URL);
  if (fromVercel) return fromVercel;

  return FALLBACK_APP_URL;
}

const APP_URL = resolveAppUrl();

function historyBillPath(billId: mongoose.Types.ObjectId) {
  return `/history?billId=${billId.toString()}`;
}

function historyBillUrl(billId: mongoose.Types.ObjectId) {
  return `${APP_URL}${historyBillPath(billId)}`;
}

function loginToHistoryBillUrl(billId: mongoose.Types.ObjectId) {
  return `${APP_URL}/login?callbackUrl=${encodeURIComponent(historyBillPath(billId))}`;
}

const DEFAULT_TYPES: NotificationType[] = [
  'BILL_CREATED_OWNER',
  'BILL_ADDED_YOU',
  'BILL_UPDATED',
  'BILL_STATUS_CHANGED',
  'BILL_CLOSED',
  'DAILY_UNPAID_SUMMARY',
  'FRIEND_REQUEST',
];

function toId(v: ObjectIdLike): mongoose.Types.ObjectId {
  return typeof v === 'string' ? new mongoose.Types.ObjectId(v) : v;
}

function formatTHB(n: number) {
  return new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(n);
}

function findParticipant(bill: BillLean, userId: mongoose.Types.ObjectId) {
  return bill.participants.find((p) => p.userId && String(p.userId) === String(userId)) ?? null;
}

function findGuestParticipant(bill: BillLean, guestId: mongoose.Types.ObjectId) {
  return bill.participants.find((p) => p.guestId && String(p.guestId) === String(guestId)) ?? null;
}

function billSummary(bill: BillLean) {
  const total = bill.participants.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const people = bill.participants.length;
  const paidCount = bill.participants.filter((p) => p.paymentStatus === 'paid').length;
  return { total, people, paidCount };
}

function statusTH(s: 'paid' | 'unpaid') {
  return s === 'paid' ? 'จ่ายแล้ว' : 'ยังไม่จ่าย';
}

function billStatusTH(s: BillLean['billStatus']) {
  if (s === 'paid') return 'ปิดบิลแล้ว';
  if (s === 'pending') return 'กำลังรอตรวจสอบ';
  return 'ยังไม่ปิดบิล';
}

async function ensureSettings(userId: mongoose.Types.ObjectId) {
  await NotificationSettings.updateOne(
    { userId },
    {
      $set: {
        enabledTypes: DEFAULT_TYPES,
        dailySummaryHour: 16,
      },
      $setOnInsert: {
        dailySummaryEnabled: true,
      },
    },
    { upsert: true }
  );

  return NotificationSettings.findOne({ userId })
    .select('enabledTypes dailySummaryEnabled dailySummaryHour lastDailySummaryAt')
    .lean();
}

async function isEnabled(userId: mongoose.Types.ObjectId, type: NotificationType): Promise<boolean> {
  await ensureSettings(userId);
  return DEFAULT_TYPES.includes(type);
}

async function createOnce(args: {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  billId?: mongoose.Types.ObjectId;
  href?: string;
  meta?: { unpaidCount?: number; totalOwed?: number; maxOverdueDays?: number };
  dedupe?: boolean;
}): Promise<boolean> {
  const { userId, type, billId, dedupe = true } = args;

  // ✅ กันยิงซ้ำเฉพาะเมื่อ dedupe=true
  if (dedupe && billId) {
    const exists = await Notification.findOne({ userId, type, billId }).select('_id').lean();
    if (exists) return false;
  }

  await Notification.create({
    userId,
    type,
    title: args.title,
    message: args.message,
    billId,
    href: args.href ?? (billId ? historyBillPath(billId) : undefined),
    meta: args.meta,
    isRead: false,
  });

  return true;
}

async function loadBillLean(billId: mongoose.Types.ObjectId): Promise<BillLean | null> {
  const b = await Bill.findById(billId).select('title billStatus receiptImageUrl participants createdAt createdBy').lean();
  return b as unknown as BillLean | null;
}

function buildLineBillDetail(bill: BillLean, receiverId: mongoose.Types.ObjectId) {
  const me = findParticipant(bill, receiverId);
  const myAmount = me?.amount ?? 0;
  const myPayStatus = me?.paymentStatus ?? 'unpaid';

  const { total, people, paidCount } = billSummary(bill);

  // ✅ ข้อความสั้น + ได้ใจความ
  const detail =
    `บิล: ${bill.title}\n` +
    `ยอดรวม: ${formatTHB(total)} | คน: ${people} | จ่ายแล้ว: ${paidCount}/${people}\n` +
    `ยอดของคุณ: ${formatTHB(myAmount)} (${statusTH(myPayStatus)})\n` +
    `สถานะบิล: ${billStatusTH(bill.billStatus)}`;

  return { detail, myAmount, myPayStatus };
}

function buildLineOwnerDetail(bill: BillLean) {
  const { total, people, paidCount } = billSummary(bill);

  const detail =
    `บิล: ${bill.title}\n` +
    `ยอดรวม: ${formatTHB(total)} | คน: ${people} | จ่ายแล้ว: ${paidCount}/${people}\n` +
    `สถานะบิล: ${billStatusTH(bill.billStatus)}`;

  return { detail, total, people, paidCount };
}

function buildParticipantAmountLines(bill: BillLean, ownerId?: mongoose.Types.ObjectId) {
  const rows = bill.participants.filter((p) => {
    if (!ownerId) return true;
    if (!p.userId) return true;
    return String(p.userId) !== String(ownerId);
  });

  if (rows.length === 0) return 'ไม่มีลูกบิล';

  return rows
    .map((p, i) => `${i + 1}. ${p.name || 'ไม่ระบุชื่อ'}: ${formatTHB(Number(p.amount) || 0)}`)
    .join('\n');
}

/** ✅ 0) หัวบิลสร้างบิลสำเร็จ */
export async function notifyBillCreatedOwner(params: { billId: ObjectIdLike; ownerUserId?: ObjectIdLike }) {
  await connectMongoDB();
  const billId = toId(params.billId);

  const bill = await loadBillLean(billId);
  if (!bill) return;

  const ownerId = params.ownerUserId
    ? toId(params.ownerUserId)
    : bill.createdBy;
  if (!ownerId) return;

  if (!(await isEnabled(ownerId, 'BILL_CREATED_OWNER'))) return;

  const created = await createOnce({
    userId: ownerId,
    type: 'BILL_CREATED_OWNER',
    title: 'สร้างบิลสำเร็จ',
    message: `คุณสร้างบิล "${bill.title}" สำเร็จแล้ว`,
    billId,
    dedupe: true,
  });

  if (!created) return;

  const { detail } = buildLineOwnerDetail(bill);
  const participantLines = buildParticipantAmountLines(bill, ownerId);
  const lineText =
    `✅ สร้างบิลสำเร็จ\n` +
    `บิล: ${bill.title}\n\n` +
    `ลูกบิลและยอด:\n${participantLines}\n\n` +
    `${detail}\n\n` +
    `เปิดบิลนี้: ${historyBillUrl(billId)}\n` +
    `ถ้ายังไม่ได้ล็อกอิน: ${loginToHistoryBillUrl(billId)}`;

  const receiptImageUrl = (bill.receiptImageUrl ?? '').trim();
  if (receiptImageUrl) {
    await pushToUserLineWithImage(ownerId.toString(), lineText, receiptImageUrl);
  } else {
    await pushToUserLine(ownerId.toString(), lineText);
  }
}
/** ✅ 1) ถูกเพิ่มเข้าบิลใหม่ */
export async function notifyBillAddedYou(params: { billId: ObjectIdLike; actorUserId: ObjectIdLike }) {
  await connectMongoDB();
  const billId = toId(params.billId);
  const actorId = toId(params.actorUserId);

  const bill = await loadBillLean(billId);
  if (!bill) return;

  const actor = await User.findById(actorId).select('name').lean();
  const actorName = (actor as { name?: string } | null)?.name ?? 'Someone';

  for (const p of bill.participants) {
    if (!p.userId) continue;
    if (String(p.userId) === String(actorId)) continue;

    const uid = p.userId;
    if (!(await isEnabled(uid, 'BILL_ADDED_YOU'))) continue;

    const created = await createOnce({
      userId: uid,
      type: 'BILL_ADDED_YOU',
      title: 'คุณถูกเพิ่มเข้าบิลใหม่',
      message: `คุณถูกเพิ่มเข้าบิล "${bill.title}"`,
      billId, // ✅ สำคัญ: ใส่ billId ไม่งั้น createOnce กันซ้ำไม่ได้
      dedupe: true, // ✅ กันซ้ำแบบง่าย: type+user+bill ซ้ำไม่สร้างซ้ำ 
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, uid);
      const lineText = `🧾 คุณถูกเพิ่มเข้าบิลใหม่\nโดย: ${actorName}\n\n${detail}\n\nเปิดบิลนี้: ${historyBillUrl(billId)}\nถ้ายังไม่ได้ล็อกอิน: ${loginToHistoryBillUrl(billId)}`;
      const receiptImageUrl = (bill.receiptImageUrl ?? '').trim();

      if (receiptImageUrl) {
        await pushToUserLineWithImage(uid.toString(), lineText, receiptImageUrl);
      } else {
        await pushToUserLine(uid.toString(), lineText);
      }
      // ถ้าไม่อยากให้มีลิงก์เลย ให้ลบบรรทัด (ดูในเว็บ: ...)
    }
  }
}

/** ✅ 2) บิลถูกแก้ไข */
export async function notifyBillUpdated(params: { billId: ObjectIdLike; actorUserId: ObjectIdLike; hint?: string }) {
  await connectMongoDB();
  const billId = toId(params.billId);
  const actorId = toId(params.actorUserId);

  const bill = await loadBillLean(billId);
  if (!bill) return;

  const hint = (params.hint ?? '').trim();
  const actor = await User.findById(actorId).select('name email').lean();
  const actorName =
    (actor as { name?: string; email?: string } | null)?.name?.trim() ||
    (actor as { name?: string; email?: string } | null)?.email?.trim() ||
    'ผู้ใช้';

  const ownerIdStr = bill.createdBy ? String(bill.createdBy) : '';
  const actorIdStr = String(actorId);

  const recipientIdSet = new Set<string>();
  for (const p of bill.participants) {
    if (!p.userId) continue;
    recipientIdSet.add(String(p.userId));
  }
  if (ownerIdStr) recipientIdSet.add(ownerIdStr);
  recipientIdSet.add(actorIdStr);

  for (const uidStr of recipientIdSet) {
    const uid = toId(uidStr);
    if (!(await isEnabled(uid, 'BILL_UPDATED'))) continue;

    const isActor = uidStr === actorIdStr;
    const isOwner = ownerIdStr !== '' && uidStr === ownerIdStr;

    const title = isActor
      ? 'คุณแก้ไขบิลแล้ว'
      : isOwner
        ? 'บิลของคุณมีการแก้ไข'
        : 'บิลมีการแก้ไข';

    const message = isActor
      ? hint
        ? `คุณแก้ไขบิล "${bill.title}": ${hint}`
        : `คุณแก้ไขบิล "${bill.title}"`
      : isOwner
        ? hint
          ? `${actorName} แก้ไขบิล "${bill.title}": ${hint}`
          : `${actorName} แก้ไขบิล "${bill.title}"`
        : hint
          ? `บิล "${bill.title}" มีการแก้ไข: ${hint}`
          : `บิล "${bill.title}" มีการแก้ไขรายละเอียด`;

    const created = await createOnce({
      userId: uid,
      type: 'BILL_UPDATED',
      title,
      message,
      billId,
      dedupe: false,
    });

    if (created) {
      const lineHeading = isActor
        ? '✏️ คุณแก้ไขบิลนี้แล้ว'
        : isOwner
          ? `✏️ บิลของคุณถูกแก้ไขโดย ${actorName}`
          : '✏️ บิลถูกแก้ไข';

      const detail = isOwner ? buildLineOwnerDetail(bill).detail : buildLineBillDetail(bill, uid).detail;

      await pushToUserLine(
        uidStr,
        `${lineHeading}\n${hint ? `รายละเอียด: ${hint}\n` : ''}\n${detail}\n\nเปิดบิลนี้: ${historyBillUrl(billId)}`
      );
    }
  }
}

/** ✅ 3) สถานะคุณเปลี่ยน / เจ้าของบิลได้รับแจ้ง */
export async function notifyBillStatusChanged(params: {
  billId: ObjectIdLike;
  targetUserId: ObjectIdLike;
  actorUserId: ObjectIdLike;
  action: 'paid' | 'slip_uploaded';
}) {
  await connectMongoDB();
  const billId = toId(params.billId);
  const targetId = toId(params.targetUserId);
  const actorId = toId(params.actorUserId);

  const bill = await loadBillLean(billId);
  if (!bill) return;

  // ✅ แจ้ง target
  if (String(targetId) !== String(actorId) && (await isEnabled(targetId, 'BILL_STATUS_CHANGED'))) {
    const targetParticipant = findParticipant(bill, targetId);
    const targetName = targetParticipant?.name?.trim() || 'ผู้ใช้';
    const slipImageUrl = (targetParticipant?.slipInfo?.imageUrl ?? '').trim();

    const msgWeb =
      params.action === 'paid'
        ? `สถานะของคุณในบิล "${bill.title}" ถูกอัปเดตเป็น "จ่ายแล้ว"`
        : `มีการอัปโหลดสลิปในบิล "${bill.title}" และข้อมูลของคุณถูกอัปเดต`;

    const created = await createOnce({
      userId: targetId,
      type: 'BILL_STATUS_CHANGED',
      title: 'สถานะของคุณเปลี่ยน',
      message: msgWeb,
      billId,
      dedupe: false,
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, targetId);
      const lineText =
        `🔔 สถานะของคุณถูกอัปเดต\n` +
        `ผู้จ่าย: ${targetName}\n` +
        `เหตุการณ์: ${params.action === 'paid' ? 'ยืนยันจ่าย' : 'อัปโหลดสลิป'}\n\n` +
        `${detail}\n\nเปิดบิลนี้: ${historyBillUrl(billId)}`;

      if (slipImageUrl) {
        await pushToUserLineWithImage(targetId.toString(), lineText, slipImageUrl);
      } else {
        await pushToUserLine(targetId.toString(), lineText);
      }
    }
  }

  // ✅ แจ้งเจ้าของบิล
  if (bill.createdBy && String(bill.createdBy) !== String(actorId) && (await isEnabled(bill.createdBy, 'BILL_STATUS_CHANGED'))) {
    const actor = await User.findById(actorId).select('name').lean();
    const actorName = (actor as { name?: string } | null)?.name ?? 'Someone';
    const targetParticipant = findParticipant(bill, targetId);
    const targetName = targetParticipant?.name?.trim() || actorName;
    const slipImageUrl = (targetParticipant?.slipInfo?.imageUrl ?? '').trim();

    const msgWeb =
      params.action === 'paid'
        ? `${actorName} ยืนยันการจ่ายในบิล "${bill.title}"`
        : `${actorName} อัปโหลดสลิปในบิล "${bill.title}"`;

    const created = await createOnce({
      userId: bill.createdBy,
      type: 'BILL_STATUS_CHANGED',
      title: 'อัปเดตสถานะในบิล',
      message: msgWeb,
      billId,
      dedupe: false,
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, bill.createdBy);
      const lineText =
        `📌 อัปเดตสถานะในบิล\n` +
        `ผู้จ่าย: ${targetName}\n` +
        `ผู้ทำรายการ: ${actorName}\n` +
        `เหตุการณ์: ${params.action === 'paid' ? 'ยืนยันจ่าย' : 'อัปโหลดสลิป'}\n\n` +
        `${detail}\n\nเปิดบิลนี้: ${historyBillUrl(billId)}`;

      if (slipImageUrl) {
        await pushToUserLineWithImage(bill.createdBy.toString(), lineText, slipImageUrl);
      } else {
        await pushToUserLine(bill.createdBy.toString(), lineText);
      }
    }
  }
}

export async function notifyGuestPaidToOwner(params: {
  billId: ObjectIdLike;
  guestId?: ObjectIdLike;
  guestName?: string;
  action: 'paid' | 'slip_uploaded';
}) {
  await connectMongoDB();
  const billId = toId(params.billId);

  const bill = await loadBillLean(billId);
  if (!bill || !bill.createdBy) return;

  const ownerId = bill.createdBy;
  if (!(await isEnabled(ownerId, 'BILL_STATUS_CHANGED'))) return;

  const guestName = (params.guestName ?? '').trim() || 'Guest';
  const guestId = params.guestId ? toId(params.guestId) : null;
  const guestParticipant = guestId ? findGuestParticipant(bill, guestId) : null;
  const slipImageUrl = (guestParticipant?.slipInfo?.imageUrl ?? '').trim();

  const msgWeb =
    params.action === 'paid'
      ? `${guestName} ยืนยันการจ่ายในบิล "${bill.title}"`
      : `${guestName} อัปโหลดสลิปในบิล "${bill.title}"`;

  const created = await createOnce({
    userId: ownerId,
    type: 'BILL_STATUS_CHANGED',
    title: 'อัปเดตสถานะในบิล',
    message: msgWeb,
    billId,
    dedupe: false,
  });

  if (created) {
    const { detail } = buildLineOwnerDetail(bill);
    const lineText =
      `📌 อัปเดตสถานะในบิล\n` +
      `ผู้จ่าย: ${guestName}\n` +
      `ผู้ทำรายการ: ${guestName}\n` +
      `เหตุการณ์: ${params.action === 'paid' ? 'ยืนยันจ่าย' : 'อัปโหลดสลิป'}\n\n` +
      `${detail}\n\nเปิดบิลนี้: ${historyBillUrl(billId)}`;

    if (slipImageUrl) {
      await pushToUserLineWithImage(ownerId.toString(), lineText, slipImageUrl);
    } else {
      await pushToUserLine(ownerId.toString(), lineText);
    }
  }
}

/** ✅ 4) บิลปิดแล้ว */
export async function notifyBillClosed(params: { billId: ObjectIdLike }) {
  await connectMongoDB();
  const billId = toId(params.billId);

  const bill = await loadBillLean(billId);
  if (!bill) return;
  if (bill.billStatus !== 'paid') return;

  for (const p of bill.participants) {
    if (!p.userId) continue;
    const uid = p.userId;
    if (!(await isEnabled(uid, 'BILL_CLOSED'))) continue;

    const created = await createOnce({
      userId: uid,
      type: 'BILL_CLOSED',
      title: 'บิลปิดแล้ว',
      message: `บิล "${bill.title}" ปิดแล้ว (ทุกคนจ่ายครบ)`,
      billId,
      dedupe: true, // กันซ้ำแบบง่าย: type+user+bill ซ้ำไม่สร้างซ้ำ
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, uid);

      await pushToUserLine(
        uid.toString(),
        `✅ บิลปิดแล้ว (ทุกคนจ่ายครบ)\n\n${detail}\n\nเปิดบิลนี้: ${historyBillUrl(billId)}`
      );
    }
  }
}

export async function notifyFriendRequest(params: {
  targetUserId: ObjectIdLike;
  fromUserId: ObjectIdLike;
}) {
  await connectMongoDB();

  const targetUserId = toId(params.targetUserId);
  const fromUserId = toId(params.fromUserId);

  if (String(targetUserId) === String(fromUserId)) return;
  if (!(await isEnabled(targetUserId, 'FRIEND_REQUEST'))) return;

  const sender = await User.findById(fromUserId).select('name email').lean();
  if (!sender) return;

  const senderName =
    (sender as { name?: string; email?: string } | null)?.name?.trim() ||
    (sender as { name?: string; email?: string } | null)?.email?.trim() ||
    'ผู้ใช้';

  const existing = await Notification.findOne({
    userId: targetUserId,
    type: 'FRIEND_REQUEST',
    fromUserId,
    friendRequestStatus: 'pending',
  })
    .select('_id')
    .lean();

  if (!existing) {
    await Notification.create({
      userId: targetUserId,
      type: 'FRIEND_REQUEST',
      title: `${senderName} ส่งคำขอเพื่อน`,
      message: `${senderName} ขอเป็นเพื่อนกับคุณ`,
      fromUserId,
      friendRequestStatus: 'pending',
      href: '/friends',
      isRead: false,
    });
  }

  await pushToUserLine(
    targetUserId.toString(),
    `👋 คุณมีคำขอเป็นเพื่อนใหม่\nจาก: ${senderName}\n\nเปิดดูและตอบกลับได้ที่: ${APP_URL}/friends`
  );
}