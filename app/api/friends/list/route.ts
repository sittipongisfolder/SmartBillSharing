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
    const relations = await FriendRelation.find({
      status: "accepted",
      $or: [{ requesterId: me }, { addresseeId: me }],
    })
      .select("requesterId addresseeId")
      .lean();

    const friendIds = Array.from(
      new Set(
        relations
          .map((relation) => {
            const requester = String((relation as { requesterId: unknown }).requesterId);
            const addressee = String((relation as { addresseeId: unknown }).addresseeId);
            return requester === String(me) ? addressee : requester;
          })
          .filter((id) => mongoose.Types.ObjectId.isValid(id)),
      ),
    ).map((id) => new mongoose.Types.ObjectId(id));

    const friends = friendIds.length
      ? await User.find({ _id: { $in: friendIds } }).select("_id name email").lean()
      : [];

    return NextResponse.json({ friends });
  } catch (error) {
    console.error("Error fetching friends:", error);
    return NextResponse.json({ error: "Failed to fetch friends" }, { status: 500 });
  }
}
