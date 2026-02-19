import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';
import Notification from '@/models/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QueryFilter = 'unread' | 'all';

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const filter = (url.searchParams.get('filter') ?? 'unread') as QueryFilter;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);

  await connectMongoDB();

  const user = await User.findOne({ email: session.user.email }).select('_id');
  if (!user) return NextResponse.json({ ok: false, message: 'User not found' }, { status: 404 });

  const where = { userId: user._id, ...(filter === 'unread' ? { isRead: false } : {}) };

  const [items, unreadCount] = await Promise.all([
    Notification.find(where).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ userId: user._id, isRead: false }),
  ]);

  return NextResponse.json({ ok: true, items, unreadCount }, { status: 200 });
}
