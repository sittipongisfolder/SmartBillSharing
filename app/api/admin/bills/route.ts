import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import mongoose from "mongoose";
import { authOptions } from "@/lib/authOptions";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";
import Bill from "@/models/bill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toInt = (v: string | null, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const pickOwnerId = (b: Record<string, unknown>): string | null => {
  const raw = (b.ownerId ?? b.createdBy) as unknown;
  if (!raw) return null;

  if (typeof raw === "string") return raw;
  if (raw instanceof mongoose.Types.ObjectId) return raw.toString();

  if (typeof raw === "object" && raw && "_id" in raw) {
    const idVal = (raw as { _id: unknown })._id;
    if (idVal instanceof mongoose.Types.ObjectId) return idVal.toString();
    if (typeof idVal === "string") return idVal;
    try {
      return String(idVal);
    } catch {
      return null;
    }
  }

  try {
    return String(raw);
  } catch {
    return null;
  }
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

  const q = url.searchParams.get("q")?.trim() ?? "";
  const status = url.searchParams.get("status")?.trim() ?? "";
  const splitType = url.searchParams.get("splitType")?.trim() ?? "";

  // ✅ สำคัญ: แยก param ให้เป็น string | null แล้วค่อยตรวจ
  const ownerIdParam = url.searchParams.get("ownerId"); // string | null

  const page = Math.max(1, toInt(url.searchParams.get("page"), 1));
  const limit = Math.min(
    50,
    Math.max(5, toInt(url.searchParams.get("limit"), 10)),
  );
  const skip = (page - 1) * limit;

  const match: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];

  // ✅ ownerId filter (กัน null ก่อนสร้าง ObjectId)
  if (typeof ownerIdParam === "string" && ownerIdParam.trim()) {
    const ownerId = ownerIdParam.trim();

    if (!mongoose.Types.ObjectId.isValid(ownerId)) {
      return NextResponse.json(
        { ok: false, error: "Invalid ownerId" },
        { status: 400 },
      );
    }

    const oid = new mongoose.Types.ObjectId(ownerId);
    and.push({ $or: [{ ownerId: oid }, { createdBy: oid }] });
  }

  // ✅ status filter (รองรับ status หรือ billStatus)
  if (status) {
    and.push({ $or: [{ status }, { billStatus: status }] });
  }

  // ✅ splitType filter
  if (splitType) {
    match.splitType = splitType;
  }

  // ✅ search q: title หรือ owner (name/email/userId)
  if (q) {
    const users = await User.find({
      $or: [
        { email: { $regex: q, $options: "i" } },
        { name: { $regex: q, $options: "i" } },
        { userId: { $regex: q, $options: "i" } },
      ],
    })
      .select("_id")
      .lean();

    const ids = users
      .map((u: { _id: unknown }) => String(u._id))
      .filter(
        (id): id is string =>
          typeof id === "string" && mongoose.Types.ObjectId.isValid(id),
      )
      .map((id) => new mongoose.Types.ObjectId(id));

    and.push({
      $or: [
        { title: { $regex: q, $options: "i" } },
        ...(ids.length
          ? [{ ownerId: { $in: ids } }, { createdBy: { $in: ids } }]
          : []),
      ],
    });
  }

  if (and.length) match.$and = and;

  const total = await Bill.countDocuments(match);

  const rawBills = (await Bill.find(match)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean()) as unknown as Array<Record<string, unknown>>;

  // ✅ ownerIds: กัน null ก่อนสร้าง ObjectId
  const ownerIdStrings = rawBills
    .map((b) => pickOwnerId(b)) // (string | null)[]
    .filter(
      (x): x is string =>
        typeof x === "string" && mongoose.Types.ObjectId.isValid(x),
    );

  const uniqueOwnerIds = Array.from(new Set(ownerIdStrings));
  const ownerObjectIds = uniqueOwnerIds.map(
    (id) => new mongoose.Types.ObjectId(id),
  );

  const owners =
    ownerObjectIds.length > 0
      ? await User.find({ _id: { $in: ownerObjectIds } })
          .select("_id name email userId")
          .lean()
      : [];

  const ownerMap = new Map(
    owners.map(
      (u: {
        _id: unknown;
        name?: unknown;
        email?: unknown;
        userId?: unknown;
      }) => [
        String(u._id),
        {
          id: String(u._id),
          name: typeof u.name === "string" ? u.name : null,
          email: typeof u.email === "string" ? u.email : null,
          userId: typeof u.userId === "string" ? u.userId : null,
        },
      ],
    ),
  );

  const items = rawBills.map((b) => {
    const id = String(b._id ?? "");
    const ownerKey = pickOwnerId(b);
    const owner = ownerKey ? (ownerMap.get(ownerKey) ?? null) : null;

    const titleVal = typeof b.title === "string" ? b.title : "-";
    const totalVal = typeof b.total === "number" ? b.total : null;
    const splitVal = typeof b.splitType === "string" ? b.splitType : null;

    const st =
      (typeof b.status === "string" ? b.status : null) ??
      (typeof b.billStatus === "string" ? b.billStatus : null);

    const createdAt =
      typeof b.createdAt === "string"
        ? b.createdAt
        : b.createdAt instanceof Date
          ? b.createdAt.toISOString()
          : b.createdAt
            ? String(b.createdAt)
            : null;

    const updatedAt =
      typeof b.updatedAt === "string"
        ? b.updatedAt
        : b.updatedAt instanceof Date
          ? b.updatedAt.toISOString()
          : b.updatedAt
            ? String(b.updatedAt)
            : null;

    return {
      id,
      title: titleVal,
      total: totalVal,
      splitType: splitVal,
      status: st,
      owner,
      createdAt,
      updatedAt,
    };
  });

  return NextResponse.json({ ok: true, page, limit, total, items });
}
