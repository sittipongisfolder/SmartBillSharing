import { notFound, redirect } from 'next/navigation';
import { connectMongoDB } from '@/lib/mongodb';
import Invite from '@/models/invite';
import Bill from '@/models/bill';
import { generateToken, getInviteIdFromPublicToken, hashToken } from '@/lib/tokens';
import GuestAccessLink from '@/models/guestAccessLink';

export const runtime = 'nodejs';

export default async function InviteJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;

  await connectMongoDB();
  const inviteId = getInviteIdFromPublicToken(rawToken);

  const invite = inviteId
    ? await Invite.findOne({
        _id: inviteId,
        revoked: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      }).lean()
    : await Invite.findOne({
        tokenHash: hashToken(rawToken),
        revoked: false,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
      }).lean();

  if (!invite) notFound();

  const bill = await Bill.findById(invite.billId).lean();
  if (!bill) notFound();

  const participantId = String(invite.participantId ?? '');
  const participant = Array.isArray(bill.participants)
    ? bill.participants.find((p) => String(p?._id ?? '') === participantId)
    : null;

  const guests = Array.isArray(bill.participants)
    ? bill.participants.filter((p) => p?.kind === 'guest' && p?.guestId)
    : [];

  const guestIdFromInvite = String(invite.guestId ?? '');
  const guestFromInvite = guestIdFromInvite
    ? guests.find((p) => String(p?.guestId ?? '') === guestIdFromInvite)
    : null;

  const resolvedGuest =
    (participant?.kind === 'guest' && participant.guestId ? participant : null) ||
    guestFromInvite ||
    (bill.stage === 'active' && invite.usedCount > 0 && guests.length === 1 ? guests[0] : null);

  if (resolvedGuest?.paymentStatus === 'paid') {
    return (
      <div className="min-h-screen bg-[#fbf7f1] p-6">
        <header className="mx-auto mb-4 max-w-xl rounded-2xl border border-black/5 bg-white px-4 shadow-sm">
          <div className="flex h-16 items-center justify-center sm:justify-start">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
                <span className="text-lg">🍊</span>
              </span>
              <span className="font-semibold tracking-tight text-[#2f2f2f]">Smart Bill Sharing System</span>
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
          <h1 className="text-xl font-bold text-[#4a4a4a]">ลิงก์นี้สิ้นสุดการใช้งานแล้ว</h1>
          <p className="mt-3 text-sm text-gray-600">Guest รายการนี้ชำระเงินเรียบร้อยแล้ว</p>
        </div>
      </div>
    );
  }

  if (resolvedGuest?.guestId) {
    const rawAccessToken = generateToken(32);

    await GuestAccessLink.create({
      guestId: resolvedGuest.guestId,
      billId: bill._id,
      tokenHash: hashToken(rawAccessToken),
      tokenLast4: rawAccessToken.slice(-4),
      isActive: true,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const inviteTokenQuery = `inviteToken=${encodeURIComponent(rawToken)}`;
    const basePath =
      bill.stage === 'active'
        ? `/guest/access/${rawAccessToken}/pay`
        : `/guest/access/${rawAccessToken}`;

    redirect(`${basePath}?${inviteTokenQuery}`);
  }

  return (
    <div className="min-h-screen bg-[#fbf7f1] p-6">
      <header className="mx-auto mb-4 max-w-xl rounded-2xl border border-black/5 bg-white px-4 shadow-sm">
        <div className="flex h-16 items-center justify-center sm:justify-start">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg">🍊</span>
            </span>
            <span className="font-semibold tracking-tight text-[#2f2f2f]">Smart Bill Sharing System</span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-xl rounded-2xl bg-white p-6 shadow">
        <h1 className="text-xl font-bold text-[#4a4a4a]">เข้าร่วมบิล</h1>

        <div className="mt-4 rounded-xl bg-[#f5f5f5] p-4">
          <p className="text-sm text-gray-600">ชื่อบิล</p>
          <p className="text-base font-semibold text-[#4a4a4a]">{bill.title}</p>

          <p className="mt-3 text-sm text-gray-600">ยอดรวม</p>
          <p className="text-base font-semibold text-[#4a4a4a]">
            ฿{Number(bill.totalPrice).toFixed(2)}
          </p>
        </div>

        <form className="mt-6 space-y-3" action="/api/guest/join" method="post">
          <input type="hidden" name="token" value={rawToken} />

          <label className="block">
            <span className="text-sm font-medium text-[#4a4a4a]">ชื่อที่ใช้ในบิล</span>
            <input
              name="displayName"
              required
              maxLength={80}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-black outline-none focus:ring"
              placeholder="เช่น นัท / มิกซ์ / ฝ้าย"
            />
          </label>

          <button
            type="submit"
            className="w-full rounded-xl bg-[#fb8c00] py-2 font-semibold text-white hover:bg-[#e65100]"
          >
            เข้าร่วมบิลเป็น Guest
          </button>
        </form>
      </div>
    </div>
  );
}