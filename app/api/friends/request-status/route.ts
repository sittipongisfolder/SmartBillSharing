import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";

import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import FriendRelation, { buildPairKey } from "@/models/friendRelation";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

export async function GET(req: NextRequest) {
  try {
    const session = (await getServerSession(authOptions)) as {
      user: SessionUserWithId;
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
    }

    const targetUserId = req.nextUrl.searchParams.get("userId")?.trim() ?? "";
    if (!targetUserId) {
      return NextResponse.json({ error: "ต้องระบุ userId" }, { status: 400 });
    }

    if (!mongoose.Types.ObjectId.isValid(session.user.id) || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      return NextResponse.json({ error: "รหัสผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
    }

    await connectMongoDB();

    const relation = await FriendRelation.findOne({
      pairKey: buildPairKey(session.user.id, targetUserId),
    })
      .select("status requesterId")
      .lean();

    const requesterId = relation ? String((relation as { requesterId: unknown }).requesterId) : "";
    const statusRaw = relation ? String((relation as { status: unknown }).status) : "";

    const isFriend = statusRaw === "accepted";
    const hasOutgoing = statusRaw === "pending" && requesterId === session.user.id;
    const hasIncoming = statusRaw === "pending" && requesterId === targetUserId;

    return NextResponse.json({
      isFriend,
      hasOutgoing,
      hasIncoming,
      status: isFriend ? "friend" : hasOutgoing ? "request-sent" : hasIncoming ? "request-received" : "none",
    });
  } catch (error) {
    console.error("Error checking request status:", error);
    return NextResponse.json({ error: "Failed to check request status" }, { status: 500 });
  }
}
