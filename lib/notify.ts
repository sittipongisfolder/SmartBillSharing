// lib/notify.ts
import mongoose from 'mongoose';
import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import User from '@/models/user';
import Notification from '@/models/notification';
import NotificationSettings from '@/models/notificationSettings';

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

async function ensureSettings(userId: mongoose.Types.ObjectId) {
  const s = await NotificationSettings.findOne({ userId }).select('enabledTypes dailySummaryEnabled dailySummaryHour lastDailySummaryAt').lean();
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
}) {
  const { userId, type, billId } = args;

  // กันยิงซ้ำแบบง่าย: type+user+bill ซ้ำไม่สร้างซ้ำ
  if (billId) {
    const exists = await Notification.findOne({ userId, type, billId }).select('_id').lean();
    if (exists) return;
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
}

async function loadBillLean(billId: mongoose.Types.ObjectId): Promise<BillLean | null> {
  const b = await Bill.findById(billId)
    .select('title billStatus participants createdAt createdBy')
    .lean();

  return (b as unknown as BillLean | null);
}

/** ✅ 1) ถูกเพิ่มเข้าบิลใหม่ */
export async function notifyBillAddedYou(params: { billId: ObjectIdLike; actorUserId: ObjectIdLike }) {
  await connectMongoDB();
  const billId = toId(params.billId);
  const actorId = toId(params.actorUserId);

  const bill = await loadBillLean(billId);
  if (!bill) return;

  for (const p of bill.participants) {
    if (!p.userId) continue;
    if (String(p.userId) === String(actorId)) continue;

    const uid = p.userId;
    if (!(await isEnabled(uid, 'BILL_ADDED_YOU'))) continue;

    await createOnce({
      userId: uid,
      type: 'BILL_ADDED_YOU',
      title: 'คุณถูกเพิ่มเข้าบิลใหม่',
      message: `คุณถูกเพิ่มเข้าบิล "${bill.title}"`,
      billId,
    });
  }
}

/** ✅ 2) บิลถูกแก้ไข (ยอด/รายการ/วิธีหาร/สมาชิก/จำนวนเงิน) */
export async function notifyBillUpdated(params: { billId: ObjectIdLike; actorUserId: ObjectIdLike; hint?: string }) {
  await connectMongoDB();
  const billId = toId(params.billId);
  const actorId = toId(params.actorUserId);

  const bill = await loadBillLean(billId);
  if (!bill) return;

  const hint = (params.hint ?? '').trim();
  const msg = hint ? `บิล "${bill.title}" มีการแก้ไข: ${hint}` : `บิล "${bill.title}" มีการแก้ไขรายละเอียด`;

  for (const p of bill.participants) {
    if (!p.userId) continue;
    if (String(p.userId) === String(actorId)) continue;

    const uid = p.userId;
    if (!(await isEnabled(uid, 'BILL_UPDATED'))) continue;

    await createOnce({
      userId: uid,
      type: 'BILL_UPDATED',
      title: 'บิลมีการแก้ไข',
      message: msg,
      billId,
    });
  }
}

/** ✅ 3) มีคนกดยืนยันจ่าย/อัปโหลดสลิป แล้ว “สถานะคุณ” เปลี่ยน */
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

  // แจ้งเฉพาะ "เจ้าของสถานะ" (target) ถ้าไม่ใช่คนทำเอง
  if (String(targetId) !== String(actorId) && (await isEnabled(targetId, 'BILL_STATUS_CHANGED'))) {
    const msg =
      params.action === 'paid'
        ? `สถานะของคุณในบิล "${bill.title}" ถูกอัปเดตเป็น "จ่ายแล้ว"`
        : `มีการอัปโหลดสลิปในบิล "${bill.title}" และข้อมูลของคุณถูกอัปเดต`;

    await createOnce({
      userId: targetId,
      type: 'BILL_STATUS_CHANGED',
      title: 'สถานะของคุณเปลี่ยน',
      message: msg,
      billId,
    });
  }

  // (optional แต่แนะนำ) แจ้งเจ้าของบิลด้วย เมื่อคนอื่นจ่าย/อัปโหลดสลิป
  if (bill.createdBy && String(bill.createdBy) !== String(actorId) && (await isEnabled(bill.createdBy, 'BILL_STATUS_CHANGED'))) {
    const actor = await User.findById(actorId).select('name').lean();
    const actorName = (actor as { name?: string } | null)?.name ?? 'Someone';

    const msg =
      params.action === 'paid'
        ? `${actorName} ยืนยันการจ่ายในบิล "${bill.title}"`
        : `${actorName} อัปโหลดสลิปในบิล "${bill.title}"`;

    await createOnce({
      userId: bill.createdBy,
      type: 'BILL_STATUS_CHANGED',
      title: 'อัปเดตสถานะในบิล',
      message: msg,
      billId,
    });
  }
}

/** ✅ 4) บิลปิดแล้ว (billStatus = paid) */
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

    await createOnce({
      userId: uid,
      type: 'BILL_CLOSED',
      title: 'บิลปิดแล้ว',
      message: `บิล "${bill.title}" ปิดแล้ว (ทุกคนจ่ายครบ)`,
      billId,
    });
  }
}
