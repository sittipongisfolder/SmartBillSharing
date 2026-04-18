import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import mongoose from 'mongoose';

import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import NotificationSettings from '@/models/notificationSettings';
import type { NotificationType } from '@/models/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALL_TYPES = [
  'BILL_CREATED_OWNER',
  'BILL_ADDED_YOU',
  'BILL_UPDATED',
  'BILL_STATUS_CHANGED',
  'BILL_CLOSED',
  'DAILY_UNPAID_SUMMARY',
  'FRIEND_REQUEST',
] as const satisfies readonly NotificationType[];

const DAILY_SUMMARY_HOUR_TH = 16;

type SettingsDTO = {
  enabledTypes: NotificationType[];
  dailySummaryEnabled: boolean;
  dailySummaryHour: number; // 0-23
  followGroupIds: string[]; // ส่งออกเป็น string ให้หน้าเว็บ
};

type ResOk = { ok: true; settings: SettingsDTO };
type ResErr = { ok: false; message: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function toUserObjectId(id: string): mongoose.Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : null;
}

function normalizeSettingsDocToDTO(doc: unknown): SettingsDTO {
  // default
  const fallback: SettingsDTO = {
    enabledTypes: [...ALL_TYPES],
    dailySummaryEnabled: true,
    dailySummaryHour: DAILY_SUMMARY_HOUR_TH,
    followGroupIds: [],
  };
  if (!isRecord(doc)) return fallback;
  const enabledRaw = doc.dailySummaryEnabled;
  const enabled = typeof enabledRaw === 'boolean' ? enabledRaw : fallback.dailySummaryEnabled;

  return {
    enabledTypes: [...ALL_TYPES],
    dailySummaryEnabled: enabled,
    dailySummaryHour: DAILY_SUMMARY_HOUR_TH,
    followGroupIds: [],
  };
}

export async function GET(): Promise<NextResponse<ResOk | ResErr>> {
  const session = await getServerSession(authOptions);
  const userIdStr = session?.user?.id;
  if (!userIdStr) return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });

  const userId = toUserObjectId(userIdStr);
  if (!userId) return NextResponse.json({ ok: false, message: 'Invalid user id' }, { status: 400 });

  await connectMongoDB();

  await NotificationSettings.updateOne(
    { userId },
    {
      $set: {
        enabledTypes: [...ALL_TYPES],
        dailySummaryHour: DAILY_SUMMARY_HOUR_TH,
      },
      $setOnInsert: {
        dailySummaryEnabled: true,
        followGroupIds: [],
      },
    },
    { upsert: true }
  );

  const updated = await NotificationSettings.findOne({ userId }).lean();
  return NextResponse.json({ ok: true, settings: normalizeSettingsDocToDTO(updated) }, { status: 200 });
}

export async function PATCH(req: Request): Promise<NextResponse<{ ok: true; message: string } | ResErr>> {
  const session = await getServerSession(authOptions);
  const userIdStr = session?.user?.id;
  if (!userIdStr) return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });

  const userId = toUserObjectId(userIdStr);
  if (!userId) return NextResponse.json({ ok: false, message: 'Invalid user id' }, { status: 400 });

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: 'Invalid JSON' }, { status: 400 });
  }

  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, message: 'Invalid JSON body' }, { status: 400 });
  }

  const enabledRaw = body.dailySummaryEnabled;
  const enabled =
    typeof enabledRaw === 'boolean'
      ? enabledRaw
      : typeof enabledRaw === 'string'
        ? enabledRaw.trim().toLowerCase() === 'true'
        : null;

  if (enabled === null) {
    return NextResponse.json({ ok: false, message: 'dailySummaryEnabled must be boolean' }, { status: 400 });
  }

  await connectMongoDB();

  await NotificationSettings.updateOne(
    { userId },
    {
      $set: {
        enabledTypes: [...ALL_TYPES],
        dailySummaryEnabled: enabled,
        dailySummaryHour: DAILY_SUMMARY_HOUR_TH,
        followGroupIds: [],
      },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, message: 'บันทึกการตั้งค่าสรุปรายวันแล้ว' }, { status: 200 });
}