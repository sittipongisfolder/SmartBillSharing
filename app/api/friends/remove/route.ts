import { NextRequest, NextResponse } from "next/server";
import { getServerSession, DefaultUser } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import User from "@/models/user";
import { connectMongoDB } from "@/lib/mongodb";

interface SessionUserWithId extends DefaultUser {
  id: string;
}

interface RemoveFriendBody {
  friendUserId: string;
}

// ✅ DELETE /api/friends/remove - ลบเพื่อน
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

    const { friendUserId } = (await req.json()) as RemoveFriendBody;

    if (!friendUserId) {
      return NextResponse.json(
        { error: "ต้องระบุ friendUserId" },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // ✅ ลบออกจากรายชื่อเพื่อน
    await User.updateOne(
      { _id: session.user.id },
      {
        $pull: {
          friends: friendUserId,
        },
      }
    );

    // ✅ ลบออกจากรายชื่อเพื่อนของเพื่อนด้วย
    await User.updateOne(
      { _id: friendUserId },
      {
        $pull: {
          friends: session.user.id,
        },
      }
    );

    return NextResponse.json({
      message: "ลบเพื่อนสำเร็จ",
    });
  } catch (error) {
    console.error("❌ Error removing friend:", error);
    return NextResponse.json(
      { error: "Failed to remove friend" },
      { status: 500 }
    );
  }
}
