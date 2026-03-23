import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import User from "@/models/user";import Notification from "@/models/notification";import { connectMongoDB } from "@/lib/mongodb";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface SendRequestBody {
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

    // ✅ สร้าง notification สำหรับผู้รับคำขอ
    const currentUserData = await User.findById(session.user.id).select('name');
    if (currentUserData) {
      await Notification.create({
        userId: targetUserId,
        type: 'FRIEND_REQUEST',
        title: `${currentUserData.name} ส่งคำขอเพื่อน`,
        message: `${currentUserData.name} ขอเป็นเพื่อนกับคุณ`,
        fromUserId: session.user.id,
        friendRequestStatus: 'pending',
        href: '/friends',
      });
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
