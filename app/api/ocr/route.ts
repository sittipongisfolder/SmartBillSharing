import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function stripCodeFences(s: string) {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (m?.[1] ?? s).trim();
}

function extractJsonObject(text: string): unknown | null {
  const t = stripCodeFences(text);

  try {
    return JSON.parse(t) as unknown;
  } catch {}

  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    const slice = t.slice(first, last + 1);
    try {
      return JSON.parse(slice) as unknown;
    } catch {}
  }

  return null;
}

const toNumber = (v: unknown, fallback = 0) => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

// ✅ กัน HTML หลุดเข้า raw_text
function htmlToText(input: string) {
  const s = input || '';
  if (!s) return s;

  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseItemsFromText(text: string) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\t+/g, ' ').trim())
    .filter(Boolean);

  const skipWords = [
    'total',
    'subtotal',
    'grand',
    'sum',
    'amount',
    'vat',
    'tax',
    'service',
    'change',
    'cash',
    'card',
    'promptpay',
    'qr',
    'รวม',
    'รวมทั้งสิ้น',
    'ยอดรวม',
    'สุทธิ',
    'ภาษี',
    'ค่าบริการ',
    'ทอน',
    'เงินสด',
    'เลขที่',
    'tax',
    'identification',
    'tel',
    'โทร',
    'วันที่',
    'เวลา',
  ];

  // NOTE: price = UNIT PRICE (ราคา/ชิ้น)
  const out: Array<{ name: string; price: number; qty?: number }> = [];

  const cleanName = (s: string) =>
    (s || '')
      .replace(/^\s*\d+[\.\)]\s*/, '') // "1." / "1)"
      .replace(/[:\-–—]+$/g, '')
      .trim();

  let carryName = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();
    if (skipWords.some((w) => lower.includes(w))) continue;

    // ถ้าเป็นบรรทัดชื่ออย่างเดียว (ไม่มีตัวเลข) ให้เก็บไว้รวมกับบรรทัดถัดไป
    const hasNumber = /\d/.test(line);
    const looksLikeNameOnly = !hasNumber && line.length >= 2;
    if (looksLikeNameOnly) {
      carryName = (carryName ? `${carryName} ${line}` : line).trim();
      continue;
    }

    // (1) Pattern คอลัมน์: name + qty + unit + lineTotal
    const mCols = line.match(
      /^(.*?)(?:\s{1,}|\t+)(\d{1,3})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*$/
    );
    if (mCols) {
      const name = cleanName(`${carryName} ${mCols[1] || ''}`.trim());
      carryName = '';
      const qty = toNumber(mCols[2], 1);
      const unit = toNumber(mCols[3], 0);
      const lineTotal = toNumber(mCols[4], 0);
      const price = unit > 0 ? unit : qty > 0 ? lineTotal / qty : 0;
      if (name && qty > 0 && Number.isFinite(price) && price >= 0) {
        out.push({ name, qty, price });
        if (out.length >= 80) break;
      }
      continue;
    }

    // (1.1) Pattern: name + qty + lineTotal (ไม่มี unit)
    const mQtyTotal = line.match(
      /^(.*?)(?:\s{1,}|\t+)(\d{1,3})\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*$/
    );
    if (mQtyTotal) {  
      const name = cleanName(`${carryName} ${mQtyTotal[1] || ''}`.trim());
      carryName = '';
      const qty = toNumber(mQtyTotal[2], 1);
      const lineTotal = toNumber(mQtyTotal[3], 0);
      const price = qty > 0 ? lineTotal / qty : lineTotal;
      if (name && qty > 0 && Number.isFinite(price) && price >= 0) {
        out.push({ name, qty, price });
        if (out.length >= 80) break;
      }
      continue;
    }

    // (2) Pattern ท้ายบรรทัดเป็นราคา
    const m = line.match(
      /^(.*?)(?:\s{1,}|\s*[-:]\s*)(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:บาท|฿|baht)?\s*$/i
    );
    if (!m) continue;

    const name = cleanName(`${carryName} ${m[1] || ''}`.trim());
    carryName = '';
    const price = toNumber(m[2], 0);

    if (!name || !Number.isFinite(price) || price < 0) continue;
    out.push({ name, price, qty: 1 });
    if (out.length >= 80) break;
  }

  return out
    .map((it) => ({ ...it, name: it.name.trim().slice(0, 120) }))
    .filter((it) => it.name);
}

function findTotalFromText(text: string) {
  const t = (text || '').replace(/,/g, '');
  const patterns = [
    /(?:ทั้งหมด)\s*[:\-]?\s*฿?\s*(\d+(?:\.\d{1,2})?)/i,
    /(?:grand\s*total|total\s*amount|total)\s*[:\-]?\s*(\d+(?:\.\d{1,2})?)/i,
    /(?:ยอดรวม|รวมทั้งสิ้น|รวมสุทธิ|สุทธิ|รวม)\s*[:\-]?\s*(\d+(?:\.\d{1,2})?)/i,
  ];

  for (const p of patterns) {
    const m = t.match(p);
    if (m?.[1]) {
      const n = toNumber(m[1], 0);
      if (n > 0) return n;
    }
  }
  return null;
}

function guessTitleFromText(text: string) {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const bad = ['cash sale', 'ใบเสร็จ', 'ใบกำกับ', 'เลขที่', 'tax', 'date', 'address'];

  for (const line of lines.slice(0, 8)) {
    const lower = line.toLowerCase();
    if (bad.some((w) => lower.includes(w))) continue;
    if (line.length >= 3 && !/^\d+(\.\d+)?$/.test(line)) return line;
  }
  return null;
}

/** ---------- Typhoon message types (แทน any[]) ---------- */
type TyphoonTextPart = { type: 'text'; text: string };
type TyphoonImagePart = { type: 'image_url'; image_url: { url: string } };
type TyphoonUserContent = Array<TyphoonTextPart | TyphoonImagePart>;
type TyphoonMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: TyphoonUserContent };

type TyphoonResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  message?: string;
};

async function callTyphoonChat({
  baseUrl,
  apiKey,
  model,
  messages,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: TyphoonMessage[];
}) {
  const payload = { model, messages, temperature: 0 };

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json: TyphoonResponse | null = await r.json().catch(() => null);

  if (!r.ok) {
    return {
      ok: false as const,
      status: r.status,
      error: json?.error?.message || json?.message || `OpenTyphoon error (${r.status})`,
      detail: json,
      content: '',
    };
  }

  const content: string = json?.choices?.[0]?.message?.content ?? '';
  return { ok: true as const, status: 200, error: null, detail: json, content };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');

    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: 'Missing file' }, { status: 400 });
    }

    const apiKey =
      process.env.OPENTYPHOON_API_KEY ||
      process.env.TYPHOON_API_KEY ||
      process.env.TYPHOON_OCR_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        { ok: false, error: 'Missing API key (set OPENTYPHOON_API_KEY in .env.local)' },
        { status: 500 }
      );
    }

    const baseUrl =
      process.env.OPENTYPHOON_BASE_URL ||
      process.env.TYPHOON_BASE_URL ||
      'https://api.opentyphoon.ai/v1';

    const model = process.env.TYPHOON_OCR_MODEL || 'typhoon-ocr';

    const mime = file.type || 'image/jpeg'; // ✅ ไม่ต้อง (file as any)
    const buf = Buffer.from(await file.arrayBuffer());
    const b64 = buf.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    // (A) รอบแรก: ขอ JSON + raw_text แบบ plain text
    const systemParse = `
Return ONLY valid JSON (no markdown, no code fences, no HTML).
Schema:
{
  "title": string|null,
  "items": [{"name": string, "qty": number, "price": number}],
  "total": number|null,
  "currency": string|null,
  "raw_text": string|null
}
Rules (IMPORTANT):
- raw_text MUST be PLAIN TEXT only (no tags), include ALL visible text in reading order with line breaks.
- This is a Thai restaurant receipt. Items are listed in a table like:
  รายการสินค้า | Qty | ราคา | ราคารวม
- For each item row:
  - name = item name (merge wrapped lines into one name).
  - qty = quantity from Qty column (default 1).
  - price = UNIT PRICE (ราคา/ชิ้น). If only line total is available, compute unit price = lineTotal / qty.
- Keep free items with 0.00 price if they are clearly item rows.
- total should be the GRAND TOTAL from the line like "ทั้งหมด" (after service charge/VAT if shown).
- Do NOT include non-item rows (headers, cashier, date/time, service charge lines, totals) as items.
`.trim();

    const userParse = `
อ่านข้อความทั้งหมดจากภาพนี้ออกมาให้ครบ (ใส่ใน raw_text)
แล้วแยก "รายการสินค้า/Qty/ราคา(ต่อชิ้น)/ราคารวม" ให้ถูกต้อง
ส่งออกเป็น JSON ตาม schema เท่านั้น
`.trim();

    const parseResp = await callTyphoonChat({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: systemParse },
        {
          role: 'user',
          content: [
            { type: 'text', text: userParse },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    if (!parseResp.ok) {
      return NextResponse.json(
        { ok: false, error: parseResp.error, detail: parseResp.detail },
        { status: parseResp.status }
      );
    }

    const raw = parseResp.content;

    const parsedUnknown = extractJsonObject(raw);
    const parsed = isRecord(parsedUnknown) ? parsedUnknown : {};

    // ✅ ทำ raw_text ให้เป็น text จริง ๆ (กันกรณีโมเดลเผลอส่ง html)
    let raw_text =
      typeof parsed.raw_text === 'string' && parsed.raw_text.trim()
        ? htmlToText(parsed.raw_text.trim())
        : '';

    // (B) ถ้า raw_text ยังว่าง → OCR-only อีกรอบ (plain text 100%)
    if (!raw_text) {
      const ocrOnly = await callTyphoonChat({
        baseUrl,
        apiKey,
        model,
        messages: [
          {
            role: 'system',
            content:
              'Return ONLY plain text. Include ALL visible text from the image in reading order. Preserve line breaks.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'ดึงข้อความทั้งหมดจากภาพนี้ออกมาให้ครบทุกบรรทัด' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      });

      if (ocrOnly.ok) raw_text = htmlToText((ocrOnly.content || '').trim());
    }

    // ✅ items: ใช้ของโมเดลก่อน ถ้าว่างให้ parse จาก raw_text
    const modelItems: Array<{ name: string; price: number; qty?: number }> = Array.isArray(parsed.items)
      ? parsed.items
          .map((it: unknown) => {
            const obj = isRecord(it) ? it : {};
            return {
              name: String(obj.name ?? '').trim(),
              qty: typeof obj.qty === 'number' ? obj.qty : toNumber(obj.qty, 1),
              price: toNumber(obj.price, 0),
            };
          })
          .filter((it) => it.name && Number.isFinite(it.price) && it.price >= 0) // ✅ อนุญาตราคา 0.00
      : [];

    const fallbackItems = modelItems.length > 0 ? [] : parseItemsFromText(raw_text);
    const items = modelItems.length > 0 ? modelItems : fallbackItems;

    // ✅ total: ใช้ของโมเดลก่อน ถ้าไม่มีหาใน raw_text ถ้ายังไม่มีให้ sum items
    const modelTotal =
      typeof parsed.total === 'number' && Number.isFinite(parsed.total) && parsed.total > 0
        ? parsed.total
        : null;

    const textTotal = modelTotal ? null : findTotalFromText(raw_text);
    const total =
      modelTotal ??
      textTotal ??
      items.reduce((s, it) => s + toNumber(it.price, 0) * toNumber(it.qty, 1), 0);

    // ✅ title: ใช้ของโมเดลก่อน ถ้าไม่มีเดาจาก raw_text
    const title =
      (typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : null) ??
      guessTitleFromText(raw_text);

    return NextResponse.json({
      ok: true,
      raw, // สำหรับ debug
      parsed: {
        title,
        items,
        total,
        currency: (typeof parsed.currency === 'string' ? parsed.currency : 'THB'),
        raw_text: raw_text || null,
      },
    });
  } catch (e: unknown) {
    const msg =
      typeof e === 'object' && e !== null && 'message' in e && typeof (e as { message: unknown }).message === 'string'
        ? (e as { message: string }).message
        : 'Server error';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}