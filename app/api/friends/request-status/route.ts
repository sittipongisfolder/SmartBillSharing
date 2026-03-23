import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import User from "@/models/user";
import { connectMongoDB } from "@/lib/mongodb";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

// ✅ GET /api/friends/request-status?userId={userId} - ตรวจสอบสถานะการส่งคำขอ
export async function GET(req: NextRequest) {
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

    const targetUserId = req.nextUrl.searchParams.get("userId");

    if (!targetUserId) {
      return NextResponse.json(
        { error: "ต้องระบุ userId" },
        { status: 400 }
      );
    }

    await connectMongoDB();

    const currentUser = await User.findById(session.user.id).lean();

    if (!currentUser) {
      return NextResponse.json(
        { error: "ไม่พบผู้ใช้งาน" },
        { status: 404 }
      );
    }

    const isFriend = currentUser.friends?.some(
      (id) => String(id) === targetUserId
    ) || false;

    const hasOutgoing = currentUser.friendRequests?.outgoing?.some(
      (id) => String(id) === targetUserId
    ) || false;

    const hasIncoming = currentUser.friendRequests?.incoming?.some(
      (id) => String(id) === targetUserId
    ) || false;

    return NextResponse.json({
      isFriend,
      hasOutgoing,
      hasIncoming,
      status: isFriend ? "friend" : hasOutgoing ? "request-sent" : hasIncoming ? "request-received" : "none",
    });
  } catch (error) {
    console.error("❌ Error checking request status:", error);
    return NextResponse.json(
      { error: "Failed to check request status" },
      { status: 500 }
    );
  }
}
