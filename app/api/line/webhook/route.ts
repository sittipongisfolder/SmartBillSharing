// app/api/line/webhook/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { connectMongoDB } from "@/lib/mongodb";
import LineLinkCode from "@/models/lineLinkCode";
import User from "@/models/user";
import { replyText, verifyLineSignature } from "@/lib/line";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineSourceUser = { type: "user"; userId: string };

type LineEventFollow = {
  type: "follow";
  replyToken: string;
  source: LineSourceUser;
};

type LineEventMessageText = {
  type: "message";
  replyToken: string;
  source: LineSourceUser;
  message: { type: "text"; text: string };
};

type LineWebhookBody = {
  events: Array<LineEventFollow | LineEventMessageText | Record<string, unknown>>;
};

function hashCode(code: string) {
  const salt = process.env.LINE_LINK_CODE_SALT;
  if (!salt) throw new Error("Missing LINE_LINK_CODE_SALT");
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function parseLinkCommand(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(/^link\s+(\d{6})$/i) ||
    t.match(/^ผูกบัญชี\s*(\d{6})$/) ||
    t.match(/^เชื่อมบัญชี\s*(\d{6})$/);
  return m?.[1] ?? null;
}
export async function GET() {
  return Response.json({ ok: true, message: "LINE webhook is up" });
}

export async function POST(request: Request) {
  // ต้องอ่าน raw ก่อน แล้ว verify signature
  const rawBody = await request.text();
  const sig = request.headers.get("x-line-signature") ?? "";
  const secret = process.env.LINE_CHANNEL_SECRET ?? "";

  if (!secret || !sig) return NextResponse.json({ ok: false }, { status: 401 });
  if (!verifyLineSignature(rawBody, sig, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  let body: LineWebhookBody;
  try {
    body = JSON.parse(rawBody) as LineWebhookBody;
  } catch {
    return NextResponse.json({ ok: true });
  }

  const events = body.events ?? [];
  if (events.length === 0) return NextResponse.json({ ok: true });

  await connectMongoDB();

  for (const ev of events) {
    // follow = แอด OA
    if ((ev as LineEventFollow).type === "follow") {
      const e = ev as LineEventFollow;
      await replyText(
        e.replyToken,
        "สวัสดีครับ 👋\nเพื่อรับแจ้งเตือน Smart Bill:\n1) ไปที่เว็บ > Settings > เชื่อม LINE\n2) คัดลอกรหัส 6 หลัก\n3) กลับมาพิมพ์: LINK 123456 \n https://smart-bill-sharing.vercel.app/dashboard"
      );
      continue;
    }

    // message text
    if ((ev as LineEventMessageText).type === "message") {
      const e = ev as LineEventMessageText;
      if (e.message?.type !== "text") continue;

      const lineUserId = e.source?.userId;
      if (!lineUserId) continue;

      const code = parseLinkCommand(e.message.text);
      if (!code) {
        const t = e.message.text.trim().toLowerCase();
        if (t === "help" || t === "ช่วยเหลือ" || t === "เชื่อมบัญชี") {
          await replyText(e.replyToken, "พิมพ์: LINK 123456 (เอารหัสจากหน้าเว็บ Settings)");
        }
        continue;
      }

      const codeHash = hashCode(code);

      const linkDoc = await LineLinkCode.findOne({
        codeHash,
        usedAt: null,
        expiresAt: { $gt: new Date() },
      });

      if (!linkDoc) {
        await replyText(e.replyToken, "❌ รหัสไม่ถูกต้องหรือหมดอายุ\nกรุณาสร้างรหัสใหม่จากหน้าเว็บ แล้วลองอีกครั้ง");
        continue;
      }

      // กัน LINE userId ไปผูกกับ user คนอื่น
      const conflict = await User.findOne({
        "line.userId": lineUserId,
        _id: { $ne: linkDoc.userId },
      }).select("_id");

      if (conflict) {
        await replyText(e.replyToken, "❌ LINE นี้ถูกผูกกับบัญชีอื่นแล้ว\nหากต้องการย้าย ให้ยกเลิกการเชื่อมในเว็บก่อน");
        continue;
      }

      await User.updateOne(
        { _id: linkDoc.userId },
        { $set: { "line.userId": lineUserId, "line.linkedAt": new Date(), lineNotifyEnabled: true } }
      );

      linkDoc.usedAt = new Date();
      await linkDoc.save();

      await replyText(e.replyToken, "✅ เชื่อมบัญชีสำเร็จ!\nจากนี้คุณจะได้รับการแจ้งเตือนผ่าน LINE OA");
    }
  }

  return NextResponse.json({ ok: true });
}