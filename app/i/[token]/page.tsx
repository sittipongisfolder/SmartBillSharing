import { notFound } from 'next/navigation';
import { connectMongoDB } from '@/lib/mongodb';
import Invite from '@/models/invite';
import Bill from '@/models/bill';
import { hashToken } from '@/lib/tokens';

export const runtime = 'nodejs';

export default async function InviteJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawToken } = await params;

  await connectMongoDB();
  const tokenHash = hashToken(rawToken);

  const invite = await Invite.findOne({
    tokenHash,
    revoked: false,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  }).lean();

  if (!invite) notFound();

  const bill = await Bill.findById(invite.billId).lean();
  if (!bill) notFound();

  return (
    <div className="min-h-screen bg-[#f5f5f5] p-6">
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
              className="mt-1 w-full rounded-xl border px-3 py-2 outline-none focus:ring"
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