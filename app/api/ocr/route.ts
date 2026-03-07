import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OCRNormalizedItem = {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

type OCRParsedPayload = {
  title: string | null;
  items: OCRNormalizedItem[];
  total: number | null;
  raw_text: string | null;
};

function stripCodeFences(s: string) {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (m?.[1] ?? s).trim();
}

function extractJsonObject(text: string): unknown | null {
  const t = stripCodeFences(text);

  try {
    return JSON.parse(t) as unknown;
  } catch {}

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const slice = t.slice(first, last + 1);
    try {
      return JSON.parse(slice) as unknown;
    } catch {}
  }

  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toNumber(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function cleanSpaces(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function compactForCompare(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9\u0E00-\u0E7F]/g, "");
}

function positiveNumberOrNull(v: unknown) {
  const n = toNumber(v, Number.NaN);
  return Number.isFinite(n) && n > 0 ? round2(n) : null;
}

// ✅ กัน HTML หลุดเข้า raw_text
function htmlToText(input: string) {
  const s = input || "";
  if (!s) return s;

  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ✅ ช่วยแตกบรรทัดเมื่อ raw_text ยุบเป็นก้อนเดียว
function normalizeRawTextForParsing(text: string) {
  let s = (text || "").trim();
  if (!s) return s;

  const nlCount = (s.match(/\n/g) || []).length;

  if (nlCount < 2) {
    s = s
      .replace(
        /\b(Sub\s*Total|Subtotal|Grand\s*Total|Total|Vatable|VAT|Service|Change|Amount\s*Net|Before\s*VAT)\b/gi,
        "\n$1",
      )
      .replace(/\b(\d{1,2})\s*x\s+/gi, "\n$1 x ")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  return s;
}

function cleanTitleCandidate(line: string) {
  return cleanSpaces(
    line
      .replace(/^[|:;,\-._~"'`]+/, "")
      .replace(/[|:;,\-._~"'`]+$/, "")
      .replace(/\s+(?:TAKE\s*AWAY|DINE\s*IN)\s*$/i, "")
      .replace(/\s+BY\s+.+$/i, "")
      .trim(),
  );
}

function isBadTitleCandidate(line: string) {
  const t = cleanTitleCandidate(line);
  if (!t) return true;

  const upper = t.toUpperCase();

  if (t.length < 3 || t.length > 48) return true;
  if (!/[A-Za-z\u0E00-\u0E7F]/.test(t)) return true;
  if (/^\(?BOX\)?\s*\d*$/i.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  if (/^\s*\d{1,2}\s*x\b/i.test(t)) return true;
  if (/\d{1,3}(?:,\d{3})*\.\d{2}/.test(t)) return true;
  if ((t.match(/\d/g) || []).length >= 5) return true;

  const badWords = [
    "RECEIPT",
    "TAX",
    "TAX ID",
    "TAX INVOICE",
    "CASHIER",
    "DATE",
    "TIME",
    "TABLE",
    "QUEUE",
    "ORDER",
    "TEL",
    "PHONE",
    "MOBILE",
    "ADDRESS",
    "ROAD",
    "SOI",
    "BANGKOK",
    "THAILAND",
    "PATHUMWAN",
    "SUBTOTAL",
    "TOTAL",
    "AMOUNT",
    "AMOUNT NET",
    "BEFORE VAT",
    "VAT",
    "SERVICE",
    "CHANGE",
    "THANK YOU",
    "ITEMS",
    "TAKE AWAY",
    "DINE IN",
    "CREDIT",
    "PROMPTPAY",
    "KPLUS",
    "QR",
    "เลขที่",
    "ใบเสร็จ",
    "ใบกำกับ",
    "วันที่",
    "เวลา",
    "ยอดรวม",
    "สุทธิ",
    "ภาษี",
    "เงินสด",
    "ทอน",
  ];

  if (badWords.some((w) => upper.includes(w))) return true;

  return false;
}

function scoreTitleCandidate(line: string) {
  const t = cleanTitleCandidate(line);
  if (!t || isBadTitleCandidate(t)) return -999;

  let score = 0;
  const wordCount = t.split(/\s+/).filter(Boolean).length;

  if (/^[A-Z0-9&().,'/\- ]+$/.test(t)) score += 3;
  if (!/\d/.test(t)) score += 2;
  if (t.length >= 4 && t.length <= 24) score += 3;
  if (wordCount >= 1 && wordCount <= 4) score += 3;
  if (/^[A-Z][A-Z0-9&().,'/\- ]+$/.test(t)) score += 2;

  if (/\b(CO|CO\.|LTD|LTD\.|COMPANY|BRANCH|สาขา)\b/i.test(t)) score -= 4;
  if (/\b(BY|BOX)\b/i.test(t)) score -= 3;
  if ((t.match(/[A-Za-z\u0E00-\u0E7F]/g) || []).length < 3) score -= 3;

  return score;
}

function extractMerchantCandidates(text: string) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => cleanTitleCandidate(line))
    .filter(Boolean);

  const scored = lines
    .slice(0, 20)
    .map((line) => ({ line, score: scoreTitleCandidate(line) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const unique: string[] = [];
  const seen = new Set<string>();

  for (const item of scored) {
    const key = compactForCompare(item.line);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(item.line);
  }

  return unique;
}

function sanitizeTitle(title: unknown, rawText: string) {
  const rawTitle = typeof title === "string" ? cleanSpaces(title) : "";
  const titleCandidates = extractMerchantCandidates(rawText);

  if (rawTitle) {
    const rawTitleCompact = compactForCompare(rawTitle);

    for (const candidate of titleCandidates) {
      const candidateCompact = compactForCompare(candidate);
      if (candidateCompact && rawTitleCompact.includes(candidateCompact)) {
        return candidate;
      }
    }

    const cleanedRawTitle = cleanTitleCandidate(rawTitle);
    if (!isBadTitleCandidate(cleanedRawTitle)) {
      return cleanedRawTitle;
    }
  }

  if (titleCandidates.length > 0) {
    return titleCandidates[0];
  }

  return null;
}

function isBadItemName(name: string) {
  const n = cleanSpaces(name);
  if (!n) return true;
  if (n.length < 2) return true;

  const lower = n.toLowerCase();

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(n)) return true;
  if (/^\d{1,2}:\d{2}/.test(n)) return true;
  if (/^\d+$/.test(n)) return true;

  const badPhrases = [
    "qty",
    "price",
    "amount",
    "subtotal",
    "grand total",
    "total",
    "vat",
    "tax",
    "service",
    "change",
    "cashier",
    "receipt",
    "thank you",
    "date",
    "time",
    "table",
    "queue",
    "order",
    "promptpay",
    "kplus",
    "qr",
    "items",
    "รายการสินค้า",
    "วันที่",
    "เวลา",
    "ยอดรวม",
    "รวมทั้งสิ้น",
    "ภาษี",
    "เงินสด",
    "ทอน",
    "ทานที่ร้าน",
    "รับกลับบ้าน",
    "take away",
    "dine in",
  ];

  return badPhrases.some((w) => lower.includes(w));
}

function parseItemsFromText(text: string) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\t+/g, " ").trim())
    .filter(Boolean);

  const skipWords = [
    "total",
    "subtotal",
    "grand",
    "sum",
    "amount",
    "amount net",
    "before vat",
    "vat",
    "tax",
    "service",
    "change",
    "cash",
    "card",
    "promptpay",
    "qr",
    "receipt",
    "cashier",
    "date",
    "time",
    "tel",
    "phone",
    "address",
    "thank you",
    "รวม",
    "รวมทั้งสิ้น",
    "ยอดรวม",
    "สุทธิ",
    "ภาษี",
    "ค่าบริการ",
    "ทอน",
    "เงินสด",
    "เลขที่",
    "โทร",
    "วันที่",
    "เวลา",
    "ใบเสร็จ",
  ];

  const cutAtFirstSkipWord = (line: string) => {
    const lower = line.toLowerCase();
    let idx = -1;

    for (const w of skipWords) {
      const j = lower.indexOf(w);
      if (j !== -1) idx = idx === -1 ? j : Math.min(idx, j);
    }

    if (idx === -1) return { line, starts: false };
    return { line: line.slice(0, idx).trim(), starts: idx === 0 };
  };

  const stripTailTaxCode = (line: string) =>
    line.replace(/\s+(?:VD|V|VI|NV)\s*$/i, "").trim();

  const cleanName = (s: string) =>
    (s || "")
      .replace(/^\s*\d+[\.\)]\s*/, "")
      .replace(/[:\-–—]+$/g, "")
      .trim();

  const out: Array<{ name: string; price: number; qty: number }> = [];
  let carryName = "";
  let lastIdx = -1;

  for (const rawLine of lines) {
    const cut = cutAtFirstSkipWord(rawLine);
    if (cut.starts) continue;

    const line0 = stripTailTaxCode(cut.line);
    if (!line0) continue;

    const hasMoney = /\d{1,3}(?:,\d{3})*\.\d{2}/.test(line0);
    const hasLetters = /[A-Za-z\u0E00-\u0E7F]/.test(line0);

    // modifier เช่น "1 x Bubble" (ไม่มีราคา) → แนบกับ item ก่อนหน้า
    const mOpt = line0.match(/^\s*(\d{1,2})\s*x\s*(.+)$/i);
    if (mOpt && !hasMoney) {
      const optName = cleanName(mOpt[2] || "");
      if (lastIdx !== -1 && optName) {
        out[lastIdx].name = `${out[lastIdx].name} (${optName})`;
      }
      continue;
    }

    // ชื่ออย่างเดียว รอไปรวมกับบรรทัดถัดไป
    if (hasLetters && !hasMoney) {
      carryName = cleanName(carryName ? `${carryName} ${line0}` : line0);
      continue;
    }

    // name + qty + unit + lineTotal
    const mCols = line0.match(
      /^(.*?)(?:\s{1,}|\t+)(\d{1,3})\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*$/,
    );
    if (mCols) {
      const name = cleanName(`${carryName} ${mCols[1] || ""}`.trim());
      carryName = "";

      const qty = Math.max(1, Math.floor(toNumber(mCols[2], 1)));
      const unit = toNumber(mCols[3], -1);
      const lineTotal = toNumber(mCols[4], -1);
      const price =
        unit >= 0 ? unit : lineTotal >= 0 && qty > 0 ? lineTotal / qty : -1;

      if (name && qty > 0 && Number.isFinite(price) && price >= 0) {
        out.push({ name, qty, price: round2(price) });
        lastIdx = out.length - 1;
      }
      continue;
    }

    // name + qty + unitPrice
    const mQtyUnit = line0.match(
      /^(.*?)(?:\s{1,}|\t+)(\d{1,3})\s+(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*$/,
    );
    if (mQtyUnit) {
      const name = cleanName(`${carryName} ${mQtyUnit[1] || ""}`.trim());
      carryName = "";

      const qty = Math.max(1, Math.floor(toNumber(mQtyUnit[2], 1)));
      const unit = toNumber(mQtyUnit[3], -1);

      if (name && qty > 0 && Number.isFinite(unit) && unit >= 0) {
        out.push({ name, qty, price: round2(unit) });
        lastIdx = out.length - 1;
      }
      continue;
    }

    // name ... price
    const m = line0.match(
      /^(.*?)(?:\s{1,}|\s*[-:]\s*)(-?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:บาท|฿|baht)?\s*$/i,
    );
    if (!m) continue;

    const name = cleanName(`${carryName} ${m[1] || ""}`.trim());
    carryName = "";
    const price = toNumber(m[2], -1);

    if (!name || !Number.isFinite(price) || price < 0) continue;

    out.push({ name, price: round2(price), qty: 1 });
    lastIdx = out.length - 1;
  }

  return out
    .map((it) => ({
      ...it,
      name: cleanSpaces(it.name).slice(0, 120),
      price: round2(it.price),
      qty: Math.max(1, Math.floor(it.qty)),
    }))
    .filter((it) => it.name);
}

function findTotalFromText(text: string) {
  const lines = (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const lastMoneyOnLine = (line: string) => {
    const matches = [...line.matchAll(/(\d{1,3}(?:,\d{3})*\.\d{2})/g)];
    if (matches.length === 0) return null;
    return toNumber(matches[matches.length - 1][1], 0);
  };

  const priority = [
    /(grand\s*total|amount\s*net|ทั้งหมด|รวมทั้งสิ้น|ยอดสุทธิ)/i,
    /(^|\b)total(\b|$)/i,
    /(sub\s*total|subtotal|ยอดรวม|รวมสุทธิ|สุทธิ|รวม)/i,
  ];

  for (const re of priority) {
    for (const line of lines) {
      if (!re.test(line)) continue;
      const n = lastMoneyOnLine(line);
      if (n != null && n > 0) return round2(n);
    }
  }

  return null;
}

function normalizeStructuredItems(itemsUnknown: unknown): OCRNormalizedItem[] {
  if (!Array.isArray(itemsUnknown)) return [];

  const out = itemsUnknown
    .map((it: unknown) => {
      const obj = isRecord(it) ? it : {};

      const name = cleanSpaces(String(obj.name ?? "").trim());
      const qty = Math.max(1, Math.floor(toNumber(obj.qty, 1)));

      const unitPrice = toNumber(
        obj.unit_price ?? obj.price ?? obj.unitPrice,
        Number.NaN,
      );
      const lineTotal = toNumber(
        obj.line_total ?? obj.lineTotal ?? obj.total,
        Number.NaN,
      );

      const safeUnitPrice =
        Number.isFinite(unitPrice) && unitPrice >= 0
          ? round2(unitPrice)
          : Number.isFinite(lineTotal) && lineTotal >= 0 && qty > 0
            ? round2(lineTotal / qty)
            : Number.NaN;

      const safeLineTotal =
        Number.isFinite(lineTotal) && lineTotal >= 0
          ? round2(lineTotal)
          : Number.isFinite(safeUnitPrice)
            ? round2(safeUnitPrice * qty)
            : Number.NaN;

      if (
        !name ||
        isBadItemName(name) ||
        !Number.isFinite(safeUnitPrice) ||
        safeUnitPrice < 0 ||
        !Number.isFinite(safeLineTotal) ||
        safeLineTotal < 0
      ) {
        return null;
      }

      return {
        name,
        qty,
        unit_price: safeUnitPrice,
        line_total: safeLineTotal,
      };
    })
    .filter((it): it is OCRNormalizedItem => it !== null);

  return out;
}

function normalizeSimpleItems(
  items: Array<{ name: string; qty: number; price: number }>,
): OCRNormalizedItem[] {
  return items
    .map((it) => {
      const name = cleanSpaces(it.name);
      const qty = Math.max(1, Math.floor(it.qty));
      const unitPrice = round2(toNumber(it.price, Number.NaN));
      if (
        !name ||
        isBadItemName(name) ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        return null;
      }

      return {
        name,
        qty,
        unit_price: unitPrice,
        line_total: round2(unitPrice * qty),
      };
    })
    .filter((it): it is OCRNormalizedItem => it !== null);
}

function sumLineTotals(items: OCRNormalizedItem[]) {
  return round2(items.reduce((sum, item) => sum + item.line_total, 0));
}

/** ---------- Typhoon message types ---------- */
type TyphoonTextPart = { type: "text"; text: string };
type TyphoonImagePart = { type: "image_url"; image_url: { url: string } };
type TyphoonUserContent = Array<TyphoonTextPart | TyphoonImagePart>;
type TyphoonMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: TyphoonUserContent };

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
  const payload = { model, messages, temperature: 0, max_tokens: 1800 };

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json: TyphoonResponse | null = await r.json().catch(() => null);

  if (!r.ok) {
    return {
      ok: false as const,
      status: r.status,
      error:
        json?.error?.message ||
        json?.message ||
        `OpenTyphoon error (${r.status})`,
      detail: json,
      content: "",
    };
  }

  const content = json?.choices?.[0]?.message?.content ?? "";
  return { ok: true as const, status: 200, error: null, detail: json, content };
}

async function parseItemsFromRawTextWithLLM({
  baseUrl,
  apiKey,
  model,
  raw_text,
}: {
  baseUrl: string;
  apiKey: string;
  model: string;
  raw_text: string;
}): Promise<{
  items: OCRNormalizedItem[];
  total: number | null;
}> {
  const system = `
Return ONLY valid JSON (no markdown).
Schema:
{
  "items": [
    {
      "name": string,
      "qty": number,
      "unit_price": number,
      "line_total": number
    }
  ],
  "total": number|null
}
Rules:
- Input is raw_text from OCR of a Thai receipt.
- Extract only real purchased item rows.
- Exclude headers, VAT, tax, service charge, subtotal, total, payment, cashier, date, time, receipt metadata.
- qty must be integer >= 1.
- unit_price must be price per item.
- If only line total is visible, infer unit_price = line_total / qty.
- line_total should be qty * unit_price when possible.
- Return JSON numbers only, no commas.
`.trim();

  const user = `
RAW_TEXT:
${raw_text}
`.trim();

  const r = await callTyphoonChat({
    baseUrl,
    apiKey,
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: [{ type: "text", text: user }] },
    ],
  });

  if (!r.ok) return { items: [], total: null };

  const obj = extractJsonObject(r.content);
  if (!isRecord(obj)) return { items: [], total: null };

  const items = normalizeStructuredItems(obj.items);
  const total = positiveNumberOrNull(obj.total);

  return { items, total };
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json(
        { ok: false, error: "Missing file" },
        { status: 400 },
      );
    }

    const apiKey =
      process.env.OPENTYPHOON_API_KEY ||
      process.env.TYPHOON_API_KEY ||
      process.env.TYPHOON_OCR_API_KEY;

    if (!apiKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing API key (set OPENTYPHOON_API_KEY in .env.local)",
        },
        { status: 500 },
      );
    }

    const baseUrl =
      process.env.OPENTYPHOON_BASE_URL ||
      process.env.TYPHOON_BASE_URL ||
      "https://api.opentyphoon.ai/v1";

    const model = process.env.TYPHOON_OCR_MODEL || "typhoon-ocr";

    const mime = file.type || "image/jpeg";
    const buf = Buffer.from(await file.arrayBuffer());
    const b64 = buf.toString("base64");
    const dataUrl = `data:${mime};base64,${b64}`;

    const systemParse = `
You are an OCR receipt parser.

Return ONLY valid JSON (no markdown, no code fences, no HTML).
Schema:
{
  "title": string|null,
  "items": [
    {
      "name": string,
      "qty": number,
      "unit_price": number,
      "line_total": number
    }
  ],
  "total": number|null,
  "raw_text": string|null
}

Rules:
- title must be the SHORT merchant/store name only.
- Do NOT put slogans, branch text, tax id, receipt no, address, date, time, box number, queue number, or other metadata in title.
- raw_text MUST be plain text only with line breaks.
- items must contain only real purchased item rows.
- qty must be integer >= 1.
- unit_price must be price per item.
- If only line_total is visible, infer unit_price when possible.
- line_total should be the row total.
- Exclude TAX, VAT, service, subtotal, total, payment, cashier, date/time, receipt metadata from items.
- If an add-on/modifier clearly belongs to the previous item and has no standalone price, append it to the previous item name in parentheses.
- Return JSON only.
`.trim();

    const userParse = `
อ่านข้อความทั้งหมดจากภาพนี้ออกมาให้ครบ (ใส่ใน raw_text)
และแยกข้อมูลเป็น:
- title = ชื่อร้านสั้น ๆ เท่านั้น
- items = รายการสินค้า / qty / unit_price / line_total
- total = ยอดรวมสุทธิ

ส่งออกเป็น JSON ตาม schema เท่านั้น
`.trim();

    const parseResp = await callTyphoonChat({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: "system", content: systemParse },
        {
          role: "user",
          content: [
            { type: "text", text: userParse },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });

    if (!parseResp.ok) {
      return NextResponse.json(
        { ok: false, error: parseResp.error, detail: parseResp.detail },
        { status: parseResp.status },
      );
    }

    const parsedUnknown = extractJsonObject(parseResp.content);
    const parsed = isRecord(parsedUnknown) ? parsedUnknown : {};

    let raw_text =
      typeof parsed.raw_text === "string" && parsed.raw_text.trim()
        ? htmlToText(parsed.raw_text.trim())
        : "";

    raw_text = normalizeRawTextForParsing(raw_text);

    // fallback: OCR plain text only
    if (!raw_text) {
      const ocrOnly = await callTyphoonChat({
        baseUrl,
        apiKey,
        model,
        messages: [
          {
            role: "system",
            content:
              "Return ONLY plain text. Include ALL visible text from the image in reading order. Preserve line breaks.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "ดึงข้อความทั้งหมดจากภาพนี้ออกมาให้ครบทุกบรรทัด",
              },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      });

      if (ocrOnly.ok) {
        raw_text = htmlToText((ocrOnly.content || "").trim());
        raw_text = normalizeRawTextForParsing(raw_text);
      }
    }

    const modelTotal = positiveNumberOrNull(parsed.total);
    const textTotal = raw_text ? findTotalFromText(raw_text) : null;
    const expectedTotal = modelTotal ?? textTotal;

    const modelItems = normalizeStructuredItems(parsed.items);
    const regexItems = normalizeSimpleItems(
      raw_text ? parseItemsFromText(raw_text) : [],
    );

    let llmItems: OCRNormalizedItem[] = [];
    let llmTextTotal: number | null = null;

    if (raw_text) {
      const llm = await parseItemsFromRawTextWithLLM({
        baseUrl,
        apiKey,
        model,
        raw_text,
      });
      llmItems = llm.items;
      llmTextTotal = llm.total;
    }

    const modelSum = modelItems.length > 0 ? sumLineTotals(modelItems) : null;
    const modelLooksReasonable =
      modelItems.length > 0 &&
      !modelItems.some((item) => isBadItemName(item.name)) &&
      (expectedTotal == null ||
        modelSum == null ||
        Math.abs(modelSum - expectedTotal) <= Math.max(5, expectedTotal * 0.2));

    let items: OCRNormalizedItem[] = [];

    if (modelLooksReasonable) {
      items = modelItems;
    } else if (llmItems.length > 0) {
      items = llmItems;
    } else {
      items = regexItems;
    }
    const computedTotal = items.length > 0 ? sumLineTotals(items) : null;
    const totalSource =
      modelTotal ?? textTotal ?? llmTextTotal ?? computedTotal;
    const total =
      totalSource != null && Number.isFinite(totalSource) && totalSource > 0
        ? round2(totalSource)
        : null;

    const title = sanitizeTitle(parsed.title, raw_text);

    const response: OCRParsedPayload = {
      title,
      items,
      total,
      raw_text: raw_text || null,
    };

    return NextResponse.json({
      ok: true,
      parsed: response,
    });
  } catch (e: unknown) {
    const msg =
      typeof e === "object" &&
      e !== null &&
      "message" in e &&
      typeof (e as { message: unknown }).message === "string"
        ? (e as { message: string }).message
        : "Server error";

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
