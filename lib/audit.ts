import { headers } from "next/headers";
import { connectMongoDB } from "@/lib/mongodb";
import AuditLog, { AuditAction } from "@/models/auditLog";

export async function writeAuditLog(input: {
  actorId: string;
  actorEmail: string | null;
  action: AuditAction;
  targetType: "bill" | "user" | "system";
  targetId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await connectMongoDB();

  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = h.get("user-agent") ?? null;

  await AuditLog.create({
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    meta: input.meta ?? {},
    ip,
    userAgent,
  });
}