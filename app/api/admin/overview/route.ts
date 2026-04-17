import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";
import Bill from "@/models/bill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectMongoDB();

  const today = startOfToday();

  const [totalUsers, totalBills, billsToday, openBills, closedBills, paidBills, unpaidBills, pendingBills] =
    await Promise.all([
      User.countDocuments(),
      Bill.countDocuments(),
      Bill.countDocuments({ createdAt: { $gte: today } }),
      Bill.countDocuments({ billStatus: { $in: ["unpaid", "pending"] } }),
      Bill.countDocuments({ billStatus: "paid" }),
      Bill.countDocuments({ billStatus: "paid" }),
      Bill.countDocuments({ billStatus: "unpaid" }),
      Bill.countDocuments({ billStatus: "pending" }),
    ]);

  return NextResponse.json({
    ok: true,
    stats: { totalUsers, totalBills, billsToday, openBills, closedBills, paidBills, unpaidBills, pendingBills },
  });
}
