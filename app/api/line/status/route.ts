// app/api/line/status/route.ts
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

export async function GET() {
  const session = (await getServerSession(authOptions)) as Session | null;

  const userId = getSessionUserId(session);
  if (!userId) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  await connectMongoDB();
  const u = await User.findById(userId).select("line lineNotifyEnabled");

  const linked = !!u?.line?.userId;
  return NextResponse.json({
    ok: true,
    linked,
    lineNotifyEnabled: u?.lineNotifyEnabled ?? true,
    linkedAt: u?.line?.linkedAt ?? null,
  });
}