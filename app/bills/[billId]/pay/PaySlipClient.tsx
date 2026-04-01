'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';


type PaymentStatus = 'unpaid' | 'pending' | 'paid';

type Owner = {
  name?: string;
  bank?: string;
  promptPayPhone?: string;
  bankAccountNumber?: string;
};

type Participant = {
  kind?: 'user' | 'guest_placeholder' | 'guest';
  userId?: string | { _id: string };
  guestId?: string | { _id: string };
  name?: string;
  amount?: number;
  paymentStatus?: 'unpaid' | 'paid';
};

type BillDoc = {
  _id: string;
  title: string;
  createdBy: Owner | string;
  participants: Participant[];
};

type BillGetOk = { bill: BillDoc };
type BillGetErr = { error: string };
type BillGetRes = BillGetOk | BillGetErr;

type SlipInfo = {
  imageUrl: string;
  provider: string;
  reference: string;
  checkedAt: string;
  verified: boolean;
};

type ApiOk = {
  ok: true;
  message: string;
  billId: string;
  billStatus: PaymentStatus;
  updatedParticipant: {
    userId?: string;
    guestId?: string;
    paymentStatus: 'unpaid' | 'paid';
    slipInfo?: SlipInfo;
    paidAt?: string | null;
  };
};

type ApiErr = { ok: false; message: string };
type ApiRes = ApiOk | ApiErr;

type GuestAccessBillOk = {
  ok: true;
  bill: BillDoc;
  guest: {
    guestId: string;
    name: string;
    amount: number;
    paymentStatus: 'unpaid' | 'paid';
  };
};

type GuestAccessBillErr = {
  ok: false;
  error: string;
};

type GuestAccessBillRes = GuestAccessBillOk | GuestAccessBillErr;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function digitsOnly(s?: string) {
  return (s ?? '').replace(/\D/g, '');
}

function getUserId(v: Participant['userId']) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v._id;
}



function formatMoneyTHB(n: number) {
  if (!Number.isFinite(n)) return '-';
  return `฿${n.toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** ---- dynamic import helpers ---- */
type GeneratePayloadFn = (target: string, opts?: { amount?: number }) => string;
type ToDataURLFn = (
  text: string,
  options?: Record<string, unknown>
) => Promise<string>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function pickGeneratePayload(mod: unknown): GeneratePayloadFn {
  if (typeof mod === 'function') return mod as GeneratePayloadFn;
  if (!isRecord(mod)) throw new Error('promptpay-qr: invalid module shape');
  const d = mod['default'];
  if (typeof d === 'function') return d as GeneratePayloadFn;
  const gp = mod['generatePayload'];
  if (typeof gp === 'function') return gp as GeneratePayloadFn;
  throw new Error('promptpay-qr: generatePayload not found');
}

function pickToDataURL(mod: unknown): ToDataURLFn {
  if (isRecord(mod) && typeof mod['toDataURL'] === 'function') {
    return mod['toDataURL'] as ToDataURLFn;
  }
  if (isRecord(mod)) {
    const d = mod['default'];
    if (isRecord(d) && typeof d['toDataURL'] === 'function') {
      return d['toDataURL'] as ToDataURLFn;
    }
  }
  throw new Error('qrcode: toDataURL not found');
}

export default function PaySlipClient({ billId, forcedGuestAccessToken }: { billId: string; forcedGuestAccessToken?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();

  const myUserId = (session?.user as { id?: string } | undefined)?.id;
  const guestAccessToken =
    forcedGuestAccessToken?.trim() ||
    String(searchParams.get('guestAccessToken') ?? '').trim();
  const inviteToken = String(searchParams.get('inviteToken') ?? '').trim();
  const isGuestMode = guestAccessToken.length > 0;

  const HISTORY_PATH = '/history';
  const guestBackPath = isGuestMode
    ? `/guest/access/${encodeURIComponent(guestAccessToken)}`
    : HISTORY_PATH;

  // ---------- slip upload ----------
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ApiRes | null>(null);

  // ---------- redirect countdown ----------
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function clearTimers() {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    timeoutRef.current = null;
    intervalRef.current = null;
    setRedirectIn(null);
  }

  useEffect(() => {
    return () => clearTimers();
  }, []);

  // ---------- bill/owner/pay ----------
  const [billTitle, setBillTitle] = useState<string>('');
  const [owner, setOwner] = useState<Owner | null>(null);
  const [myShare, setMyShare] = useState<number>(0);
  const [viewerName, setViewerName] = useState<string>('');

  // State สำหรับเก็บ Tip
  const [tip, setTip] = useState<number>(0);
  const [currentPaymentStatus, setCurrentPaymentStatus] = useState<PaymentStatus>('unpaid');

  // ---------- QR ----------
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  // preview image
  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // fetch bill
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (isGuestMode) {
          const res = await fetch(`/api/guest/access/${encodeURIComponent(guestAccessToken)}/bill`, {
            credentials: 'include',
            cache: 'no-store',
          });

          const json = (await res.json()) as GuestAccessBillRes;

          if (!alive) return;

          if (!res.ok || !json.ok) {
            setOwner(null);
            setBillTitle('');
            setMyShare(0);
            setViewerName('');
            setCurrentPaymentStatus('unpaid');
            return;
          }

          const b = json.bill;
          setBillTitle(b.title ?? '');
          const createdByObj =
            typeof b.createdBy === 'object' && b.createdBy !== null
              ? (b.createdBy as Owner)
              : null;

          setOwner(createdByObj);
          setMyShare(Number(json.guest.amount) || 0);
          setViewerName(json.guest.name ?? 'Guest');
          setCurrentPaymentStatus(json.guest.paymentStatus ?? 'unpaid');
          return;
        }

        const res = await fetch(`/api/bills/${billId}`, {
          credentials: 'include',
          cache: 'no-store',
        });

        const json = (await res.json()) as BillGetRes;
        if (!alive) return;

        if (!res.ok || !('bill' in json)) {
          setOwner(null);
          setBillTitle('');
          setMyShare(0);
          setViewerName('');
          setCurrentPaymentStatus('unpaid');
          return;
        }

        const b = json.bill;
        setBillTitle(b.title ?? '');

        const createdByObj =
          typeof b.createdBy === 'object' && b.createdBy !== null
            ? (b.createdBy as Owner)
            : null;

        setOwner(createdByObj);

        if (myUserId) {
          const me = b.participants.find((p) => getUserId(p.userId) === myUserId);
          setMyShare(Number(me?.amount) || 0);
          setViewerName(me?.name ?? session?.user?.name ?? '');
          setCurrentPaymentStatus(me?.paymentStatus ?? 'unpaid');
        } else {
          setMyShare(0);
          setViewerName('');
          setCurrentPaymentStatus('unpaid');
        }
      } catch {
        if (!alive) return;
        setOwner(null);
        setBillTitle('');
        setMyShare(0);
        setViewerName('');
        setCurrentPaymentStatus('unpaid');
      }
    })();

    return () => {
      alive = false;
    };
  }, [billId, guestAccessToken, isGuestMode, myUserId, session?.user?.name]);

  // QR Logic
  useEffect(() => {
    let alive = true;

    (async () => {
      setQrError(null);

      const phoneRaw = owner?.promptPayPhone;
      const phone = digitsOnly(phoneRaw);

      if (!phone || phone.length !== 10) {
        if (alive) setQrDataUrl(null);
        if (alive && phoneRaw) setQrError('เบอร์ PromptPay ต้องเป็นตัวเลข 10 หลัก');
        return;
      }

      const totalAmount = Number(myShare) + Number(tip);
      const withAmount = Number.isFinite(totalAmount) && totalAmount > 0;

      try {
        const [ppMod, qrMod] = await Promise.all([
          import('promptpay-qr'),
          import('qrcode'),
        ]);

        const gen = pickGeneratePayload(ppMod);
        const toDataURL = pickToDataURL(qrMod);

        const payload = gen(phone, withAmount ? { amount: totalAmount } : undefined);
        const url = await toDataURL(payload, { width: 320, margin: 1 });

        if (!alive) return;
        setQrDataUrl(url);
      } catch (e: unknown) {
        if (!alive) return;
        setQrDataUrl(null);
        const msg = e instanceof Error ? e.message : 'QR generate failed';
        setQrError(msg);
      }
    })();

    return () => {
      alive = false;
    };
  }, [owner?.promptPayPhone, myShare, tip]);

  const isAlreadyPaid = currentPaymentStatus === 'paid';
  const canSubmit = useMemo(() => Boolean(file) && !loading && !isAlreadyPaid, [file, loading, isAlreadyPaid]);

  async function handleSaveQr() {
    if (!qrDataUrl) return;

    const fileName = `promptpay-qr-${billId}.png`;

    // Convert data URL to Blob
    const res = await fetch(qrDataUrl);
    const blob = await res.blob();
    const file = new File([blob], fileName, { type: 'image/png' });

    // Use native Share Sheet (like Grab / Line) — works on iOS & Android
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'PromptPay QR Code',
        });
        return;
      } catch {
        // User cancelled share — fall through to download
      }
    }

    // Fallback: direct download for desktop browsers
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function onSubmit() {
    if (!file) return;
    if (isAlreadyPaid) {
      setResult({ ok: false, message: 'Guest นี้ได้ทำการจ่ายแล้ว' });
      return;
    }

    clearTimers();
    setLoading(true);
    setResult(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('autoPaid', 'true');

      if (isGuestMode) {
        form.append('guestAccessToken', guestAccessToken);
      }

      const res = await fetch(`/api/bills/${billId}/slip-check`, {
        method: 'POST',
        body: form,
        credentials: 'include',
      });

      const json = (await res.json()) as unknown;
      if (typeof json === 'object' && json !== null && 'ok' in json) {
        const parsed = json as ApiRes;
        setResult(parsed);

        if (parsed.ok && parsed.updatedParticipant.paymentStatus === 'paid') {
          setResult({
            ...parsed,
            message: isGuestMode
              ? 'โอนเงินสำเร็จแล้ว ✅ กำลังพากลับไปหน้าติดตามบิล...'
              : 'โอนเงินสำเร็จแล้ว ✅ กำลังพากลับไปหน้า History...',
          });

          setRedirectIn(5);

          intervalRef.current = window.setInterval(() => {
            setRedirectIn((prev) => (prev === null ? null : prev - 1));
          }, 1000);

          timeoutRef.current = window.setTimeout(() => {
            router.push(isGuestMode ? guestBackPath : HISTORY_PATH);
          }, 5000);
        }
      } else {
        setResult({ ok: false, message: 'Invalid response from server' });
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Network error';
      setResult({ ok: false, message: msg });
    } finally {
      setLoading(false);
    }
  }

  const [copied, setCopied] = useState(false);
  const [guestSavedLink, setGuestSavedLink] = useState('');

  useEffect(() => {
    if (!isGuestMode || typeof window === 'undefined') {
      setGuestSavedLink('');
      return;
    }

    if (inviteToken) {
      setGuestSavedLink(`${window.location.origin}/i/${encodeURIComponent(inviteToken)}`);
      return;
    }

    setGuestSavedLink(`${window.location.origin}/guest/access/${encodeURIComponent(guestAccessToken)}/pay`);
  }, [guestAccessToken, inviteToken, isGuestMode]);

  async function handleCopyGuestLink() {
    if (!guestSavedLink) return;

    try {
      await navigator.clipboard.writeText(guestSavedLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 py-2 sm:py-3">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-500 leading-none">
              {isGuestMode ? 'การชำระเงินของผู้เข้าร่วม / ยืนยันสลิป' : 'แดชบอร์ด / บิล / ยืนยันสลิป'}
            </div>
            <div className="text-lg sm:text-xl font-bold text-[#4a4a4a] mt-1">การยืนยันสลิปการชำระเงิน</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <span className="text-sm text-gray-500">
                รหัส: <span className="font-semibold text-gray-700 break-all">{billId}</span>
              </span>
              <span className="text-sm text-gray-500">
                บิล: <span className="font-semibold text-gray-700">{billTitle || '-'}</span>
              </span>
              {viewerName ? (
                <span className="text-sm text-gray-500">
                  ผู้จ่าย: <span className="font-semibold text-gray-700">{viewerName}</span>
                </span>
              ) : null}
            </div>
            </div>

            {isGuestMode ? (
              <div className="shrink-0 w-[11  0px] sm:w-[200px] rounded-xl border border-gray-200 bg-gray-50 p-2.5 sm:p-3">
                <div className="text-[10px] sm:text-xs text-gray-600 leading-4">
                  คัดลอกลิงก์หน้านี้ไว้จ่าย
                </div>
                <div className="mt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleCopyGuestLink}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-[#fb8c00] px-3 text-[11px] sm:text-xs font-semibold text-white transition hover:bg-[#e65100] active:scale-[0.98]"
                  >
                    {copied ? 'คัดลอกแล้ว ✓' : 'คัดลอกลิงก์'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="shrink-0">
                <button
                  type="button"
                  onClick={() => router.push(HISTORY_PATH)}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#fb8c00] bg-orange-50 px-4 py-2 text-sm font-semibold text-[#e65100] shadow-sm transition hover:bg-[#fff7ed] hover:shadow-md active:scale-[0.98]"
                >
                  กลับ
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Pay to PromptPay + QR */}
        <div className="bg-white rounded-2xl shadow-sm border p-5">
          {isGuestMode && isAlreadyPaid ? (
            <div className="mb-4 rounded-2xl border bg-green-50 text-green-800 px-4 py-3 text-sm font-medium">
              Guest นี้ได้ทำการจ่ายแล้ว
            </div>
          ) : null}

          <div className="text-lg font-bold text-gray-800 mb-4">ชำระไปยัง (PromptPay)</div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* left info */}
            <div className="rounded-2xl border bg-gray-50 p-5">
              <div className="text-xs text-gray-500">ผู้รับเงิน</div>
              <div className="text-lg font-extrabold text-gray-900 mt-1">{owner?.name ?? '-'}</div>

              <div className="mt-4 text-xs text-gray-500">ธนาคาร</div>
              <div className="font-bold text-gray-900 mt-1">
                {owner?.bank ?? '-'}
                <br />
                {owner?.bankAccountNumber ?? '-'}
              </div>

              <div className="mt-4 text-xs text-gray-500">พร้อมเพย์ (เบอร์โทร)</div>
              <div className="font-extrabold text-gray-900 mt-1">{owner?.promptPayPhone ?? '-'}</div>

              <hr className="my-4 border-gray-200" />

              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">ยอดที่ต้องจ่ายของคุณ</span>
                  <span className="font-bold text-gray-900">{formatMoneyTHB(myShare)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <label htmlFor="tip-input" className="text-sm text-gray-900 flex items-center gap-1">
                    ทิป ❤️
                  </label>
                  <div className="relative text-gray-900">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-900 text-sm">
                      ฿
                    </span>
                    <input
                      id="tip-input"
                      type="number"
                      min="0"
                      value={tip === 0 ? '' : tip}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setTip(Number.isNaN(val) ? 0 : val);
                      }}
                      placeholder="0"
                      className="w-24 text-right rounded-lg border border-gray-900 py-1 pl-6 pr-2 text-sm focus:border-[#fb8c00] focus:ring-1 focus:ring-[#fb8c00] outline-none"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-dashed border-gray-900 flex justify-between items-end">
                  <span className="text-sm font-semibold text-gray-700">ยอดโอนรวม (Total)</span>
                  <span className="text-2xl sm:text-3xl font-extrabold text-[#e65100]">
                    {formatMoneyTHB(myShare + tip)}
                  </span>
                </div>
              </div>

              <div className="mt-3 text-[11px] text-gray-400">
                * QR Code จะอัปเดตยอดเงินตามยอดรวมอัตโนมัติ
              </div>
            </div>

            {/* right QR */}
            <div className="rounded-2xl border bg-white p-5 flex items-center justify-center flex-col">
              {qrDataUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="คิวอาร์โค้ดพร้อมเพย์"
                    className="w-full max-w-[260px] sm:max-w-[320px] h-auto object-contain"
                  />

                  <p className="mt-2 text-sm text-gray-500 font-medium">
                    ยอดสแกน:{' '}
                    <span className="text-[#fb8c00]">{formatMoneyTHB(myShare + tip)}</span>
                  </p>

                  <button
                    type="button"
                    onClick={handleSaveQr}
                    className="mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#fb8c00] hover:bg-[#e65100] text-white text-sm font-semibold transition active:scale-95"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V3" />
                    </svg>
                    บันทึก QR
                  </button>

                  <p className="text-red-600 mt-3 text-xs sm:text-sm font-medium">
                    * บันทึก QR แล้วไปโอนเงินใน App ธนาคาร จากนั้นกลับมาแนบสลิปที่ด้านล่าง
                  </p>
                </>
              ) : (
                <div className="text-sm text-gray-400 text-center">
                  ไม่มีข้อมูล PromptPay ของหัวบิล
                  {qrError ? <div className="mt-2 text-xs text-red-500">{qrError}</div> : null}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ORIGINAL RECEIPT + verify */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="px-5 py-4 border-b">
            <div className="font-semibold text-gray-800">แนบสลิปการโอนเงิน</div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div className="p-4 sm:p-5">
            <div className="rounded-2xl border bg-gray-50 overflow-hidden">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt="ตัวอย่างสลิป"
                  className="w-full h-56 sm:h-[520px] object-contain"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isAlreadyPaid}
                  className={cx(
                    'w-full h-56 sm:h-[520px] flex flex-col items-center justify-center gap-3 text-sm transition',
                    isAlreadyPaid
                      ? 'text-gray-300 cursor-not-allowed bg-gray-100'
                      : 'text-gray-400 cursor-pointer hover:bg-gray-100 active:bg-gray-200'
                  )}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16l4-4 4 4 4-6 4 6" />
                    <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span>แตะที่นี่เพื่อเลือกรูปสลิป</span>
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
              <p className="text-xs sm:text-sm text-black text-center sm:text-left">
                * สลีปจากธนาคารกรุงเทพ
                <span className="font-bold text-red-500">กรุณารอ 7 นาที</span>
                {' '}และสลีปจากธนาคารไทยพาณิชย์
                <span className="font-bold text-red-500">กรุณารอ 2 นาทีก่อนแนบสลิปตรวจสอบ</span>
              </p>

              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit || redirectIn !== null}
                className={cx(
                  'w-full sm:w-auto px-5 py-3 rounded-xl font-semibold text-white transition active:scale-95',
                  canSubmit && redirectIn === null
                    ? 'bg-[#fb8c00] hover:bg-[#e65100]'
                    : 'bg-gray-300 cursor-not-allowed'
                )}
              >
                {loading
                  ? 'กำลังตรวจสอบ...'
                  : redirectIn !== null
                    ? `กำลังเปลี่ยนหน้า (${redirectIn})`
                    : 'ตรวจสอบสลิป'}
              </button>
            </div>

            {result && !result.ok ? (
              <div className="mt-4 rounded-2xl border bg-red-50 text-red-700 px-4 py-3 text-sm">
                {result.message}
              </div>
            ) : null}

            {result && result.ok ? (
              <div className="mt-4 rounded-2xl border bg-green-50 text-green-800 px-4 py-3 text-sm">
                {result.message}
              </div>
            ) : null}
          </div>
        </div>
      </div>


    </div>
  );
}