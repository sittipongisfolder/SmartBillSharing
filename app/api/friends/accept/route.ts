import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";

import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";
import Notification from "@/models/notification";
import FriendRelation, { buildPairKey } from "@/models/friendRelation";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface AcceptRequestBody {
  fromUserId?: string;
  notificationId?: string;
}

function parseId(raw: string): mongoose.Types.ObjectId | null {
  return mongoose.Types.ObjectId.isValid(raw) ? new mongoose.Types.ObjectId(raw) : null;
}

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions)) as {
      user: SessionUserWithId;
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
    }

    const { fromUserId, notificationId } = (await req.json()) as AcceptRequestBody;

    const currentUserId = parseId(session.user.id);
    if (!currentUserId) {
      return NextResponse.json({ error: "รหัสผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
    }

    await connectMongoDB();

    let requesterId = fromUserId ? parseId(fromUserId) : null;

    if (!requesterId && notificationId && mongoose.Types.ObjectId.isValid(notificationId)) {
      const notification = await Notification.findOne({
        _id: new mongoose.Types.ObjectId(notificationId),
        userId: currentUserId,
        type: "FRIEND_REQUEST",
      })
        .select("fromUserId")
        .lean();

      const rawFrom = (notification as { fromUserId?: unknown } | null)?.fromUserId;
      if (rawFrom) {
        const fromId = String(rawFrom);
        requesterId = parseId(fromId);
      }
    }

    if (!requesterId) {
      return NextResponse.json({ error: "ไม่พบข้อมูลผู้ส่งคำขอ" }, { status: 400 });
    }

    const relation = await FriendRelation.findOneAndUpdate(
      {
        pairKey: buildPairKey(currentUserId.toString(), requesterId.toString()),
        requesterId,
        addresseeId: currentUserId,
        status: "pending",
      },
      { $set: { status: "accepted", respondedAt: new Date() } },
      { new: true },
    ).lean();

    if (!relation) {
      return NextResponse.json({ error: "ไม่พบคำขอจากผู้ใช้นี้" }, { status: 400 });
    }

    const fromUser = await User.findById(requesterId).select("name").lean();
    const fromUserName = (fromUser as { name?: string } | null)?.name?.trim() || "ผู้ใช้นี้";

    await Notification.updateMany(
      {
        userId: currentUserId,
        type: "FRIEND_REQUEST",
        fromUserId: requesterId,
      },
      {
        $set: {
          title: "เป็นเพื่อนกันแล้ว",
          message: `คุณและ ${fromUserName} เป็นเพื่อนกันแล้ว`,
          friendRequestStatus: "accepted",
          href: "/friends",
        },
      },
    );

    return NextResponse.json({ message: "ยอมรับคำขอเพื่อนสำเร็จ" });
  } catch (error) {
    console.error("Error accepting friend request:", error);
    return NextResponse.json({ error: "Failed to accept friend request" }, { status: 500 });
  }
}
