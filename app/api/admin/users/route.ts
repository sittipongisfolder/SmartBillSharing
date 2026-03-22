import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";
import Bill from "@/models/bill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  await connectMongoDB();

  try {
    // ดึง users ทั้งหมด
    const allUsers = await User.find().select("_id name email role").lean();

    // สำหรับแต่ละ user ให้นับจำนวน bills และรวม total price
    const items = await Promise.all(
      allUsers.map(async (u) => {
        const bills = await Bill.find({ createdBy: u._id }).select("totalPrice");
        const billCount = bills.length;
        const totalAmount = bills.reduce((sum, b) => sum + (b.totalPrice || 0), 0);

        return {
          id: String(u._id),
          name: u.name,
          email: u.email,
          userId: String(u._id),
          role: u.role || "user",
          bills: billCount,
          total: totalAmount,
        };
      })
    );

    return NextResponse.json({
      ok: true,
      items,
    });
  } catch (e) {
    console.error("Error fetching users:", e);
    return NextResponse.json(
      { ok: false, error: "Failed to fetch users" },
      { status: 500 }
    );
  }
}
