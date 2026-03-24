import { notFound } from 'next/navigation';
import { connectMongoDB } from '@/lib/mongodb';
import GuestAccessLink from '@/models/guestAccessLink';
import Bill from '@/models/bill';
import { hashToken } from '@/lib/tokens';
import GuestAccessClient from './GuestAccessClient';

export const runtime = 'nodejs';

type ParticipantLike = {
  kind?: 'user' | 'guest_placeholder' | 'guest';
  userId?: unknown;
  guestId?: unknown;
  name?: string;
  amount?: number;
  paymentStatus?: 'unpaid' | 'pending' | 'paid';
};

function idToString(v: unknown): string {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'toString' in v) {
    const fn = (v as { toString?: unknown }).toString;
    if (typeof fn === 'function') return String(fn.call(v));
  }
  return '';
}

export default async function GuestAccessPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ inviteToken?: string }>;
}) {
  const { token: rawTokenParam } = await params;
  const { inviteToken } = await searchParams;
  const rawToken = String(rawTokenParam ?? '').trim();
  const rawInviteToken = String(inviteToken ?? '').trim();

  if (!rawToken) notFound();

  await connectMongoDB();

  const tokenHash = hashToken(rawToken);

  const accessLink = await GuestAccessLink.findOne({
    tokenHash,
    isActive: true,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).lean<{
    guestId: unknown;
    billId: unknown;
    expiresAt?: Date | null;
  } | null>();

  if (!accessLink) notFound();

  const bill = await Bill.findById(accessLink.billId).lean<{
    _id: unknown;
    title: string;
    totalPrice: number;
    splitType: string;
    stage?: 'draft' | 'active';
    billStatus?: 'unpaid' | 'pending' | 'paid';
    participants: ParticipantLike[];
  } | null>();

  if (!bill) notFound();

  const guestId = idToString(accessLink.guestId);

  const me =
    Array.isArray(bill.participants)
      ? bill.participants.find(
          (p) => p.kind === 'guest' && idToString(p.guestId) === guestId
        )
      : undefined;

  if (!me) {
    return (
      <div className="min-h-screen bg-[#f5f5f5] p-6">
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
          <h1 className="text-xl font-bold text-[#4a4a4a]">ไม่พบบัญชี Guest ในบิลนี้</h1>
          <p className="mt-3 text-sm text-gray-600">
            ลิงก์นี้อาจถูกยกเลิก หรือ guest คนนี้ยังไม่ได้ถูกผูกกับบิลแล้ว
          </p>
        </div>
      </div>
    );
  }

  const myAmount = Number(me.amount ?? 0);
  const myStatus = (me.paymentStatus ?? 'unpaid') as 'unpaid' | 'pending' | 'paid';
  const billStage = (bill.stage ?? 'active') as 'draft' | 'active';
  const billId = idToString(bill._id);

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-6">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow">
        <h1 className="text-2xl font-bold text-[#4a4a4a]">{bill.title}</h1>
        <p className="mt-1 text-sm text-gray-500">Guest: {me.name}</p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl bg-[#f5f5f5] p-4">
            <p className="text-sm text-gray-500">ยอดของฉัน</p>
            <p className="mt-1 text-2xl font-bold text-[#4a4a4a]">
              ฿{myAmount.toFixed(2)}
            </p>
          </div>

          <div className="rounded-2xl bg-[#f5f5f5] p-4">
            <p className="text-sm text-gray-500">สถานะของฉัน</p>
            <p className="mt-1 text-2xl font-bold text-[#4a4a4a]">{myStatus}</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-gray-200 p-4">
          <p className="text-sm text-gray-500">สถานะบิล</p>
          <p className="mt-1 font-semibold text-[#4a4a4a]">
            {billStage === 'draft' ? 'กำลังรอหัวบิลยืนยัน / ยังไม่เปิดบิล' : 'เปิดบิลแล้ว'}
          </p>

          <p className="mt-3 text-sm text-gray-500">ยอดรวมบิล</p>
          <p className="mt-1 font-semibold text-[#4a4a4a]">
            ฿{Number(bill.totalPrice ?? 0).toFixed(2)}
          </p>

          <p className="mt-3 text-sm text-gray-500">รูปแบบการหาร</p>
          <p className="mt-1 font-semibold text-[#4a4a4a]">{bill.splitType}</p>
        </div>

        <GuestAccessClient
          rawToken={rawToken}
          billId={billId}
          billStage={billStage}
          myStatus={myStatus}
          inviteToken={rawInviteToken || undefined}
        />
      </div>
    </div>
  );
}