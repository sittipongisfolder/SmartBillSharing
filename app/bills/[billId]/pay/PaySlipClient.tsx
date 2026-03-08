'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { ArrowLeftIcon } from '@heroicons/react/24/solid';

// ... (Types เดิมทั้งหมดคงเดิม) ...
type PaymentStatus = 'unpaid' | 'pending' | 'paid';

type Owner = {
  name?: string;
  bank?: string;
  promptPayPhone?: string;
  bankAccountNumber?: string;
};

type Participant = {
  userId?: string | { _id: string };
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
    userId: string;
    paymentStatus: 'unpaid' | 'paid';
    slipInfo?: SlipInfo;
    paidAt?: string | null;
  };
};
type ApiErr = { ok: false; message: string };
type ApiRes = ApiOk | ApiErr;

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function digitsOnly(s?: string) {
  return (s ?? '').replace(/\D/g, '');
}

function getId(v: Participant['userId']) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v._id;
}

function formatMoneyTHB(n: number) {
  if (!Number.isFinite(n)) return '-';
  return `฿${n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ---- dynamic import helpers ---- */
type GeneratePayloadFn = (target: string, opts?: { amount?: number }) => string;
type ToDataURLFn = (text: string, options?: Record<string, unknown>) => Promise<string>;

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

export default function PaySlipClient({ billId }: { billId: string }) {
  const HISTORY_PATH = '/history';
  const router = useRouter();
  const { data: session } = useSession();
  const myId = (session?.user as { id?: string } | undefined)?.id;

  // ---------- slip upload ----------
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<ApiRes | null>(null);


  // ---------- redirect countdown ----------
  const [redirectIn, setRedirectIn] = useState<number | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);

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

  // State สำหรับเก็บ Tip
  const [tip, setTip] = useState<number>(0);

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
        const res = await fetch(`/api/bills/${billId}`, { credentials: 'include' });
        const json = (await res.json()) as BillGetRes;
        if (!alive) return;

        if (!res.ok || !('bill' in json)) {
          setOwner(null);
          setBillTitle('');
          setMyShare(0);
          return;
        }

        const b = json.bill;
        setBillTitle(b.title ?? '');
        const createdByObj =
          typeof b.createdBy === 'object' && b.createdBy !== null ? (b.createdBy as Owner) : null;
        setOwner(createdByObj);

        if (myId) {
          const me = b.participants.find((p) => getId(p.userId) === myId);
          setMyShare(Number(me?.amount) || 0);
        } else {
          setMyShare(0);
        }
      } catch {
        if (!alive) return;
        setOwner(null);
        setBillTitle('');
        setMyShare(0);
      }
    })();
    return () => { alive = false; };
  }, [billId, myId]);

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

      // คำนวณยอดรวม (ค่าอาหาร + ทิป)
      const totalAmount = Number(myShare) + Number(tip);
      const withAmount = Number.isFinite(totalAmount) && totalAmount > 0;

      try {
        const [ppMod, qrMod] = await Promise.all([import('promptpay-qr'), import('qrcode')]);
        const gen = pickGeneratePayload(ppMod);
        const toDataURL = pickToDataURL(qrMod);

        // ส่งยอดรวมไปสร้าง QR
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

    return () => { alive = false; };
  }, [owner?.promptPayPhone, myShare, tip]);

  const canSubmit = useMemo(() => Boolean(file) && !loading, [file, loading]);

  function handleSaveQr() {
    if (!qrDataUrl) return;

    const link = document.createElement('a');
    link.href = qrDataUrl;
    link.download = `promptpay-qr-${billId}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  async function onSubmit() {
    if (!file) return;
    clearTimers();
    setLoading(true);
    setResult(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('autoPaid', 'true');



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
            message: 'โอนเงินสำเร็จแล้ว ✅ กำลังพากลับไปหน้า History...',
          });
          setRedirectIn(5);
          intervalRef.current = window.setInterval(() => {
            setRedirectIn((prev) => (prev === null ? null : prev - 1));
          }, 1000);
          timeoutRef.current = window.setTimeout(() => {
            router.push(HISTORY_PATH);
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white border-b">
       <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="w-full min-w-0">
            <div className="text-xs text-gray-500">Dashboard / Bills / Verify Slip</div>
            <div className="text-xl font-bold text-[#4a4a4a] mt-1">Verify Payment Slip</div>
            <div className="text-xs text-gray-500 mt-1">
              Transaction ID:{' '}
              <span className="font-semibold text-gray-600 break-all">{billId}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Bill: <span className="font-semibold text-gray-700">{billTitle || '-'}</span>
            </div>
          </div>

          <div className="w-full md:w-auto flex justify-start md:justify-end">
            <button
              type="button"
              onClick={() => window.history.back()}
className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-[#fb8c00] bg-orange-50 px-4 py-2 text-sm font-semibold text-[#e65100] shadow-sm transition hover:bg-[#fff7ed] hover:shadow-md active:scale-[0.98]"            >
              Back to History
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
        {/* Pay to PromptPay + QR */}
        <div className="bg-white rounded-2xl shadow-sm border p-5">
          <div className="text-lg font-bold text-gray-800 mb-4">Pay to (PromptPay)</div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* left info */}
            <div className="rounded-2xl border bg-gray-50 p-5">
              <div className="text-xs text-gray-500">Receiver</div>
              <div className="text-lg font-extrabold text-gray-900 mt-1">{owner?.name ?? '-'}</div>

              <div className="mt-4 text-xs text-gray-500">Bank</div>
              <div className="font-bold text-gray-900 mt-1">
                {owner?.bank ?? '-'}
                <br />
                {owner?.bankAccountNumber ?? '-'}
              </div>

              <div className="mt-4 text-xs text-gray-500">PromptPay (Phone)</div>
              <div className="font-extrabold text-gray-900 mt-1">{owner?.promptPayPhone ?? '-'}</div>

              <hr className="my-4 border-gray-200" />

              {/* ส่วนแสดงยอดเงินและช่องกรอก Tip */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">ค่าใช้จ่าย (Your Share)</span>
                  <span className="font-bold text-gray-900">{formatMoneyTHB(myShare)}</span>
                </div>

                <div className="flex justify-between items-center">
                  <label htmlFor="tip-input" className="text-sm text-gray-900 flex items-center gap-1">
                    ทิป (Tip) ❤️
                  </label>
                  <div className="relative text-gray-900">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-900 text-sm">฿</span>
                    <input
                      id="tip-input"
                      type="number"
                      min="0"
                      value={tip === 0 ? '' : tip}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setTip(isNaN(val) ? 0 : val);
                      }}
                      placeholder="0"
                      className="w-24 text-right rounded-lg border border-gray-900 py-1 pl-6 pr-2 text-sm focus:border-[#fb8c00] focus:ring-1 focus:ring-[#fb8c00] outline-none"
                    />
                  </div>
                </div>

                <div className="pt-2 border-t border-dashed border-gray-900 flex justify-between items-end">
                  <span className="text-sm font-semibold text-gray-700">ยอดโอนรวม (Total)</span>
                  <span className="text-3xl font-extrabold text-[#e65100]">
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
                  <img src={qrDataUrl} alt="PromptPay QR" className="w-[320px] h-[320px] object-contain" />

                  <p className="mt-2 text-sm text-gray-500 font-medium">
                    ยอดสแกน: <span className="text-[#fb8c00]">{formatMoneyTHB(myShare + tip)}</span>
                  </p>

                  <div className="mt-4 flex gap-3">
                    <button
                      type="button"
                      onClick={handleSaveQr}
                      className="px-4 py-2 rounded-xl bg-[#fb8c00] hover:bg-[#e65100] text-white text-sm font-semibold transition"
                    >
                      บันทึกรูป QR
                    </button>

                    

                    {/* หากต้องการเปิดรูป QR ในแท็บใหม่ (ไม่แนะนำเพราะบางเบราว์เซอร์อาจบล็อก) */}
                    {/* <a
                      href={qrDataUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-4 py-2 rounded-xl border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 transition"
                    >
                      เปิดรูป
                    </a> */}
                  </div>
                  <p className='text-red-500 mt-2 p-1'>* กรุณานำสลิปที่จ่ายแล้วมาแนบเพื่อตรวจสอบ</p>
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
          <div className="flex items-center justify-between px-5 py-4 border-b">
            <div className="font-semibold text-gray-800">ORIGINAL RECEIPT</div>

            <label className="inline-flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50">เลือกไฟล์</span>
            </label>
          </div>

          <div className="p-5">
            <div className="rounded-2xl border bg-gray-50 overflow-hidden">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="slip preview" className="w-full h-[520px] object-contain" />
              ) : (
                <div className="h-[520px] flex items-center justify-center text-gray-400 text-sm">
                  ยังไม่ได้เลือกรูปสลิป
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-3">
              <h1 className="text-sm text-black">* สลีปจากธนาคารกรุงเทพ<span className="font-bold text-red-500">กรุณารอ 7 นาที</span>
                และสลีปจากธนาคารไทยพาณิชย์<span className="font-bold text-red-500">กรุณารอ 2 นาทีก่อนแนบสลิปตรวจสอบ</span> </h1>
              <button
                type="button"
                onClick={onSubmit}
                disabled={!canSubmit || redirectIn !== null}
                className={cx(
                  'px-5 py-3 rounded-xl font-semibold text-white transition',
                  canSubmit && redirectIn === null ? 'bg-[#fb8c00] hover:bg-[#e65100]' : 'bg-gray-300 cursor-not-allowed'
                )}
              >
                {loading ? 'Verifying...' : redirectIn !== null ? `Redirecting (${redirectIn})` : 'Verify Slip'}
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

      {/* Floating back button */}
      <button
        onClick={() => window.history.back()}
        className="fixed top-5 left-5 flex items-center gap-2 px-2 py-2 bg-[#fb8c00] text-white rounded-xl shadow-md hover:shadow-xl hover:scale-105 transition-all duration-300"
        type="button"
      >
        <ArrowLeftIcon className="h-5 w-5" />
        <span className="font-medium">Go Back</span>
      </button>
    </div>
  );
}