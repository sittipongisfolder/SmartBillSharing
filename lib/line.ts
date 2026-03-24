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
type LineUriAction = {
  type: "uri";
  label: string;
  uri: string;
};
type LineButtonsTemplate = {
  type: "buttons";
  text: string;
  actions: LineUriAction[];
};
type LineTemplateMessage = {
  type: "template";
  altText: string;
  template: LineButtonsTemplate;
};
type LinePushMessage = LineTextMessage | LineImageMessage | LineTemplateMessage;

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

export async function pushTextWithButton(
  lineUserId: string,
  text: string,
  url: string,
  buttonLabel = "เปิดลิงก์"
) {
  return pushTextWithButtons(lineUserId, text, [{ url, label: buttonLabel }]);
}

export async function pushTextWithButtons(
  lineUserId: string,
  text: string,
  actions: Array<{ url: string; label: string }>
) {
  const uriActions: LineUriAction[] = actions.slice(0, 4).map((a) => ({
    type: "uri",
    label: a.label.slice(0, 20),
    uri: a.url,
  }));

  if (uriActions.length === 0) {
    return pushText(lineUserId, text);
  }

  const payload = {
    to: lineUserId,
    messages: [
      { type: "text", text } satisfies LineTextMessage,
      {
        type: "template",
        altText: "เปิดลิงก์",
        template: {
          type: "buttons",
          text: "กดปุ่มด้านล่างเพื่อเปิดลิงก์",
          actions: uriActions,
        } satisfies LineButtonsTemplate,
      } satisfies LineTemplateMessage,
    ] satisfies LinePushMessage[],
  };
  await lineFetch("/message/push", payload);
}

export async function pushTextAndImageWithButton(
  lineUserId: string,
  text: string,
  imageUrl: string,
  url: string,
  buttonLabel = "เปิดลิงก์"
) {
  return pushTextAndImageWithButtons(lineUserId, text, imageUrl, [{ url, label: buttonLabel }]);
}

export async function pushTextAndImageWithButtons(
  lineUserId: string,
  text: string,
  imageUrl: string,
  actions: Array<{ url: string; label: string }>
) {
  const uriActions: LineUriAction[] = actions.slice(0, 4).map((a) => ({
    type: "uri",
    label: a.label.slice(0, 20),
    uri: a.url,
  }));

  if (uriActions.length === 0) {
    return pushTextAndImage(lineUserId, text, imageUrl);
  }

  const payload = {
    to: lineUserId,
    messages: [
      { type: "text", text } satisfies LineTextMessage,
      {
        type: "image",
        originalContentUrl: imageUrl,
        previewImageUrl: imageUrl,
      } satisfies LineImageMessage,
      {
        type: "template",
        altText: "เปิดลิงก์",
        template: {
          type: "buttons",
          text: "กดปุ่มด้านล่างเพื่อเปิดลิงก์",
          actions: uriActions,
        } satisfies LineButtonsTemplate,
      } satisfies LineTemplateMessage,
    ] satisfies LinePushMessage[],
  };
  await lineFetch("/message/push", payload);
}