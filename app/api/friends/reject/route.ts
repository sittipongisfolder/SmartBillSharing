import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import User from "@/models/user";
import Notification from "@/models/notification";
import { connectMongoDB } from "@/lib/mongodb";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface RejectRequestBody {
  fromUserId: string;
}

// ✅ POST /api/friends/reject - ปฏิเสธคำขอเพื่อน
export async function POST(req: NextRequest) {
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

    const { fromUserId } = (await req.json()) as RejectRequestBody;

    if (!fromUserId) {
      return NextResponse.json(
        { error: "ต้องระบุ fromUserId" },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // ✅ ตรวจสอบว่าคำขอจริงๆมีมา
    const currentUser = await User.findById(session.user.id);
    if (!currentUser?.friendRequests?.incoming?.includes(fromUserId)) {
      return NextResponse.json(
        { error: "ไม่พบคำขอจากผู้ใช้นี้" },
        { status: 400 }
      );
    }

    // ✅ ลบคำขอ incoming
    await User.updateOne(
      { _id: session.user.id },
      {
        $pull: {
          "friendRequests.incoming": fromUserId,
        },
      }
    );

    // ✅ ลบคำขอ outgoing ให้ผู้ส่งคำขอ
    await User.updateOne(
      { _id: fromUserId },
      {
        $pull: {
          "friendRequests.outgoing": session.user.id,
        },
      }
    );

    // ✅ อัปเดต notification เป็นสถานะ "ปฏิเสธแล้ว"
    await Notification.updateMany({
      userId: session.user.id,
      type: "FRIEND_REQUEST",
      fromUserId,
    }, {
      $set: {
        title: "คำขอเพื่อนถูกปฏิเสธ",
        message: "คุณปฏิเสธคำขอเพื่อนแล้ว",
        friendRequestStatus: "rejected",
      },
    });

    return NextResponse.json({
      message: "ปฏิเสธคำขอเพื่อนสำเร็จ",
    });
  } catch (error) {
    console.error("❌ Error rejecting friend request:", error);
    return NextResponse.json(
      { error: "Failed to reject friend request" },
      { status: 500 }
    );
  }
}
