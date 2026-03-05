// app/api/line/unlink/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import type { Session } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUserLike = { _id?: string; id?: string };

function getSessionUserId(session: Session | null): string | null {
  const u = session?.user as SessionUserLike | undefined;
  return u?._id ?? u?.id ?? null;
}

export async function POST() {
  const session = (await getServerSession(authOptions)) as Session | null;
  const userId = getSessionUserId(session);
  if (!userId) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  await connectMongoDB();

  await User.updateOne(
    { _id: userId },
    {
      $set: {
        "line.userId": null,
        "line.linkedAt": null,
        lineNotifyEnabled: false, // ✅ สมัครใหม่/ยังไม่เชื่อม = false
      },
    }
  );

  return NextResponse.json({ ok: true, message: "Unlinked" });
}