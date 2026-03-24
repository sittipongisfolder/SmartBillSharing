import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import { notifyFriendRequest } from "@/lib/notify";
import User from "@/models/user";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface SendRequestBody {
  targetUserId: string;
}

interface CancelRequestBody {
  targetUserId: string;
}

// ✅ POST /api/friends/request - ส่งคำขอเพื่อน
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

    const { targetUserId } = (await req.json()) as SendRequestBody;

    if (!targetUserId) {
      return NextResponse.json(
        { error: "ต้องระบุ targetUserId" },
        { status: 400 }
      );
    }

    if (targetUserId === session.user.id) {
      return NextResponse.json(
        { error: "ไม่สามารถส่งคำขอเพื่อนให้ตัวเอง" },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // ✅ ตรวจสอบว่าผู้ใช้ปลายทางมีอยู่
    const targetUser = await User.findById(targetUserId);
    if (!targetUser) {
      return NextResponse.json(
        { error: "ไม่พบผู้ใช้ปลายทาง" },
        { status: 404 }
      );
    }

    // ✅ ตรวจสอบว่าเป็นเพื่อนแล้ว
    const currentUser = await User.findById(session.user.id);
    if (currentUser?.friends?.includes(targetUserId)) {
      return NextResponse.json(
        { error: "ผู้ใช้นี้เป็นเพื่อนของคุณแล้ว" },
        { status: 400 }
      );
    }

    // ✅ ตรวจสอบว่าส่งคำขอแล้วหรือไม่
    if (currentUser?.friendRequests?.outgoing?.includes(targetUserId)) {
      return NextResponse.json(
        { error: "คุณได้ส่งคำขอเพื่อนให้ผู้ใช้นี้แล้ว" },
        { status: 400 }
      );
    }

    // ✅ ตรวจสอบว่าผู้ใช้ปลายทางได้ส่งคำขอมาแล้ว
    if (currentUser?.friendRequests?.incoming?.includes(targetUserId)) {
      return NextResponse.json(
        { error: "ผู้ใช้นี้ได้ส่งคำขอมาแล้ว สามารถยอมรับได้ที่หน้าคำขอ" },
        { status: 400 }
      );
    }

    // ✅ เพิ่มคำขอ outgoing
    await User.updateOne(
      { _id: session.user.id },
      {
        $addToSet: {
          "friendRequests.outgoing": targetUserId,
        },
      }
    );

    // ✅ เพิ่มคำขอ incoming ให้ผู้ใช้ปลายทาง
    await User.updateOne(
      { _id: targetUserId },
      {
        $addToSet: {
          "friendRequests.incoming": session.user.id,
        },
      }
    );

    // ส่งแจ้งเตือนแบบ best-effort: หากแจ้งเตือนล้มเหลว ไม่ควรทำให้การส่งคำขอเพื่อนล้มเหลว
    try {
      await notifyFriendRequest({
        targetUserId,
        fromUserId: session.user.id,
      });
    } catch (notifyError) {
      console.error("⚠️ Friend request sent but notify failed:", notifyError);
    }

    return NextResponse.json({
      message: "ส่งคำขอเพื่อนสำเร็จ",
    });
  } catch (error) {
    console.error("❌ Error sending friend request:", error);
    return NextResponse.json(
      { error: "Failed to send friend request" },
      { status: 500 }
    );
  }
}

// ✅ DELETE /api/friends/request - ยกเลิกคำขอเพื่อนที่ส่งไป
export async function DELETE(req: NextRequest) {
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

    const { targetUserId } = (await req.json()) as CancelRequestBody;

    if (!targetUserId) {
      return NextResponse.json(
        { error: "ต้องระบุ targetUserId" },
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

    const hasOutgoing = currentUser.friendRequests?.outgoing?.some(
      (id) => String(id) === targetUserId
    );

    if (!hasOutgoing) {
      return NextResponse.json(
        { error: "ไม่พบคำขอที่ส่งไปยังผู้ใช้นี้" },
        { status: 400 }
      );
    }

    await User.updateOne(
      { _id: session.user.id },
      {
        $pull: {
          "friendRequests.outgoing": targetUserId,
        },
      }
    );

    await User.updateOne(
      { _id: targetUserId },
      {
        $pull: {
          "friendRequests.incoming": session.user.id,
        },
      }
    );

    return NextResponse.json({
      message: "ยกเลิกคำขอเพื่อนสำเร็จ",
    });
  } catch (error) {
    console.error("❌ Error canceling friend request:", error);
    return NextResponse.json(
      { error: "Failed to cancel friend request" },
      { status: 500 }
    );
  }
}
