import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';
import Notification from '@/models/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type QueryFilter = 'unread' | 'all';

function toIdString(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null && '_id' in value) {
    const nested = (value as { _id?: unknown })._id;
    return typeof nested === 'string' ? nested : nested ? String(nested) : undefined;
  }
  return String(value);
}

function buildBillHistoryHref(billId?: string) {
  return billId ? `/history?billId=${encodeURIComponent(billId)}` : undefined;
}

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const filter = (url.searchParams.get('filter') ?? 'unread') as QueryFilter;
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 20), 50);

  await connectMongoDB();

  const user = await User.findOne({ email: session.user.email }).select('_id friendRequests.incoming friends');
  if (!user) return NextResponse.json({ ok: false, message: 'User not found' }, { status: 404 });

  const where = { userId: user._id, ...(filter === 'unread' ? { isRead: false } : {}) };

  const [items, unreadCount] = await Promise.all([
    Notification.find(where)
      .populate('fromUserId', '_id name email')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean(),
    Notification.countDocuments({ userId: user._id, isRead: false }),
  ]);

  const incomingSet = new Set(
    Array.isArray((user as { friendRequests?: { incoming?: unknown[] } }).friendRequests?.incoming)
      ? ((user as { friendRequests?: { incoming?: unknown[] } }).friendRequests?.incoming ?? [])
          .map((v) => toIdString(v))
          .filter((v): v is string => Boolean(v))
      : []
  );

  const friendsSet = new Set(
    Array.isArray((user as { friends?: unknown[] }).friends)
      ? ((user as { friends?: unknown[] }).friends ?? [])
          .map((v) => toIdString(v))
          .filter((v): v is string => Boolean(v))
      : []
  );

  const normalizedItems = items.map((item) => {
    const billId = toIdString(item.billId);
    const fromUserId = toIdString(item.fromUserId);
    const rawFriendRequestStatus =
      item.friendRequestStatus === 'pending' ||
      item.friendRequestStatus === 'accepted' ||
      item.friendRequestStatus === 'rejected'
        ? item.friendRequestStatus
        : undefined;

    const friendRequestStatus =
      item.type === 'FRIEND_REQUEST'
        ? rawFriendRequestStatus ??
          (fromUserId && incomingSet.has(fromUserId)
            ? 'pending'
            : fromUserId && friendsSet.has(fromUserId)
              ? 'accepted'
              : 'rejected')
        : undefined;

    return {
      ...item,
      _id: String(item._id),
      billId,
      fromUserId,
      friendRequestStatus,
      href: typeof item.href === 'string' && item.href.trim().length > 0 ? item.href : buildBillHistoryHref(billId),
    };
  });

  return NextResponse.json({ ok: true, items: normalizedItems, unreadCount }, { status: 200 });
}
