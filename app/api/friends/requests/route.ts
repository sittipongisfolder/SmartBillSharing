import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";

import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";
import FriendRelation from "@/models/friendRelation";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

export async function GET() {
  try {
    const session = (await getServerSession(authOptions)) as {
      user: SessionUserWithId;
    } | null;

    if (!session?.user?.id) {
      return NextResponse.json({ error: "ต้องเข้าสู่ระบบก่อน" }, { status: 401 });
    }

    if (!mongoose.Types.ObjectId.isValid(session.user.id)) {
      return NextResponse.json({ error: "รหัสผู้ใช้ไม่ถูกต้อง" }, { status: 400 });
    }

    await connectMongoDB();

    const me = new mongoose.Types.ObjectId(session.user.id);

    const [incomingRelations, outgoingRelations] = await Promise.all([
      FriendRelation.find({ status: "pending", addresseeId: me })
        .select("requesterId")
        .lean(),
      FriendRelation.find({ status: "pending", requesterId: me })
        .select("addresseeId")
        .lean(),
    ]);

    const incomingIds = incomingRelations
      .map((relation) => String((relation as { requesterId: unknown }).requesterId))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const outgoingIds = outgoingRelations
      .map((relation) => String((relation as { addresseeId: unknown }).addresseeId))
      .filter((id) => mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const [incoming, outgoing] = await Promise.all([
      incomingIds.length
        ? User.find({ _id: { $in: incomingIds } }).select("_id name email").lean()
        : [],
      outgoingIds.length
        ? User.find({ _id: { $in: outgoingIds } }).select("_id name email").lean()
        : [],
    ]);

    return NextResponse.json({ incoming, outgoing });
  } catch (error) {
    console.error("Error fetching friend requests:", error);
    return NextResponse.json({ error: "Failed to fetch friend requests" }, { status: 500 });
  }
}
