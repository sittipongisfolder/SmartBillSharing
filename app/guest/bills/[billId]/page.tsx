import { Types } from 'mongoose';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { connectMongoDB } from '@/lib/mongodb';
import Bill from '@/models/bill';
import Guest from '@/models/guest';
import { getGuestIdFromSessionToken } from '@/lib/guestAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // แนะนำกัน build cache/ppr เพี้ยนเวลาอ่าน cookie

type ParticipantLean = {
  kind?: 'user' | 'guest';
  userId?: Types.ObjectId;
  guestId?: Types.ObjectId;
  name: string;
  amount: number;
  paymentStatus?: 'unpaid' | 'paid';
};

type GuestBillView = {
  _id: Types.ObjectId;
  title: string;
  totalPrice: number;
  participants: ParticipantLean[];
};

export default async function GuestBillPage({ params }: { params: { billId: string } }) {
  // ✅ FIX: cookies() ต้อง await
  const cookieStore = await cookies();
  const rawSession = cookieStore.get('sb_guest')?.value;
  if (!rawSession) notFound();

  const guestId = await getGuestIdFromSessionToken(rawSession);
  if (!guestId) notFound();

  await connectMongoDB();

  const [bill, guest] = await Promise.all([
    Bill.findById(params.billId)
      .select('title totalPrice participants')
      .lean<GuestBillView>(),
    Guest.findById(guestId)
      .select('displayName')
      .lean<{ _id: Types.ObjectId; displayName: string }>(),
  ]);

  if (!bill || !guest) notFound();

  const me = bill.participants.find(
    (p) => p.kind === 'guest' && String(p.guestId) === String(guestId)
  );
  if (!me) notFound();

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-6">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl bg-white p-6 shadow">
          <h1 className="text-xl font-bold text-[#4a4a4a]">{bill.title}</h1>

          <p className="mt-1 text-sm text-gray-600">
            Guest: <span className="font-semibold">{guest.displayName}</span>
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-[#f5f5f5] p-4">
              <p className="text-sm text-gray-600">ยอดรวม</p>
              <p className="text-base font-semibold text-[#4a4a4a]">
                ฿{bill.totalPrice.toFixed(2)}
              </p>
            </div>

            <div className="rounded-xl bg-[#f5f5f5] p-4">
              <p className="text-sm text-gray-600">สถานะของฉัน</p>
              <p className="text-base font-semibold text-[#4a4a4a]">
                {me.paymentStatus ?? 'unpaid'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
