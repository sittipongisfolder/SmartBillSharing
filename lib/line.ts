// lib/line.ts
import crypto from "crypto";

const LINE_API = "https://api.line.me/v2/bot";

function timingSafeEqual(a: string, b: string) {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function verifyLineSignature(rawBody: string, signature: string, channelSecret: string) {
  const digest = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  return timingSafeEqual(digest, signature);
}

type LineTextMessage = { type: "text"; text: string };
type LineImageMessage = {
  type: "image";
  originalContentUrl: string;
  previewImageUrl: string;
};
type LinePushMessage = LineTextMessage | LineImageMessage;

async function lineFetch(path: string, body: unknown) {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");

  const res = await fetch(`${LINE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`LINE API error ${res.status}: ${t}`);
  }
}

export async function replyText(replyToken: string, text: string) {
  const payload = { replyToken, messages: [{ type: "text", text } satisfies LineTextMessage] };
  await lineFetch("/message/reply", payload);
}

export async function pushText(lineUserId: string, text: string) {
  const payload = { to: lineUserId, messages: [{ type: "text", text } satisfies LineTextMessage] };
  await lineFetch("/message/push", payload);
}

export async function pushTextAndImage(lineUserId: string, text: string, imageUrl: string) {
  const payload = {
    to: lineUserId,
    messages: [
      { type: "text", text } satisfies LineTextMessage,
      {
        type: "image",
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      } satisfies LineImageMessage,
    ] satisfies LinePushMessage[],
  };
  await lineFetch("/message/push", payload);
}