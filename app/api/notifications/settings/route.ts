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
  'GROUP_MEMBER_CHANGED',
  'GROUP_UPDATED',
] as const satisfies readonly NotificationType[];

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

function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === 'string' && (ALL_TYPES as readonly string[]).includes(v);
}

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v);
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Math.trunc(Number(v));
  return null;
}

function uniqStrings(xs: string[]): string[] {
  const s = new Set<string>();
  xs.forEach((x) => s.add(x));
  return Array.from(s);
}

function normalizeSettingsDocToDTO(doc: unknown): SettingsDTO {
  // default
  const fallback: SettingsDTO = {
    enabledTypes: [...ALL_TYPES],
    dailySummaryEnabled: true,
    dailySummaryHour: 9,
    followGroupIds: [],
  };

  if (!isRecord(doc)) return fallback;

  const enabledRaw = doc.enabledTypes;
  const enabledTypes =
    Array.isArray(enabledRaw) ? enabledRaw.filter(isNotificationType) : fallback.enabledTypes;

  const dailySummaryEnabled =
    typeof doc.dailySummaryEnabled === 'boolean' ? doc.dailySummaryEnabled : fallback.dailySummaryEnabled;

  const hour = toInt(doc.dailySummaryHour);
  const dailySummaryHour = hour != null && hour >= 0 && hour <= 23 ? hour : fallback.dailySummaryHour;

  const followRaw = doc.followGroupIds;
  const followGroupIds =
    Array.isArray(followRaw) ? followRaw.map((x) => String(x)).filter((x) => x.length > 0) : fallback.followGroupIds;

  return {
    enabledTypes,
    dailySummaryEnabled,
    dailySummaryHour,
    followGroupIds,
  };
}

function parsePatchBody(body: unknown): { ok: true; value: SettingsDTO } | { ok: false; message: string } {
  if (!isRecord(body)) return { ok: false, message: 'Invalid JSON body' };

  const enabledRaw = body.enabledTypes;
  if (!Array.isArray(enabledRaw)) return { ok: false, message: 'enabledTypes must be an array' };
  const enabledTypes = enabledRaw.filter(isNotificationType);
  if (enabledTypes.length !== enabledRaw.length) {
    return { ok: false, message: 'enabledTypes contains invalid values' };
  }

  const dailySummaryEnabled =
    typeof body.dailySummaryEnabled === 'boolean' ? body.dailySummaryEnabled : true;

  const hour = toInt(body.dailySummaryHour);
  if (hour == null || hour < 0 || hour > 23) {
    return { ok: false, message: 'dailySummaryHour must be 0-23' };
  }

  const followRaw = body.followGroupIds;
  const followGroupIdsInput =
    Array.isArray(followRaw) ? followRaw.filter((x) => typeof x === 'string') : [];
  if (Array.isArray(followRaw) && followGroupIdsInput.length !== followRaw.length) {
    return { ok: false, message: 'followGroupIds must be string[]' };
  }

  // ถ้าส่ง groupId มา ต้องเป็น ObjectId string ที่ถูกต้อง (กันข้อมูลขยะ)
  const invalidGroupId = followGroupIdsInput.find((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidGroupId) return { ok: false, message: `Invalid group id: ${invalidGroupId}` };

  return {
    ok: true,
    value: {
      enabledTypes,
      dailySummaryEnabled,
      dailySummaryHour: hour,
      followGroupIds: uniqStrings(followGroupIdsInput),
    },
  };
}

export async function GET(): Promise<NextResponse<ResOk | ResErr>> {
  const session = await getServerSession(authOptions);
  const userIdStr = session?.user?.id;
  if (!userIdStr) return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });

  const userId = toUserObjectId(userIdStr);
  if (!userId) return NextResponse.json({ ok: false, message: 'Invalid user id' }, { status: 400 });

  await connectMongoDB();

  const existing = await NotificationSettings.findOne({ userId }).lean();
  if (!existing) {
    await NotificationSettings.create({
      userId,
      enabledTypes: [...ALL_TYPES],
      followGroupIds: [],
      dailySummaryEnabled: true,
      dailySummaryHour: 9,
    });
    const created = await NotificationSettings.findOne({ userId }).lean();
    return NextResponse.json({ ok: true, settings: normalizeSettingsDocToDTO(created) }, { status: 200 });
  }

  return NextResponse.json({ ok: true, settings: normalizeSettingsDocToDTO(existing) }, { status: 200 });
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

  const parsed = parsePatchBody(body);
  if (!parsed.ok) return NextResponse.json({ ok: false, message: parsed.message }, { status: 400 });

  await connectMongoDB();

  await NotificationSettings.updateOne(
    { userId },
    {
      $set: {
        enabledTypes: parsed.value.enabledTypes,
        dailySummaryEnabled: parsed.value.dailySummaryEnabled,
        dailySummaryHour: parsed.value.dailySummaryHour,
        // เก็บใน DB เป็น ObjectId[] ตาม schema แต่ส่งออกหน้าเว็บเป็น string[]
        followGroupIds: parsed.value.followGroupIds.map((id) => new mongoose.Types.ObjectId(id)),
      },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, message: 'Saved' }, { status: 200 });
}