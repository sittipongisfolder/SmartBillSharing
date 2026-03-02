// app/api/line/link-code/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getServerSession, Session } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import LineLinkCode from "@/models/lineLinkCode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SessionUserLike = { _id?: string; id?: string };

function random6Digits() {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

function hashCode(code: string) {
  const salt = process.env.LINE_LINK_CODE_SALT;
  if (!salt) throw new Error("Missing LINE_LINK_CODE_SALT");
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function getSessionUserId(session: Session | null): string | null {
  const u = session?.user as SessionUserLike | undefined;
  return u?._id ?? u?.id ?? null;
}

export async function POST() {
  const session = await getServerSession(authOptions);
  const userId = getSessionUserId(session);
  if (!userId) return NextResponse.json({ ok: false, message: "Unauthorized" }, { status: 401 });

  await connectMongoDB();

  // ให้เหลือโค้ด active ได้แค่ 1 ชุดต่อ user
  await LineLinkCode.deleteMany({ userId, usedAt: null });

  const code = random6Digits();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const codeHash = hashCode(code);

  try {
    await LineLinkCode.create({ userId, codeHash, expiresAt, usedAt: null });
  } catch {
    // กันกรณี hash ชนกัน (น้อยมาก)
    const code2 = random6Digits();
    const codeHash2 = hashCode(code2);
    await LineLinkCode.create({ userId, codeHash: codeHash2, expiresAt, usedAt: null });
    return NextResponse.json({ ok: true, code: code2, expiresAt });
  }

  return NextResponse.json({ ok: true, code, expiresAt });
}