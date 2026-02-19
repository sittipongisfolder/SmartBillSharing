import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';
import Notification from '@/models/notification';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ ok: false }, { status: 401 });

  await connectMongoDB();
  const user = await User.findOne({ email: session.user.email }).select('_id');
  if (!user) return NextResponse.json({ ok: false }, { status: 404 });

  await Notification.deleteMany({ userId: user._id });
  return NextResponse.json({ ok: true, message: 'Cleared' });
}
