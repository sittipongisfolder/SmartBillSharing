// lib/lineNotify.ts
import User from "@/models/user";
import {
  pushText,
  pushTextAndImage,
  pushTextAndImageWithButtons,
  pushTextWithButtons,
} from "@/lib/line";
import { connectMongoDB } from "@/lib/mongodb";

function extractUrls(text: string) {
  const matches = text.match(/https?:\/\/\S+/gi) ?? [];
  return Array.from(new Set(matches));
}

function removeUrlsFromText(text: string, urls: string[]) {
  let out = text;
  for (const url of urls) {
    out = out.replace(url, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function getButtonLabel(url: string) {
  if (/\/friends\b/i.test(url)) return "ดูคำขอเพื่อน";
  if (/\/history\b/i.test(url)) return "เปิดบิล";
  if (/\/login\b/i.test(url)) return "เข้าสู่ระบบ";
  return "เปิดลิงก์";
}

export async function pushToUserLine(userObjectId: string, text: string) {
  await connectMongoDB();

  const u = await User.findById(userObjectId).select("line lineNotifyEnabled");
  const lineUserId = u?.line?.userId as string | undefined;
  const lineNotifyEnabled = u?.lineNotifyEnabled ?? true;

  if (!u || !lineNotifyEnabled || !lineUserId) return { ok: false, reason: "not_linked" as const };

  try {
    const urls = extractUrls(text);
    if (urls.length > 0) {
      await pushTextWithButtons(
        lineUserId,
        removeUrlsFromText(text, urls),
        urls.map((url) => ({ url, label: getButtonLabel(url) }))
      );
    } else {
      await pushText(lineUserId, text);
    }
    return { ok: true as const };
  } catch (e) {
    // เผื่อ user block OA / token ผิด / push fail
    return { ok: false as const, reason: "push_failed" as const, error: e instanceof Error ? e.message : String(e) };
  }
}

function canUseLineImageUrl(imageUrl: string) {
  try {
    const url = new URL(imageUrl);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function pushToUserLineWithImage(userObjectId: string, text: string, imageUrl: string) {
  await connectMongoDB();

  const u = await User.findById(userObjectId).select("line lineNotifyEnabled");
  const lineUserId = u?.line?.userId as string | undefined;
  const lineNotifyEnabled = u?.lineNotifyEnabled ?? true;

  if (!u || !lineNotifyEnabled || !lineUserId) return { ok: false, reason: "not_linked" as const };

  try {
    const urls = extractUrls(text);
    if (canUseLineImageUrl(imageUrl)) {
      if (urls.length > 0) {
        await pushTextAndImageWithButtons(
          lineUserId,
          removeUrlsFromText(text, urls),
          imageUrl,
          urls.map((url) => ({ url, label: getButtonLabel(url) }))
        );
      } else {
        await pushTextAndImage(lineUserId, text, imageUrl);
      }
    } else {
      if (urls.length > 0) {
        await pushTextWithButtons(
          lineUserId,
          removeUrlsFromText(text, urls),
          urls.map((url) => ({ url, label: getButtonLabel(url) }))
        );
      } else {
        await pushText(lineUserId, text);
      }
    }
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, reason: "push_failed" as const, error: e instanceof Error ? e.message : String(e) };
  }
}