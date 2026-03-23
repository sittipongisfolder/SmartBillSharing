import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import User from "@/models/user";
import Notification from "@/models/notification";
import { connectMongoDB } from "@/lib/mongodb";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface AcceptRequestBody {
  fromUserId: string;
}

// ✅ POST /api/friends/accept - ยอมรับคำขอเพื่อน
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

    const { fromUserId } = (await req.json()) as AcceptRequestBody;

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

    // ✅ เพิ่มเป็นเพื่อนสำหรับผู้ใช้ปัจจุบัน
    await User.updateOne(
      { _id: session.user.id },
      {
        $push: {
          friends: fromUserId,
        },
        $pull: {
          "friendRequests.incoming": fromUserId,
        },
      }
    );

    // ✅ เพิ่มเป็นเพื่อนสำหรับผู้ส่งคำขอ
    await User.updateOne(
      { _id: fromUserId },
      {
        $push: {
          friends: session.user.id,
        },
        $pull: {
          "friendRequests.outgoing": session.user.id,
        },
      }
    );

    const fromUser = await User.findById(fromUserId).select("name").lean();
    const fromUserName =
      (fromUser as { name?: string } | null)?.name?.trim() || "ผู้ใช้นี้";

    // ✅ อัปเดต notification เป็นสถานะ "เป็นเพื่อนกันแล้ว"
    await Notification.updateMany({
      userId: session.user.id,
      type: "FRIEND_REQUEST",
      fromUserId,
    }, {
      $set: {
        title: "เป็นเพื่อนกันแล้ว",
        message: `คุณและ ${fromUserName} เป็นเพื่อนกันแล้ว`,
        friendRequestStatus: "accepted",
        href: "/friends",
      },
    });

    return NextResponse.json({
      message: "ยอมรับคำขอเพื่อนสำเร็จ",
    });
  } catch (error) {
    console.error("❌ Error accepting friend request:", error);
    return NextResponse.json(
      { error: "Failed to accept friend request" },
      { status: 500 }
    );
  }
}
