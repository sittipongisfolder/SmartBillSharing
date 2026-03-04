// lib/notify.ts
import mongoose from 'mongoose';
import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import User from '@/models/user';
import Notification from '@/models/notification';
import NotificationSettings from '@/models/notificationSettings';
import { pushToUserLine } from '@/lib/lineNotify';

type ObjectIdLike = mongoose.Types.ObjectId | string;

type NotificationType =
  | 'BILL_ADDED_YOU'
  | 'BILL_UPDATED'
  | 'BILL_STATUS_CHANGED'
  | 'BILL_CLOSED'
  | 'DAILY_UNPAID_SUMMARY';

type BillLean = {
  _id: mongoose.Types.ObjectId;
  title: string;
  billStatus: 'unpaid' | 'pending' | 'paid';
  createdAt: Date;
  createdBy?: mongoose.Types.ObjectId;
  participants: Array<{
    userId?: mongoose.Types.ObjectId;
    name: string;
    amount: number;
    paymentStatus: 'unpaid' | 'paid';
    slipInfo?: { imageUrl?: string };
  }>;
};

const APP_URL = process.env.NEXTAUTH_URL || 'https://smart-bill-sharing.vercel.app';
const billUrl = (billId: mongoose.Types.ObjectId) => `${APP_URL}/bills/${billId.toString()}`;

const DEFAULT_TYPES: NotificationType[] = [
  'BILL_ADDED_YOU',
  'BILL_UPDATED',
  'BILL_STATUS_CHANGED',
  'BILL_CLOSED',
  'DAILY_UNPAID_SUMMARY',
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
  const s = await NotificationSettings.findOne({ userId })
    .select('enabledTypes dailySummaryEnabled dailySummaryHour lastDailySummaryAt')
    .lean();
  if (s) return s;

  await NotificationSettings.create({
    userId,
    enabledTypes: DEFAULT_TYPES,
    dailySummaryEnabled: true,
    dailySummaryHour: 9,
  });

  return NotificationSettings.findOne({ userId }).lean();
}

async function isEnabled(userId: mongoose.Types.ObjectId, type: NotificationType): Promise<boolean> {
  const s = await ensureSettings(userId);
  const enabled = Array.isArray(s?.enabledTypes) ? s.enabledTypes : [];
  return enabled.includes(type);
}

async function createOnce(args: {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  billId?: mongoose.Types.ObjectId;
  meta?: { unpaidCount?: number; totalOwed?: number; maxOverdueDays?: number };
}): Promise<boolean> {
  const { userId, type, billId } = args;

  // กันยิงซ้ำแบบง่าย: type+user+bill ซ้ำไม่สร้างซ้ำ
  if (billId) {
    const exists = await Notification.findOne({ userId, type, billId }).select('_id').lean();
    if (exists) return false;
  }

  await Notification.create({
    userId,
    type,
    title: args.title,
    message: args.message,
    billId,
    meta: args.meta,
    isRead: false,
  });

  return true;
}

async function loadBillLean(billId: mongoose.Types.ObjectId): Promise<BillLean | null> {
  const b = await Bill.findById(billId).select('title billStatus participants createdAt createdBy').lean();
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
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, uid);

      await pushToUserLine(
        uid.toString(),
        `🧾 คุณถูกเพิ่มเข้าบิลใหม่\nโดย: ${actorName}\n\n${detail}\n\n(ดูในเว็บ: ${billUrl(billId)})`
      );
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
  const msgWeb = hint ? `บิล "${bill.title}" มีการแก้ไข: ${hint}` : `บิล "${bill.title}" มีการแก้ไขรายละเอียด`;

  for (const p of bill.participants) {
    if (!p.userId) continue;
    if (String(p.userId) === String(actorId)) continue;

    const uid = p.userId;
    if (!(await isEnabled(uid, 'BILL_UPDATED'))) continue;

    const created = await createOnce({
      userId: uid,
      type: 'BILL_UPDATED',
      title: 'บิลมีการแก้ไข',
      message: msgWeb,
      billId,
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, uid);

      await pushToUserLine(
        uid.toString(),
        `✏️ บิลถูกแก้ไข\n${hint ? `รายละเอียด: ${hint}\n` : ''}\n${detail}\n\n(ดูในเว็บ: ${billUrl(billId)})`
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
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, targetId);

      await pushToUserLine(
        targetId.toString(),
        `🔔 สถานะของคุณถูกอัปเดต\nเหตุการณ์: ${params.action === 'paid' ? 'ยืนยันจ่าย' : 'อัปโหลดสลิป'}\n\n${detail}\n\n(ดูในเว็บ: ${billUrl(billId)})`
      );
    }
  }

  // ✅ แจ้งเจ้าของบิล
  if (bill.createdBy && String(bill.createdBy) !== String(actorId) && (await isEnabled(bill.createdBy, 'BILL_STATUS_CHANGED'))) {
    const actor = await User.findById(actorId).select('name').lean();
    const actorName = (actor as { name?: string } | null)?.name ?? 'Someone';

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
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, bill.createdBy);

      await pushToUserLine(
        bill.createdBy.toString(),
        `📌 อัปเดตสถานะในบิล\nผู้ทำรายการ: ${actorName}\nเหตุการณ์: ${params.action === 'paid' ? 'ยืนยันจ่าย' : 'อัปโหลดสลิป'}\n\n${detail}\n\n(ดูในเว็บ: ${billUrl(billId)})`
      );
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
    });

    if (created) {
      const { detail } = buildLineBillDetail(bill, uid);

      await pushToUserLine(
        uid.toString(),
        `✅ บิลปิดแล้ว (ทุกคนจ่ายครบ)\n\n${detail}\n\n(ดูในเว็บ: https://smart-bill-sharing.vercel.app)`
      );
    }
  }
}