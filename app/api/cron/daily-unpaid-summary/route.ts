// app/api/cron/daily-unpaid-summary/route.ts
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import Notification from '@/models/notification';
import NotificationSettings from '@/models/notificationSettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Res = { ok: boolean; message: string; processed?: number };

const tz = 'Asia/Bangkok';

const dateKeyTH = (d: Date) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const y = parts.find((p) => p.type === 'year')?.value ?? '0000';
  const m = parts.find((p) => p.type === 'month')?.value ?? '00';
  const day = parts.find((p) => p.type === 'day')?.value ?? '00';
  return `${y}-${m}-${day}`;
};

const hourTH = (d: Date) =>
  Number(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hour12: false }).format(d)
  );

const daysBetween = (from: Date, to: Date) =>
  Math.max(0, Math.floor((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24)));

export async function GET(req: Request) {
  // กันยิงมั่วด้วย secret (ถ้าอยากใช้)
  const url = new URL(req.url);
  const secret = url.searchParams.get('secret') ?? '';
  const expected = process.env.CRON_SECRET ?? '';
  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false, message: 'Forbidden' } satisfies Res, { status: 403 });
  }

  await connectMongoDB();

  const now = new Date();
  const today = dateKeyTH(now);
  const h = hourTH(now);

  const settingsList = await NotificationSettings.find({
    dailySummaryEnabled: true,
    enabledTypes: { $in: ['DAILY_UNPAID_SUMMARY'] },
  })
    .select('userId dailySummaryHour lastDailySummaryAt')
    .lean();

  let processed = 0;

  for (const s of settingsList) {
    const hour = typeof s.dailySummaryHour === 'number' ? s.dailySummaryHour : 9;
    if (h < hour) continue;

    const lastKey = s.lastDailySummaryAt ? dateKeyTH(new Date(s.lastDailySummaryAt)) : '';
    if (lastKey === today) continue;

    const userId = s.userId as mongoose.Types.ObjectId;

    // bills ที่ user นี้ยัง unpaid
    const bills = await Bill.find({
      participants: { $elemMatch: { userId, paymentStatus: 'unpaid' } },
    })
      .select('title participants createdAt')
      .lean();

    let unpaidCount = 0;
    let totalOwed = 0;
    let maxOverdueDays = 0;

    for (const b of bills) {
      const participants = (b as unknown as { participants?: Array<{ userId?: unknown; paymentStatus?: string; amount?: number }> }).participants ?? [];
      const me = participants.find((p) => String(p.userId ?? '') === String(userId) && p.paymentStatus === 'unpaid');
      if (!me) continue;

      unpaidCount += 1;
      totalOwed += typeof me.amount === 'number' ? me.amount : 0;

      const createdAt = (b as unknown as { createdAt?: Date }).createdAt ?? now;
      const overdue = daysBetween(new Date(createdAt), now);
      if (overdue > maxOverdueDays) maxOverdueDays = overdue;
    }

    // ถ้าไม่ค้าง ไม่ต้องส่ง แต่ mark ว่าเช็ควันนี้แล้ว กันยิงซ้ำ
    await NotificationSettings.updateOne({ userId }, { $set: { lastDailySummaryAt: now } });

    if (unpaidCount === 0) continue;

    // กันซ้ำ: วันนี้เคยส่งแล้วไหม
    const already = await Notification.findOne({
      userId,
      type: 'DAILY_UNPAID_SUMMARY',
      createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
    })
      .select('_id')
      .lean();
    if (already) continue;

    await Notification.create({
      userId,
      type: 'DAILY_UNPAID_SUMMARY',
      title: `สรุปยอดค้างวันนี้ (${unpaidCount} บิล)`,
      message: `วันนี้คุณค้างจ่าย ${unpaidCount} บิล / ยอดรวม ${totalOwed.toFixed(
        2
      )} บาท (ค้างสูงสุด ${maxOverdueDays} วัน)`,
      meta: { unpaidCount, totalOwed, maxOverdueDays },
      isRead: false,
    });

    processed += 1;
  }

  return NextResponse.json({ ok: true, message: 'done', processed } satisfies Res);
}
