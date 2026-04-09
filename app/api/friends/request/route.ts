import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";

import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import { notifyFriendRequest } from "@/lib/notify";
import User from "@/models/user";
import FriendRelation, { buildPairKey } from "@/models/friendRelation";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface SendRequestBody {
  targetUserId: string;
}

interface CancelRequestBody {
  targetUserId: string;
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

    const { targetUserId } = (await req.json()) as SendRequestBody;
    if (!targetUserId) {
      return NextResponse.json({ error: "ต้องระบุ targetUserId" }, { status: 400 });
    }

    if (targetUserId === session.user.id) {
      return NextResponse.json({ error: "ไม่สามารถส่งคำขอเพื่อนให้ตัวเอง" }, { status: 400 });
    }

    const requesterId = parseId(session.user.id);
    const addresseeId = parseId(targetUserId);
    if (!requesterId || !addresseeId) {
      return NextResponse.json({ error: "รหัสผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
    }

    await connectMongoDB();

    const targetUser = await User.findById(addresseeId).select("_id").lean();
    if (!targetUser) {
      return NextResponse.json({ error: "ไม่พบผู้ใช้ปลายทาง" }, { status: 404 });
    }

    const pairKey = buildPairKey(requesterId.toString(), addresseeId.toString());
    const existing = await FriendRelation.findOne({ pairKey }).lean();

    if (existing?.status === "accepted") {
      return NextResponse.json({ error: "ผู้ใช้นี้เป็นเพื่อนของคุณแล้ว" }, { status: 400 });
    }

    if (existing?.status === "pending") {
      if (String(existing.requesterId) === String(requesterId)) {
        return NextResponse.json({ error: "คุณได้ส่งคำขอเพื่อนให้ผู้ใช้นี้แล้ว" }, { status: 400 });
      }
      return NextResponse.json({ error: "ผู้ใช้นี้ได้ส่งคำขอมาแล้ว สามารถยอมรับได้ที่หน้าคำขอ" }, { status: 400 });
    }

    await FriendRelation.findOneAndUpdate(
      { pairKey },
      {
        $set: {
          pairKey,
          requesterId,
          addresseeId,
          status: "pending",
          respondedAt: null,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    try {
      await notifyFriendRequest({
        targetUserId: addresseeId.toString(),
        fromUserId: requesterId.toString(),
      });
    } catch (notifyError) {
      console.error("Friend request sent but notify failed:", notifyError);
    }

    return NextResponse.json({ message: "ส่งคำขอเพื่อนสำเร็จ" });
  } catch (error) {
    console.error("Error sending friend request:", error);
    return NextResponse.json({ error: "Failed to send friend request" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions)) as {
      user: SessionUserWithId;
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
    }

    const { targetUserId } = (await req.json()) as CancelRequestBody;
    if (!targetUserId) {
      return NextResponse.json({ error: "ต้องระบุ targetUserId" }, { status: 400 });
    }

    const requesterId = parseId(session.user.id);
    const addresseeId = parseId(targetUserId);
    if (!requesterId || !addresseeId) {
      return NextResponse.json({ error: "รหัสผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
    }

    await connectMongoDB();

    const result = await FriendRelation.findOneAndUpdate(
      {
        pairKey: buildPairKey(requesterId.toString(), addresseeId.toString()),
        requesterId,
        addresseeId,
        status: "pending",
      },
      { $set: { status: "canceled", respondedAt: new Date() } },
      { new: true },
    ).lean();

    if (!result) {
      return NextResponse.json({ error: "ไม่พบคำขอที่ส่งไปยังผู้ใช้นี้" }, { status: 400 });
    }

    return NextResponse.json({ message: "ยกเลิกคำขอเพื่อนสำเร็จ" });
  } catch (error) {
    console.error("Error canceling friend request:", error);
    return NextResponse.json({ error: "Failed to cancel friend request" }, { status: 500 });
  }
}
