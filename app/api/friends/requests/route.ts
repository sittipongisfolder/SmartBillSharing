import { NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import User from "@/models/user";
import { connectMongoDB } from "@/lib/mongodb";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

// ✅ GET /api/friends/requests - ดึงคำขอเพื่อนที่รอการตอบ
export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as {
      user: SessionUserWithId;
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "ต้องเข้าสู่ระบบก่อน" },
        { status: 401 }
      );
    }

    await connectMongoDB();

    const user = await User.findById(session.user.id)
      .populate("friendRequests.incoming", "_id name email")
      .populate("friendRequests.outgoing", "_id name email")
      .lean();

    if (!user) {
      return NextResponse.json(
        { error: "ไม่พบผู้ใช้งาน" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      incoming: user.friendRequests?.incoming || [],
      outgoing: user.friendRequests?.outgoing || [],
    });
  } catch (error) {
    console.error("❌ Error fetching friend requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch friend requests" },
      { status: 500 }
    );
  }
}
