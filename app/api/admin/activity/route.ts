import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import AuditLog from "@/models/auditLog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toInt = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  await connectMongoDB();
  const url = new URL(req.url);

  const action = url.searchParams.get("action")?.trim() ?? "";
  const actor = url.searchParams.get("actor")?.trim() ?? ""; // email or id
  const page = Math.max(1, toInt(url.searchParams.get("page"), 1));
  const limit = Math.min(
    50,
    Math.max(10, toInt(url.searchParams.get("limit"), 20)),
  );
  const skip = (page - 1) * limit;

  const match: Record<string, unknown> = {};
  if (action) match.action = action;

  if (actor) {
    match.$or = [
      { actorId: { $regex: actor, $options: "i" } },
      { actorEmail: { $regex: actor, $options: "i" } },
    ];
  }

  const total = await AuditLog.countDocuments(match);

  const logs = await AuditLog.find(match)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  return NextResponse.json({ ok: true, page, limit, total, items: logs });
}
