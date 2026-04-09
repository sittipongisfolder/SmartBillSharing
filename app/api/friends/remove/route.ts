import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";

import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import FriendRelation, { buildPairKey } from "@/models/friendRelation";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface RemoveFriendBody {
  friendUserId: string;
}

export async function POST(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions)) as {
      user: SessionUserWithId;
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
    }

    const { friendUserId } = (await req.json()) as RemoveFriendBody;
    if (!friendUserId) {
      return NextResponse.json({ error: "ต้องระบุ friendUserId" }, { status: 400 });
    }

    if (!mongoose.Types.ObjectId.isValid(session.user.id) || !mongoose.Types.ObjectId.isValid(friendUserId)) {
      return NextResponse.json({ error: "รหัสผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
    }

    await connectMongoDB();

    const result = await FriendRelation.deleteOne({
      pairKey: buildPairKey(session.user.id, friendUserId),
      status: "accepted",
    });

    if (!result.deletedCount) {
      return NextResponse.json({ error: "ไม่พบสถานะเพื่อนที่ต้องลบ" }, { status: 400 });
    }

    return NextResponse.json({ message: "ลบเพื่อนสำเร็จ" });
  } catch (error) {
    console.error("Error removing friend:", error);
    return NextResponse.json({ error: "Failed to remove friend" }, { status: 500 });
  }
}
