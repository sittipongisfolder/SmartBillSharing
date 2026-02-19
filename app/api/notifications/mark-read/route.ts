import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';
import Notification from '@/models/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = { ids?: string[]; all?: boolean };

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false }, { status: 401 });

  const body = (await req.json()) as Body;

  await connectMongoDB();
  const user = await User.findOne({ email: session.user.email }).select('_id');
  if (!user) return NextResponse.json({ ok: false }, { status: 404 });

  if (body.all) {
    await Notification.updateMany({ userId: user._id, isRead: false }, { $set: { isRead: true } });
    return NextResponse.json({ ok: true, message: 'Marked all as read' });
  }

  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) return NextResponse.json({ ok: false, message: 'No ids' }, { status: 400 });

  await Notification.updateMany(
    { userId: user._id, _id: { $in: ids } },
    { $set: { isRead: true } }
  );

  return NextResponse.json({ ok: true, message: 'Marked as read' });
}
