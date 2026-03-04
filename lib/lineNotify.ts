// lib/lineNotify.ts
import User from "@/models/user";
import { pushText } from "@/lib/line";
import { connectMongoDB } from "@/lib/mongodb";

export async function pushToUserLine(userObjectId: string, text: string) {
  await connectMongoDB();

  const u = await User.findById(userObjectId).select("line lineNotifyEnabled");
  const lineUserId = u?.line?.userId as string | undefined;

  if (!u || !u.lineNotifyEnabled || !lineUserId) return { ok: false, reason: "not_linked" as const };

  try {
    await pushText(lineUserId, text);
    return { ok: true as const };
  } catch (e) {
    // เผื่อ user block OA / token ผิด / push fail
    return { ok: false as const, reason: "push_failed" as const, error: e instanceof Error ? e.message : String(e) };
  }
}