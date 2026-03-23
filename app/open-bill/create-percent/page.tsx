'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useSession } from 'next-auth/react';
import { OcrPreviewModal } from '@/components/OcrPreviewModal';
import { useOcrPreview } from '@/lib/useOcrPreview';
import { AddParticipantDropdown } from '@/components/AddParticipantDropdown';
import Image from 'next/image';

interface User {
  _id: string;
  name: string;
  email: string;
}

type SplitType = 'equal' | 'percentage' | 'personal';
type PercentMode = 'percent' | 'amount';
type PercentValue = number | '';
type AmountValue = number | '';
type ParticipantKind = 'user' | 'guest_placeholder' | 'guest';

interface Participant {
  localId: string;
  participantId?: string;
  kind: ParticipantKind;
  userId?: string;
  guestId?: string;
  name: string;
  percent?: PercentValue; // percentage
  amount: AmountValue; // personal/percentage
  pctMode?: PercentMode;
  joinedAt?: string;
}

type ItemRow = {
  items: string;
  qty: string;
  price: string; // unit price (string เพื่อคุมรูปแบบ)
};

type SummaryRow = {
  key: string;
  userId?: string;
  name: string;
  amount: number;
  percent: number;
  percentInput: number;
  amountInput: number;
  pctMode: PercentMode;
};

type DraftDbParticipant = {
  _id?: string;
  kind?: ParticipantKind;
  userId?: string;
  guestId?: string;
  name?: string;
  amount?: number;
  joinedAt?: string;
};

/** ✅ Type ผลลัพธ์จาก /api/ocr (ให้หน้าเว็บ "เติมฟอร์ม" อย่างเดียว ไม่ parse ซ้ำ) */
type TyphoonOcrResponse =
  | {
    ok: true;
    parsed: {
      title: string | null;
      items: Array<{
        name: string;
        qty: number;
        unit_price: number;
        line_total: number;
      }>;
      total: number | null;
      raw_text: string | null;
    };
  }
  | {
    ok: false;
    error?: string;
    detail?: unknown;
  };

/** ✅ เงื่อนไขเงิน: ไม่เกิน 6 หลัก + ทศนิยม 2 */
const MAX_MONEY = 999999.99;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clampMoney = (n: number) => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > MAX_MONEY) return MAX_MONEY;
  return n;
};
const money = (n: number) => clampMoney(round2(n));

/** จำกัด input เงิน: max 999999.99 และทศนิยม 2 */
const normalizeMoneyInput = (v: string) => {
  const t = (v ?? '').trim();
  if (t === '') return '';

  const cleaned = t.replace(/[^\d.]/g, '');
  const firstDot = cleaned.indexOf('.');
  const noExtraDots =
    firstDot === -1
      ? cleaned
      : cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');

  const [intRaw, decRaw = ''] = noExtraDots.split('.');
  const intPart = (intRaw || '').slice(0, 6);
  const decPart = (decRaw || '').slice(0, 2);

  if (!intPart && decPart) return `0.${decPart}`;
  if (!decPart) return intPart;
  return `${intPart}.${decPart}`;
};



const toNumber = (v: unknown, fallback = 0) => {
  const s = typeof v === 'number' ? String(v) : String(v ?? '');
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const toIntQty = (v: string) => {
  const n = parseInt(v || '1', 10);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
};

const toPercentValue = (v: string): PercentValue => {
  const t = v.trim();
  if (t === '') return '';
  const n = Number(t);
  if (!Number.isFinite(n)) return '';
  return Math.max(0, Math.min(100, round2(n)));
};

const toAmountValue = (v: string): AmountValue => {
  const t = v.trim();
  if (t === '') return '';
  const n = Number(t);
  if (!Number.isFinite(n)) return '';
  return money(n);
};

const makeLocalId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#fb8c00] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e65100] hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600';

const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

function isLocalGuestLike(p: Participant) {
  return p.kind === 'guest' || p.kind === 'guest_placeholder';
}

function isDraftGuestLike(row: DraftDbParticipant) {
  return row.kind === 'guest' || row.kind === 'guest_placeholder' || !!row.guestId;
}

function getGuestLikeIndexFromLocalRows(rows: Participant[], localId: string) {
  return rows.filter(isLocalGuestLike).findIndex((row) => row.localId === localId);
}

function findDraftRowForLocalParticipant(
  localRows: Participant[],
  localRow: Participant,
  dbRows: DraftDbParticipant[]
): DraftDbParticipant | undefined {
  if (localRow.participantId) {
    const byId = dbRows.find((row) => String(row._id ?? '') === localRow.participantId);
    if (byId) return byId;
  }

  if (localRow.kind === 'user') {
    return dbRows.find(
      (row) => row.kind === 'user' && !!localRow.userId && row.userId === localRow.userId
    );
  }

  const guestIndex = getGuestLikeIndexFromLocalRows(localRows, localRow.localId);
  if (guestIndex === -1) return undefined;

  const dbGuestRows = dbRows.filter(isDraftGuestLike);
  return dbGuestRows[guestIndex];
}

function isSelectableParticipant(p: Participant) {
  if (!p.name.trim()) return false;
  if (p.kind === 'user') return !!p.userId;
  return p.kind === 'guest_placeholder' || p.kind === 'guest';
}

function getMeByEmail(list: User[], email?: string | null): User | undefined {
  if (!email) return undefined;
  return list.find((u) => u.email === email);
}

async function compressImage(
  file: File,
  maxW = 1600,
  quality = 0.85
): Promise<File> {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxW / img.width);
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, w, h);

  const blob: Blob = await new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality);
  });

  return new File(
    [blob],
    file.name.replace(/\.\w+$/, '.jpg'),
    { type: 'image/jpeg' }
  );
}

function CreatePercentPageInner() {
  const searchParams = useSearchParams();
  const splitTypeRaw = searchParams.get('type');
  const splitType = (splitTypeRaw as SplitType) || 'percent';

  const [title, setTitle] = useState('');
  const [totalPrice, setTotalPrice] = useState<number | ''>('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([
    { localId: makeLocalId(), kind: 'user', userId: '', name: '', percent: '', amount: 0, pctMode: 'percent' },
  ]);
  const [sharePerPerson, setSharePerPerson] = useState(0);
  const [description, setDescription] = useState('');

  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? null;

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [itemList, setItemList] = useState<ItemRow[]>([{ items: '', qty: '1', price: '' }]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const directUploadInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');

  // ✅ OCR Preview Modal
  const ocrPreview = useOcrPreview();
  const [ocrImageFile, setOcrImageFile] = useState<File | null>(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState<string | null>(null);

  const [draftBillId, setDraftBillId] = useState('');
  const [inviteLinkByLocalId, setInviteLinkByLocalId] = useState<Record<string, string>>({});
  const [copiedInviteLocalId, setCopiedInviteLocalId] = useState<string | null>(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [creatingInvite, setCreatingInvite] = useState(false);

  const [isAddParticipantOpen, setIsAddParticipantOpen] = useState(false);

  const selectedUserIds = useMemo(() => {
    return new Set(
      participants
        .filter((p) => p.kind === 'user' && p.userId)
        .map((p) => p.userId as string)
    );
  }, [participants]);

  const addParticipantByUser = (u: User) => {
    setParticipants((prev) => {
      if (prev.some((p) => p.kind === 'user' && p.userId === u._id)) return prev;
      return [...prev, { localId: makeLocalId(), kind: 'user', userId: u._id, name: u.name, percent: '', amount: 0, pctMode: 'percent' }];
    });
    setIsAddParticipantOpen(false);
  };

  const handleAddGuestSlot = () => {
    const guestCount = participants.filter(
      (p) => p.kind === 'guest_placeholder' || p.kind === 'guest'
    ).length;

    setParticipants((prev) => [
      ...prev,
      {
        localId: makeLocalId(),
        kind: 'guest_placeholder',
        name: `Guest ${guestCount + 1}`,
        percent: '',
        amount: 0,
        pctMode: 'percent',
      },
    ]);
  };

  const selectedParticipants = useMemo(
    () => participants.filter(isSelectableParticipant),
    [participants]
  );
  const selectedCount = selectedParticipants.length;

  // โหลดรายชื่อผู้ใช้
  useEffect(() => {
    async function fetchUsers() {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/users', {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await res.json();
      setUsers(data);
    }
    fetchUsers();
  }, []);

  // ดัน “ตัวเอง” เป็นแถวแรก
  useEffect(() => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;

    setParticipants((prev) => {
      if (prev.length > 0 && prev[0].kind === 'user' && prev[0].userId === me._id) return prev;

      const headAmount = prev[0]?.amount ?? 0;
      const headPercent = prev[0]?.percent ?? '';
      const headPctMode: PercentMode = prev[0]?.pctMode ?? 'percent';

      const tail = prev.filter((p, index) => {
        if (index === 0) return false;
        return !(p.kind === 'user' && p.userId === me._id);
      });

      return [
        { localId: prev[0]?.localId ?? makeLocalId(), participantId: prev[0]?.participantId, kind: 'user', userId: me._id, name: me.name, percent: headPercent, amount: headAmount, pctMode: headPctMode },
        ...tail,
      ];
    });
  }, [users, currentUserEmail]);

  const handleUploadImageDirectly = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;

    setSelectedFileName(picked.name);
    setUploading(true);

    try {
      const compressed = await compressImage(picked);
      const imagePreviewUrl = URL.createObjectURL(compressed);
      setSelectedImagePreview(imagePreviewUrl);
      setOcrImageFile(compressed);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      console.error('Direct upload error:', err);
      alert(`อัปโหลดรูปบิลล้มเหลว: ${errorMsg}`);
    } finally {
      setUploading(false);
      if (directUploadInputRef.current) directUploadInputRef.current.value = '';
    }
  };

  /**
   * ✅ OCR: เรียก route แล้วเอา parsed มาเติม field
   */
  const handleReceiptChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;

    setSelectedFileName(picked.name);
    setUploading(true);

    try {
      const token = localStorage.getItem('token');

      const compressed = await compressImage(picked);
      const fd = new FormData();
      fd.append('file', compressed);

      // ✅ Set 90 second timeout for OCR API (includes processing time)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          body: fd,
          signal: controller.signal,
        });

        const data = (await res.json().catch(() => null)) as TyphoonOcrResponse | null;

        if (!data) {
          alert(`OCR ไม่สำเร็จ: HTTP ${res.status}`);
          return;
        }

        if (!res.ok || data.ok === false) {
          alert(
            `OCR ไม่สำเร็จ: ${data.ok === false ? data.error || 'Unknown error' : `HTTP ${res.status}`
            }`
          );
          return;
        }

        const parsed = data.parsed;
        const rawText =
          typeof parsed.raw_text === 'string' && parsed.raw_text.trim()
            ? parsed.raw_text.trim()
            : '';

        // ✅ Create image preview from file
        const reader = new FileReader();
        reader.onload = (evt) => {
          const imagePreviewUrl = evt.target?.result as string | null;
          setSelectedImagePreview(imagePreviewUrl);

          // ✅ Map OCR items
          const mappedItems = Array.isArray(parsed.items) ? parsed.items : [];

          // ✅ Open preview modal with all data
          ocrPreview.openPreview(
            {
              title: parsed.title,
              items: mappedItems,
              total: parsed.total,
              rawText,
              receiptImageUrl: null,
              receiptImagePublicId: null,
            },
            picked.name,
            imagePreviewUrl
          );

          // ✅ Store the file for later upload if user accepts
          setOcrImageFile(compressed);
        };
        reader.readAsDataURL(compressed);
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err: unknown) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      const errorMsg = isTimeout
        ? 'OCR ใช้เวลานานเกินไป โปรดลองใหม่อีกครั้ง'
        : 'OCR ล้มเหลว (network/server)';
      console.error('OCR error:', err);
      alert(errorMsg);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onAcceptOcr = async () => {
    ocrPreview.setLoading(true);

    try {
      const token = localStorage.getItem('token');
      let receiptImageUrl = '';
      let receiptImagePublicId = '';

      // ✅ Upload receipt image to Cloudinary if file exists
      if (ocrImageFile) {
        try {
          const fd = new FormData();
          fd.append('file', ocrImageFile);

          const uploadRes = await fetch('/api/ocr/upload-receipt', {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            body: fd,
          });

          if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            receiptImageUrl = uploadData.url || '';
            receiptImagePublicId = uploadData.publicId || '';
          }
        } catch (uploadErr) {
          console.error('Receipt upload failed:', uploadErr);
          // Continue even if upload fails
        }
      }

      const previewData = ocrPreview.previewData;
      const rawText = previewData.rawText || '';

      // ✅ Set title from preview
      const ocrTitle = previewData.title?.trim();
      if (ocrTitle) {
        setTitle((prev) => (prev.trim() ? prev : ocrTitle));
      }

      // ✅ Set description from raw_text
      if (rawText) {
        setDescription(rawText);
      }

      // ✅ Map items from preview
      const mappedFromParsed: ItemRow[] = previewData.items
        .map((it) => {
          const name = String(it?.name ?? '').trim();
          if (!name) return null;

          const qtyNum = Math.max(1, toIntQty(String(it.qty ?? 1)));
          const unit = money(toNumber(it.unit_price || 0));

          return {
            items: name,
            qty: String(qtyNum),
            price: unit.toFixed(2),
          };
        })
        .filter((x): x is ItemRow => x !== null);

      // ✅ Fallback parsing if items are empty
      let finalItems = mappedFromParsed;
      if (finalItems.length === 0 && rawText) {
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
        const fallbackItems: ItemRow[] = [];

        for (const line of lines) {
          const trimmed = line.trim();
          if (/^[-–]\s/.test(trimmed)) continue;

          const skipKeywords = [
            'total', 'subtotal', 'vat', 'tax', 'receipt', 'date', 'time', 'cashier', 'thank you',
            'ยอดรวม', 'รวมทั้งสิ้น', 'ใบเสร็จ', 'วันที่', 'เวลา', 'ภาษี', 'สุทธิ', 'ค่าบริการ',
            'service', 'charge', 'items', 'qty',
          ];

          if (skipKeywords.some((kw) => trimmed.toLowerCase().includes(kw))) continue;

          const match = trimmed.match(
            /^(?:\d+\.\s+)?(.+?)\s{2,}(\d+)\s+(\d{1,3}(?:,\d{3})*\.?\d{0,2})\s*(?:บาท|฿)?$/i
          );
          if (!match) continue;

          const [, nameRaw, qtyRaw, priceRaw] = match;
          const name = nameRaw.trim().replace(/^[0-9.\-*)\s]+/, '').trim();
          if (name.length < 2) continue;

          const qty = parseInt(qtyRaw, 10);
          const price = parseFloat(priceRaw.replace(/,/g, ''));
          if (qty <= 0 || price <= 0 || !Number.isFinite(price)) continue;

          fallbackItems.push({
            items: name.slice(0, 100),
            qty: String(qty),
            price: price.toFixed(2),
          });
        }

        if (fallbackItems.length > 0) {
          finalItems = fallbackItems;
        }
      }

      // ✅ Set items
      if (finalItems.length > 0) {
        setItemList([...finalItems, { items: '', qty: '1', price: '' }]);
      } else {
        setItemList([{ items: '', qty: '1', price: '' }]);
      }

      // ✅ Set total price
      const totalFromParsed = money(previewData.total || 0);
      if (totalFromParsed > 0) {
        setTotalPrice(totalFromParsed);
      } else {
        const sumFromItems = finalItems.reduce((sum, it) => {
          const unitPrice = money(parseFloat(it.price) || 0);
          const qty = Math.max(1, toIntQty(it.qty));
          return sum + unitPrice * qty;
        }, 0);
        setTotalPrice(sumFromItems > 0 ? money(sumFromItems) : '');
      }

      // ✅ Store receipt image info (will be saved when bill is created)
      if (receiptImageUrl) {
        localStorage.setItem('ocrReceiptImageUrl', receiptImageUrl);
        localStorage.setItem('ocrReceiptImagePublicId', receiptImagePublicId);
      }

      ocrPreview.closePreview();
      setOcrImageFile(null);
    } catch (err) {
      console.error('Accept OCR error:', err);
      alert('เกิดข้อผิดพลาดในการปรับปรุงข้อมูล');
    } finally {
      ocrPreview.setLoading(false);
    }
  };

  const onRejectOcr = () => {
    ocrPreview.closePreview();
    setOcrImageFile(null);
  };

  const resetForm = () => {
    const me = getMeByEmail(users, currentUserEmail);
    setTitle('');
    setDescription('');
    setItemList([{ items: '', qty: '1', price: '' }]);
    setParticipants(
      me
        ? [{ localId: makeLocalId(), kind: 'user', userId: me._id, name: me.name, percent: '', amount: 0, pctMode: 'percent' }]
        : [{ localId: makeLocalId(), kind: 'user', userId: '', name: '', percent: '', amount: 0, pctMode: 'percent' }]
    );
    setSelectedFileName('');
    setSelectedImagePreview(null);
    setTotalPrice('');
    setSharePerPerson(0);
    setUploading(false);
    setSubmitting(false);

    setDraftBillId('');
    setInviteLinkByLocalId({});
    setCopiedInviteLocalId(null);
    setCreatingDraft(false);
    setCreatingInvite(false);
    setIsAddParticipantOpen(false);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (directUploadInputRef.current) directUploadInputRef.current.value = '';
  };

  const handleAddParticipant = () => {
    setIsAddParticipantOpen((v) => !v);
  };

  const handleAddItems = () => {
    setItemList((prev) => [...prev, { items: '', qty: '1', price: '' }]);
  };

  const handleRemoveItem = (index: number) => {
    setItemList((prev) => {
      if (prev.length <= 1) return prev;

      const next = prev.filter((_, i) => i !== index);

      const totalAmount = money(
        next.reduce((sum, row) => {
          const qty = toIntQty(row.qty);
          const unitPrice = money(parseFloat(row.price) || 0);
          return sum + qty * unitPrice;
        }, 0)
      );

      setTotalPrice(totalAmount);
      return next;
    });
  };

  const handleInputChange = (index: number, field: 'items' | 'qty' | 'price', value: string) => {
    const updated = [...itemList];

    const nextValue = field === 'price' ? normalizeMoneyInput(value) : value;
    updated[index] = { ...updated[index], [field]: nextValue };

    const totalAmount = money(
      updated.reduce((sum, row) => {
        const qty = toIntQty(row.qty);
        const unitPrice = money(parseFloat(row.price) || 0);
        return sum + qty * unitPrice;
      }, 0)
    );

    setItemList(updated);
    setTotalPrice(totalAmount);
  };

  // equal
  useEffect(() => {
    if (splitType !== 'equal') {
      setSharePerPerson(0);
      return;
    }

    const t = typeof totalPrice === 'number' ? money(totalPrice) : 0;

    if (t > 0 && selectedCount > 0) {
      const share = money(t / selectedCount);
      setSharePerPerson(share);
      setParticipants((prev) => prev.map((p) => (isSelectableParticipant(p) ? { ...p, amount: share } : { ...p, amount: 0 })));
    } else {
      setSharePerPerson(0);
      setParticipants((prev) => prev.map((p) => ({ ...p, amount: 0 })));
    }
  }, [splitType, totalPrice, selectedCount]);

  // =========================
  // ✅ PERCENT / AMOUNT (นิ่ง ไม่บัค)
  // =========================
  const clampPercentNum = (n: number) => Math.max(0, Math.min(100, round2(n)));

  const getTotalNumber = () => (typeof totalPrice === 'number' ? money(totalPrice) : 0);

  const findBalanceIndex = (arr: Participant[], editedIndex: number) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (isSelectableParticipant(arr[i]) && i !== editedIndex) return i;
    }
    return -1;
  };

  const sumAmounts = (arr: Participant[]) =>
    money(arr.reduce((s, p) => (isSelectableParticipant(p) ? s + money(toNumber(p.amount, 0)) : s), 0));

  // ✅ แก้ % แล้วให้ amount ตาม + คน balance รับเศษ
  const setPercentAt = (index: number, raw: string) => {
    const pct: PercentValue = toPercentValue(raw);

    setParticipants((prev) => {
      const total = getTotalNumber();

      const next: Participant[] = prev.map((p, i): Participant => {
        if (i !== index) return p;
        if (!isSelectableParticipant(p)) return p;

        const pctNum = typeof pct === 'number' ? pct : 0;
        const amt = total > 0 ? money((total * pctNum) / 100) : money(toNumber(p.amount, 0));

        const mode: PercentMode = 'percent';
        return { ...p, percent: pct, amount: amt, pctMode: mode };
      });

      if (total <= 0) return next;

      const bal = findBalanceIndex(next, index);
      if (bal === -1) return next;

      const sumOtherPct = round2(
        next.reduce((s, p, i) => {
          if (i === bal) return s;
          if (!isSelectableParticipant(p)) return s;
          return s + (typeof p.percent === 'number' ? p.percent : 0);
        }, 0)
      );

      const balPct = clampPercentNum(100 - sumOtherPct);
      const balAmt = money((total * balPct) / 100);

      next[bal] = { ...next[bal], percent: balPct, amount: balAmt, pctMode: 'percent' };

      // กันเศษสตางค์
      const diff = money(total - sumAmounts(next));
      if (diff !== 0) {
        const cur = money(toNumber(next[bal].amount, 0));
        const newAmt = money(cur + diff);
        const newPct = total > 0 ? clampPercentNum((newAmt / total) * 100) : 0;
        next[bal] = { ...next[bal], amount: newAmt, percent: newPct, pctMode: 'percent' };
      }

      return next;
    });
  };

  // ✅ แก้ amount แล้วให้ % ตาม + คน balance รับเศษ
  const setAmountAt = (index: number, raw: string) => {
    const normalized = normalizeMoneyInput(raw);
    const amt: AmountValue = normalized === '' ? '' : toAmountValue(normalized);

    setParticipants((prev) => {
      const total = getTotalNumber();

      // total ยังไม่พร้อม -> แค่ set ค่า
      if (total <= 0) {
        return prev.map((p, i): Participant => {
          if (i !== index) return p;
          if (!isSelectableParticipant(p)) return p;
          return { ...p, amount: amt, percent: '', pctMode: 'amount' };
        });
      }

      const next: Participant[] = prev.map((p, i): Participant => {
        if (i !== index) return p;
        if (!isSelectableParticipant(p)) return p;

        const amtNum = money(toNumber(amt, 0));
        const pctNum = clampPercentNum((amtNum / total) * 100);

        return { ...p, amount: amtNum, percent: pctNum, pctMode: 'amount' };
      });

      const bal = findBalanceIndex(next, index);
      if (bal === -1) return next;

      const sumOtherAmt = money(
        next.reduce((s, p, i) => {
          if (i === bal) return s;
          if (!isSelectableParticipant(p)) return s;
          return s + money(toNumber(p.amount, 0));
        }, 0)
      );

      const balAmt = money(total - sumOtherAmt);
      const balPct = total > 0 ? clampPercentNum((balAmt / total) * 100) : 0;

      next[bal] = { ...next[bal], amount: balAmt, percent: balPct, pctMode: 'percent' };

      // กันเศษสตางค์
      const diff = money(total - sumAmounts(next));
      if (diff !== 0) {
        const cur = money(toNumber(next[bal].amount, 0));
        const newAmt = money(cur + diff);
        const newPct = total > 0 ? clampPercentNum((newAmt / total) * 100) : 0;
        next[bal] = { ...next[bal], amount: newAmt, percent: newPct, pctMode: 'percent' };
      }

      return next;
    });
  };

  // ✅ ถ้า Total เปลี่ยน (เช่น OCR เติม total) ให้คำนวณตาม mode แบบนิ่ง ๆ
  useEffect(() => {
    if (splitType !== 'percentage') return;
    const total = getTotalNumber();
    if (total <= 0) return;

    setParticipants((prev) => {
      // หา bal = คนสุดท้ายที่มี userId
      let bal = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (isSelectableParticipant(prev[i])) {
          bal = i;
          break;
        }
      }
      if (bal === -1) return prev;

      const next: Participant[] = prev.map((p): Participant => {
        if (!isSelectableParticipant(p)) return p;

        const mode: PercentMode = p.pctMode ?? 'percent';
        if (mode === 'amount') {
          const amt = money(toNumber(p.amount, 0));
          const pct = clampPercentNum((amt / total) * 100);
          return { ...p, amount: amt, percent: pct, pctMode: 'amount' };
        }

        const pct = typeof p.percent === 'number' ? clampPercentNum(p.percent) : 0;
        const amt = money((total * pct) / 100);
        return { ...p, percent: pct, amount: amt, pctMode: 'percent' };
      });

      // balance ให้รวมเงิน = total
      const sumOtherAmt = money(
        next.reduce((s, p, i) => {
          if (i === bal) return s;
          if (!isSelectableParticipant(p)) return s;
          return s + money(toNumber(p.amount, 0));
        }, 0)
      );

      const balAmt = money(total - sumOtherAmt);
      const balPct = clampPercentNum((balAmt / total) * 100);
      next[bal] = { ...next[bal], amount: balAmt, percent: balPct, pctMode: 'percent' };

      // กันเศษสตางค์
      const diff = money(total - sumAmounts(next));
      if (diff !== 0) {
        const cur = money(toNumber(next[bal].amount, 0));
        const newAmt = money(cur + diff);
        const newPct = clampPercentNum((newAmt / total) * 100);
        next[bal] = { ...next[bal], amount: newAmt, percent: newPct, pctMode: 'percent' };
      }

      // ถ้าไม่เปลี่ยนจริง ๆ คืน prev
      const same = prev.every((p, i) => {
        const a = prev[i];
        const b = next[i];
        return (
          a.userId === b.userId &&
          a.name === b.name &&
          a.amount === b.amount &&
          a.percent === b.percent &&
          (a.pctMode ?? 'percent') === (b.pctMode ?? 'percent')
        );
      });
      return same ? prev : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splitType, totalPrice]);

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeMoneyInput(e.target.value);
    if (normalized === '') setTotalPrice('');
    else setTotalPrice(money(Number(normalized)));
  };

  const personalSum = useMemo(() => {
    if (splitType !== 'personal') return 0;
    return money(selectedParticipants.reduce((sum, p) => sum + money(toNumber(p.amount, 0)), 0));
  }, [splitType, selectedParticipants]);

  const summary = useMemo(() => {
    const total = typeof totalPrice === 'number' && totalPrice > 0 ? money(totalPrice) : 0;

    const rows: SummaryRow[] = selectedParticipants.map((p) => {
      const mode: PercentMode = p.pctMode ?? 'percent';
      const amount = money(toNumber(p.amount, 0));
      const percent = total > 0 ? clampPercentNum((amount / total) * 100) : 0;

      const percentInput =
        mode === 'percent'
          ? typeof p.percent === 'number'
            ? clampPercentNum(p.percent)
            : 0
          : percent;

      const amountInput = mode === 'amount' ? amount : 0;

      return {
        key: p.participantId || p.localId,
        userId: p.userId,
        name: p.name,
        amount,
        percent,
        percentInput,
        amountInput,
        pctMode: mode,
      };
    });

    // ปรับ diff ให้รวม = total (กันเศษสตางค์) — ปรับคนท้ายสุด
    if (rows.length > 0 && total > 0) {
      const sumAmt = money(rows.reduce((s, r) => s + r.amount, 0));
      const diff = money(total - sumAmt);
      if (diff !== 0) {
        const last = rows.length - 1;
        const newAmt = money(rows[last].amount + diff);
        rows[last] = {
          ...rows[last],
          amount: newAmt,
          percent: total > 0 ? clampPercentNum((newAmt / total) * 100) : 0,
        };
      }
    }

    return { total, rows };
  }, [totalPrice, selectedParticipants]);

  const totalPercent = useMemo(() => {
    if (splitType !== 'percentage') return 0;
    return round2(summary.rows.reduce((s, r) => s + r.percent, 0));
  }, [splitType, summary.rows]);

  const buildDraftPayload = () => {
    const cleanedItems = itemList
      .map((it) => {
        const name = (it.items || '').trim();
        const qty = toIntQty(it.qty);
        const unitPrice = money(toNumber(it.price, 0));
        const lineTotal = money(qty * unitPrice);

        if (!name) return null;

        return {
          items: name,
          qty,
          unit_price: unitPrice,
          price: lineTotal,
          line_total: lineTotal,
        };
      })
      .filter(
        (
          it
        ): it is { items: string; qty: number; unit_price: number; price: number; line_total: number } => it !== null
      );

    const cleanedParticipants = participants
      .filter(isSelectableParticipant)
      .map((p) => ({
        participantId: p.participantId,
        kind: p.kind,
        userId: p.userId,
        guestId: p.guestId,
        name: p.name.trim(),
        percent: p.percent,
        amount: money(toNumber(p.amount, 0)),
      }));

    const itemsTotal = money(cleanedItems.reduce((sum, it) => sum + it.price, 0));
    const effectiveTotal = typeof totalPrice === 'number' && totalPrice > 0 ? money(totalPrice) : itemsTotal;

    return {
      title: title.trim(),
      totalPrice: effectiveTotal,
      splitType,
      participants: cleanedParticipants,
      description,
      items: cleanedItems,
    };
  };

  const syncParticipantsFromDraft = (dbParticipants: DraftDbParticipant[]) => {
    setParticipants((prev) =>
      prev.map((localRow) => {
        const matched = findDraftRowForLocalParticipant(prev, localRow, dbParticipants);

        if (!matched) return localRow;

        return {
          ...localRow,
          participantId: matched._id ? String(matched._id) : localRow.participantId,
          guestId: matched.guestId ? String(matched.guestId) : localRow.guestId,
          amount: typeof matched.amount === 'number' ? matched.amount : localRow.amount,
          joinedAt: matched.joinedAt ?? localRow.joinedAt,
          kind: matched.kind ?? localRow.kind,
          name: String(matched.name ?? localRow.name),
        };
      })
    );
  };

  const syncDraftBill = async (): Promise<{ billId: string; dbParticipants?: DraftDbParticipant[] }> => {
    const token = localStorage.getItem('token');
    const draftPayload = buildDraftPayload();

    if (!draftBillId) {
      setCreatingDraft(true);
      try {
        const res = await fetch('/api/bills/draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(draftPayload),
        });

        const raw = await res.text();
        let data:
          | { ok?: boolean; bill?: { _id?: string; participants?: DraftDbParticipant[] }; error?: string }
          | null = null;

        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          data = { error: raw || `HTTP ${res.status}` };
        }

        if (!res.ok || !data?.bill?._id) {
          throw new Error(data?.error || `บันทึก draft bill ไม่สำเร็จ (HTTP ${res.status})`);
        }

        const newDraftId = String(data.bill._id);
        setDraftBillId(newDraftId);

        if (Array.isArray(data.bill.participants)) {
          syncParticipantsFromDraft(data.bill.participants);
        }

        return { billId: newDraftId, dbParticipants: data.bill.participants };
      } finally {
        setCreatingDraft(false);
      }
    }

    setCreatingDraft(true);
    try {
      const res = await fetch(`/api/bills/${draftBillId}/draft`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(draftPayload),
      });

      const raw = await res.text();
      let data:
        | { ok?: boolean; bill?: { _id?: string; participants?: DraftDbParticipant[] }; error?: string }
        | null = null;

      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        data = { error: raw || `HTTP ${res.status}` };
      }

      if (!res.ok || !data?.bill?._id) {
        throw new Error(data?.error || `อัปเดต draft bill ไม่สำเร็จ (HTTP ${res.status})`);
      }

      if (Array.isArray(data.bill.participants)) {
        syncParticipantsFromDraft(data.bill.participants);
      }

      return { billId: String(data.bill._id), dbParticipants: data.bill.participants };
    } finally {
      setCreatingDraft(false);
    }
  };

  const fetchDraftParticipants = async (billId: string): Promise<DraftDbParticipant[]> => {
    const token = localStorage.getItem('token');

    const res = await fetch(`/api/bills/${billId}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      cache: 'no-store',
    });

    const data = (await res.json().catch(() => null)) as { bill?: { participants?: DraftDbParticipant[] }; error?: string } | null;

    if (!res.ok) {
      throw new Error(data?.error || 'โหลด draft bill ไม่สำเร็จ');
    }

    return Array.isArray(data?.bill?.participants) ? data.bill.participants : [];
  };

  useEffect(() => {
    if (!draftBillId) return;

    let cancelled = false;

    const syncLatestDraftParticipants = async () => {
      try {
        const rows = await fetchDraftParticipants(draftBillId);
        if (cancelled) return;

        if (rows.length > 0) {
          syncParticipantsFromDraft(rows);
        }
      } catch (err) {
        console.error('AUTO REFRESH DRAFT PARTICIPANTS ERROR:', err);
      }
    };

    void syncLatestDraftParticipants();

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void syncLatestDraftParticipants();
      }
    }, 3000);

    const handleFocus = () => {
      void syncLatestDraftParticipants();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleFocus);
    };
  }, [draftBillId]);

  const resolveParticipantIdForInvite = async (
    billId: string,
    localTarget: Participant,
    seedParticipants?: DraftDbParticipant[]
  ): Promise<string> => {
    if (localTarget.participantId) return localTarget.participantId;

    let source = seedParticipants ?? [];

    if (source.length === 0) {
      source = await fetchDraftParticipants(billId);
    }

    if (source.length > 0) {
      syncParticipantsFromDraft(source);
    }

    const guestLikeLocalRows = participants.filter(
      (p) => p.kind === 'guest' || p.kind === 'guest_placeholder'
    );
    const guestLikeDbRows = source.filter(
      (p) => p.kind === 'guest' || p.kind === 'guest_placeholder' || !!p.guestId
    );

    if (localTarget.kind === 'user') {
      const byUser = source.find(
        (row) => row.kind === 'user' && row.userId === localTarget.userId
      );
      return byUser?._id ? String(byUser._id) : '';
    }

    const localIndex = guestLikeLocalRows.findIndex(
      (row) => row.localId === localTarget.localId
    );
    if (localIndex === -1) return '';

    const matched = guestLikeDbRows[localIndex];
    return matched?._id ? String(matched._id) : '';
  };

  const handleCreateInvite = async (participantLocalId: string) => {
    if (creatingDraft || creatingInvite || submitting) return;

    try {
      const existingUrl = inviteLinkByLocalId[participantLocalId];
      if (existingUrl) {
        await navigator.clipboard.writeText(existingUrl);
        setCopiedInviteLocalId(participantLocalId);

        window.setTimeout(() => {
          setCopiedInviteLocalId((prev) => (prev === participantLocalId ? null : prev));
        }, 1500);

        return;
      }

      const token = localStorage.getItem('token');
      const localTarget = participants.find((p) => p.localId === participantLocalId);

      if (!localTarget) throw new Error('ไม่พบ guest slot');
      if (localTarget.kind !== 'guest_placeholder') {
        throw new Error('สร้างลิงก์ได้เฉพาะ guest slot ที่ยังไม่ถูก claim');
      }

      const { billId, dbParticipants } = await syncDraftBill();
      const participantId = await resolveParticipantIdForInvite(billId, localTarget, dbParticipants);

      if (!participantId) throw new Error('ยังไม่ได้ participantId ของ guest slot');

      setCreatingInvite(true);

      const inviteRes = await fetch(`/api/bills/${billId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ participantId, expiresInDays: 7, maxUses: 1 }),
      });

      const inviteData = (await inviteRes.json().catch(() => null)) as { invitePath?: string; error?: string } | null;

      if (!inviteRes.ok || !inviteData?.invitePath) {
        throw new Error(inviteData?.error || 'สร้างลิงก์เชิญไม่สำเร็จ');
      }

      const fullUrl = `${window.location.origin}${inviteData.invitePath}`;

      setInviteLinkByLocalId((prev) => ({ ...prev, [participantLocalId]: fullUrl }));
      await navigator.clipboard.writeText(fullUrl);
      setCopiedInviteLocalId(participantLocalId);

      window.setTimeout(() => {
        setCopiedInviteLocalId((prev) => (prev === participantLocalId ? null : prev));
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      alert(message);
    } finally {
      setCreatingInvite(false);
    }
  };

  // ✅ กันดับเบิ้ลคลิ๊กสร้างบิล + ปัด/จำกัดเงินก่อนส่ง
  const handleSubmit = async () => {
    if (submitting || creatingDraft || creatingInvite) return;
    setSubmitting(true);

    try {
      const token = localStorage.getItem('token');
      const cleanedItems = itemList
        .map((it) => {
          const name = (it.items || '').trim();
          const qty = toIntQty(it.qty);
          const unitPrice = money(toNumber(it.price, 0));
          const lineTotal = money(qty * unitPrice);

          return {
            items: name,
            qty,
            unit_price: unitPrice,
            price: lineTotal,
            line_total: lineTotal,
          };
        })
        .filter((it) => it.items.length > 0);

      const cleanedParticipantsBase = participants
        .filter(isSelectableParticipant)
        .map((p) => ({
          participantId: p.participantId,
          kind: p.kind,
          userId: p.userId,
          guestId: p.guestId,
          name: p.name,
          percent: p.percent,
          amount: p.amount,
          pctMode: (p.pctMode ?? 'percent') as PercentMode,
        }));

      if (!title.trim()) return alert('กรุณากรอก Bill Title');
      if (cleanedItems.length === 0) return alert('กรุณาเพิ่มรายการอาหารอย่างน้อย 1 รายการ');
      if (cleanedParticipantsBase.length === 0) return alert('กรุณาเลือก Participants อย่างน้อย 1 คน');

      const itemsTotal = money(cleanedItems.reduce((sum, it) => sum + it.price, 0));
      const effectiveTotal = typeof totalPrice === 'number' && totalPrice > 0 ? money(totalPrice) : itemsTotal;

      let cleanedParticipants: Array<{
        participantId?: string;
        kind: ParticipantKind;
        userId?: string;
        guestId?: string;
        name: string;
        percent?: number | '';
        amount: number;
      }> = [];

      if (splitType === 'personal') {
        const hasInvalid = cleanedParticipantsBase.some((p) => !(money(toNumber(p.amount, 0)) > 0));
        if (hasInvalid) return alert('โหมดของใครของมัน: กรุณาใส่ยอดเงินของแต่ละคนให้มากกว่า 0');

        const sumAmt = money(cleanedParticipantsBase.reduce((s, p) => s + money(toNumber(p.amount, 0)), 0));
        const diff = money(effectiveTotal - sumAmt);
        if (Math.abs(diff) > 0.01) {
          return alert(
            `ยอดรวมของผู้เข้าร่วม (${sumAmt.toFixed(2)}) ต้องเท่ากับ Total Amount (${effectiveTotal.toFixed(2)})\nต่างกัน ${diff.toFixed(2)}`
          );
        }

        cleanedParticipants = cleanedParticipantsBase.map((p) => ({
          participantId: p.participantId,
          kind: p.kind,
          userId: p.userId,
          guestId: p.guestId,
          name: p.name,
          percent: '',
          amount: money(toNumber(p.amount, 0)),
        }));
      } else if (splitType === 'percentage') {
        if (!(effectiveTotal > 0)) return alert('กรุณากรอก Total Amount ให้มากกว่า 0 ก่อน');

        const temp = cleanedParticipantsBase.map((p) => {
          const mode = p.pctMode;

          if (mode === 'amount') {
            const amt = money(toNumber(p.amount, 0));
            if (!(amt > 0)) return { participantId: p.participantId, kind: p.kind, userId: p.userId, guestId: p.guestId, name: p.name, percent: NaN, amount: 0, mode };
            const percent = round2((amt / effectiveTotal) * 100);
            return { participantId: p.participantId, kind: p.kind, userId: p.userId, guestId: p.guestId, name: p.name, percent, amount: amt, mode };
          }

          const pctNum = p.percent === '' || p.percent === undefined ? NaN : Number(p.percent);
          if (!Number.isFinite(pctNum)) return { participantId: p.participantId, kind: p.kind, userId: p.userId, guestId: p.guestId, name: p.name, percent: NaN, amount: 0, mode };

          const pct = round2(Math.max(0, Math.min(100, pctNum)));
          const amt = money((effectiveTotal * pct) / 100);
          return { participantId: p.participantId, kind: p.kind, userId: p.userId, guestId: p.guestId, name: p.name, percent: pct, amount: amt, mode };
        });

        const hasMissing = temp.some((p) => !Number.isFinite(p.percent));
        if (hasMissing) return alert('โหมด %: กรุณาใส่ "เปอร์เซ็นต์" หรือ "จำนวนเงิน" ให้ครบทุกคนที่เลือก');

        const sumAmt0 = money(temp.reduce((s, p) => s + p.amount, 0));
        const diff0 = money(effectiveTotal - sumAmt0);

        // ปรับเศษให้คนท้ายสุดที่ไม่ใช่ amount-fix ก่อน
        if (diff0 !== 0 && temp.length > 0) {
          let idx = -1;
          for (let i = temp.length - 1; i >= 0; i--) {
            if (temp[i].mode !== 'amount') {
              idx = i;
              break;
            }
          }
          if (idx === -1) idx = temp.length - 1;

          temp[idx].amount = money(temp[idx].amount + diff0);
          temp[idx].percent = round2((temp[idx].amount / effectiveTotal) * 100);
        }

        cleanedParticipants = temp.map((p) => ({
          participantId: p.participantId,
          kind: p.kind,
          userId: p.userId,
          guestId: p.guestId,
          name: p.name,
          amount: money(p.amount),
          percent: round2((money(p.amount) / effectiveTotal) * 100),
        }));
      } else {
        const count = cleanedParticipantsBase.length;
        const share = count > 0 ? money(effectiveTotal / count) : 0;

        cleanedParticipants = cleanedParticipantsBase.map((p) => ({
          participantId: p.participantId,
          kind: p.kind,
          userId: p.userId,
          guestId: p.guestId,
          name: p.name,
          percent: '',
          amount: share,
        }));

        const sumAmt = money(cleanedParticipants.reduce((s, p) => s + p.amount, 0));
        const diff = money(effectiveTotal - sumAmt);
        if (diff !== 0 && cleanedParticipants.length > 0) {
          cleanedParticipants[cleanedParticipants.length - 1].amount = money(
            cleanedParticipants[cleanedParticipants.length - 1].amount + diff
          );
        }
      }

      const endpoint = draftBillId ? `/api/bills/${draftBillId}/publish` : '/api/bills';
      const method = draftBillId ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          title,
          totalPrice: effectiveTotal,
          splitType,
          participant: cleanedParticipants,
          participants: cleanedParticipants,
          description,
          items: cleanedItems,
        }),
      });

      const raw = await res.text();
      const data: unknown = (() => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          return { error: raw } as Record<string, unknown>;
        }
      })();

      const errorMsg = (() => {
        if (typeof data !== 'object' || data === null) return undefined;
        const rec = data as Record<string, unknown>;
        const err = rec.error;
        const msg = rec.message;
        if (typeof err === 'string' && err.trim()) return err;
        if (typeof msg === 'string' && msg.trim()) return msg;
        return undefined;
      })();

      if (res.ok) {
        alert(draftBillId ? 'เปิดบิลสำเร็จ!' : 'สร้างบิลสำเร็จ!');
        resetForm();
      } else {
        console.log('CREATE BILL ERROR:', res.status, data);
        alert(`สร้างบิลไม่สำเร็จ: ${errorMsg ?? 'Bad Request'}`);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#fbf7f1] text-[#111827]">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-black/5">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg">🍊</span>
            </span>
            <span className="font-semibold">Smart Bill Sharing System</span>
          </div>
        </div>
      </header>

      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-8 relative">
          <h1 className="text-3xl font-bold mb-4 text-center text-[#4a4a4a] ">
            Add New Bill <span className="text-sm font-normal text-gray-500">({splitType})</span>
          </h1>

          <div className="border-dashed border-2 border-gray-300 rounded-xl p-8 text-center mb-6">
            <p className="text-lg text-[#4a4a4a] mb-2">Upload a receipt or drag and drop</p>
            <p className="text-xs text-gray-400 mb-2">PNG, JPG up to 10MB</p>

            {selectedImagePreview ? (
              <div className="mb-4 relative">
                <div className="relative mb-3 h-64 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  <Image
                    src={selectedImagePreview}
                    alt="Receipt preview"
                    fill
                    unoptimized
                    className="object-contain"
                  />
                </div>
                <p className="text-xs text-gray-500">
                  Selected: <span className="font-medium">{selectedFileName}</span>
                </p>
              </div>
            ) : (
              <div className="mb-4" />
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptChange} />
            <input ref={directUploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadImageDirectly} />

            <div className="flex gap-3 flex-wrap justify-center">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={btnPrimary}
                disabled={uploading || submitting}
              >
                {uploading ? 'Processing...' : '🤖 Scan with OCR'}
              </button>
              <button
                type="button"
                onClick={() => directUploadInputRef.current?.click()}
                className={btnSecondary}
                disabled={uploading || submitting}
              >
                {uploading ? 'Processing...' : '📸 Upload Only'}
              </button>
            </div>

          </div>

          <div className="flex items-center justify-center mb-6">
            <hr className="w-1/3 border-[#e0e0e0]" />
            <span className="mx-2 text-[#4a4a4a] text-sm">OR</span>
            <hr className="w-1/3 border-[#e0e0e0]" />
          </div>

          {/* Bill Title */}
          <div className="mb-4">
            <label className="block mb-1 text-sm text-gray-600">Bill Title</label>
            <input
              type="text"
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="e.g., Friday Team Lunch"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Items */}
          <div className="mb-4">
            {itemList.map((item, index) => (
              <div key={index} className="mb-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block mb-1 text-sm text-gray-600">Items</label>
                    <input
                      type="text"
                      className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      placeholder="e.g., Fried rice"
                      value={item.items}
                      onChange={(e) => handleInputChange(index, 'items', e.target.value)}
                    />
                  </div>

                  <div className="w-24">
                    <label className="block mb-1 text-sm text-gray-600">Qty</label>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      placeholder="1"
                      value={item.qty}
                      onChange={(e) => handleInputChange(index, 'qty', e.target.value)}
                    />
                  </div>

                  <div className="flex-1">
                    <label className="block mb-1 text-sm text-gray-600">Price</label>
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      placeholder="0.00"
                      value={item.price}
                      onChange={(e) => handleInputChange(index, 'price', e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(index)}
                    disabled={itemList.length <= 1}
                    className={`px-4 py-2 rounded-lg text-sm border transition ${itemList.length <= 1
                      ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
                      : 'border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400'
                      }`}
                  >
                    ลบรายการ
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleAddItems}
            className="mt-3 text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
            type="button"
          >
            ➕ เพิ่มรายการอาหาร
          </button>

          {/* Participants */}
          <div className="mb-6 mt-6">
            <label className="block mb-1 text-sm text-gray-600">Participants</label>

            <div className="space-y-3">
              {participants.map((participant, index) => {
                const isOwnerRow = Boolean(
                  index === 0 &&
                  participant.kind === 'user' &&
                  participant.userId &&
                  users.find((u) => u.email === currentUserEmail)?._id === participant.userId
                );
                const isGuestSlot = participant.kind === 'guest_placeholder' || participant.kind === 'guest';
                const canEditSplitValue = participant.kind === 'user' ? !!participant.userId : isGuestSlot;

                return (
                  <div key={participant.localId} className="flex gap-2 items-center">
                    {participant.kind === 'user' ? (
                      <select
                        className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                        value={participant.userId ?? ''}
                        disabled={isOwnerRow}
                        onChange={(e) =>
                          setParticipants((prev) =>
                            prev.map((p): Participant =>
                              p.localId === participant.localId
                                ? {
                                    ...p,
                                    userId: e.target.value,
                                    name: users.find((u) => u._id === e.target.value)?.name || '',
                                  }
                                : p
                            )
                          )
                        }
                      >
                        <option value="">-- เลือกผู้ใช้ --</option>
                        {users
                          .filter(
                            (u) =>
                              !participants.some(
                                (p) =>
                                  p.localId !== participant.localId &&
                                  p.kind === 'user' &&
                                  p.userId === u._id
                              )
                          )
                          .map((u) => (
                            <option key={u._id} value={u._id}>
                              {u.name}
                              {u.email === currentUserEmail ? ' (You)' : ''}
                            </option>
                          ))}
                      </select>
                    ) : (
                      <div className="flex-1 p-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-800">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{participant.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                            {participant.kind === 'guest' ? 'Guest joined' : 'Guest slot'}
                          </span>
                        </div>
                      </div>
                    )}

                    {splitType === 'percentage' && (
                      <>
                        <div className="w-24">
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.01}
                            inputMode="decimal"
                            disabled={!canEditSplitValue}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00] disabled:bg-gray-100"
                            placeholder="%"
                            value={participant.percent === '' || participant.percent === undefined ? '' : participant.percent}
                            onChange={(e) => setPercentAt(index, e.target.value)}
                          />
                        </div>

                        <div className="w-32">
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={!canEditSplitValue}
                            className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00] disabled:bg-gray-100"
                            placeholder="฿"
                            value={participant.amount === '' ? '' : money(Number(participant.amount)).toFixed(2)}
                            onChange={(e) => setAmountAt(index, e.target.value)}
                          />
                        </div>
                      </>
                    )}

                    {splitType === 'personal' && (
                      <div className="w-32">
                        <input
                          type="text"
                          inputMode="decimal"
                          disabled={!canEditSplitValue}
                          className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00] disabled:bg-gray-100"
                          placeholder="฿"
                          value={participant.amount === '' ? '' : money(Number(participant.amount)).toFixed(2)}
                          onChange={(e) => {
                            const normalized = normalizeMoneyInput(e.target.value);
                            const amt = normalized === '' ? '' : toAmountValue(normalized);
                            setParticipants((prev) =>
                              prev.map((p): Participant =>
                                p.localId === participant.localId ? { ...p, amount: amt } : p
                              )
                            );
                          }}
                        />
                      </div>
                    )}

                    {isGuestSlot ? (
                      <button
                        type="button"
                        disabled={
                          participant.kind !== 'guest_placeholder' ||
                          creatingDraft ||
                          creatingInvite ||
                          submitting
                        }
                        onClick={() => handleCreateInvite(participant.localId)}
                        className={`px-3 py-2 rounded-lg text-sm border ${
                          participant.kind !== 'guest_placeholder' || creatingDraft || creatingInvite || submitting
                            ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
                            : copiedInviteLocalId === participant.localId
                              ? 'border-green-300 text-green-700 bg-green-50'
                              : inviteLinkByLocalId[participant.localId]
                                ? 'border-blue-300 text-blue-700 hover:bg-blue-50'
                                : 'border-orange-300 text-orange-700 hover:bg-orange-50'
                        }`}
                      >
                        {copiedInviteLocalId === participant.localId
                          ? '✅ คัดลอกแล้ว'
                          : inviteLinkByLocalId[participant.localId]
                            ? '📋 คัดลอกลิงก์'
                            : '🔗 เชิญ'}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      disabled={isOwnerRow}
                      onClick={() => {
                        if (isOwnerRow) return;
                        setParticipants((prev) =>
                          prev.length > 1 ? prev.filter((p) => p.localId !== participant.localId) : prev
                        );
                        setInviteLinkByLocalId((prev) => {
                          const next = { ...prev };
                          delete next[participant.localId];
                          return next;
                        });
                        setCopiedInviteLocalId((prev) =>
                          prev === participant.localId ? null : prev
                        );
                      }}
                      className={`px-5 py-2 rounded-lg transition-all duration-200 shadow-sm ${
                        isOwnerRow
                          ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                          : 'bg-red-500 text-white hover:bg-red-600 hover:scale-105'
                      }`}
                    >
                      🗑
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                onClick={handleAddParticipant}
                className="text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
                type="button"
              >
                ➕ เพิ่มผู้เข้าร่วม
              </button>

              <button
                onClick={handleAddGuestSlot}
                className="text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
                type="button"
              >
                ➕ เพิ่ม Guest Slot
              </button>

              {draftBillId ? (
                <span className="text-xs px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200">
                  Draft created
                </span>
              ) : null}
            </div>

            {isAddParticipantOpen && (
              <AddParticipantDropdown
                isOpen={isAddParticipantOpen}
                onClose={() => {
                  setIsAddParticipantOpen(false);
                }}
                onAddParticipant={addParticipantByUser}
                selectedUserIds={selectedUserIds}
                currentUserEmail={currentUserEmail}
              />
            )}
          </div>

          {/* Total Amount */}
          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">Total Amount</label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="0.00"
              value={totalPrice === '' ? '' : money(totalPrice).toFixed(2)}
              onChange={handleAmountChange}
            />
            <p className="mt-1 text-xs text-gray-400">สูงสุด 999999.99</p>
          </div>

          {/* Description */}
          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">Description</label>
            <textarea
              rows={3}
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00] resize-none"
              placeholder="....."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Total + Summary */}
          <div className="mb-4 text-center">
            <p className="text-lg text-[#4a4a4a]">รวมทั้งหมด</p>
            <p className="text-2xl font-semibold text-[#fb8c00]">{money(summary.total).toFixed(2)} ฿</p>

            {splitType === 'equal' && (
              <p className="text-xs text-gray-500 mt-1">
                หารเท่ากัน: {selectedCount > 0 ? money(sharePerPerson).toFixed(2) : '0.00'} ฿/คน
              </p>
            )}

            {splitType === 'percentage' && (
              <p className={`text-xs mt-1 ${Math.abs(totalPercent - 100) > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                รวมเปอร์เซ็นต์: {totalPercent}% {Math.abs(totalPercent - 100) > 0.01 ? '(ควรเป็น 100%)' : '✓'}
              </p>
            )}

            {splitType === 'personal' && (
              <p
                className={`text-xs mt-1 ${summary.total > 0 && Math.abs(personalSum - summary.total) > 0.01 ? 'text-red-500' : 'text-gray-500'
                  }`}
              >
                รวมที่กรอก: {money(personalSum).toFixed(2)} ฿
              </p>
            )}
          </div>
          <div className="mb-6">
            <div className="text-center mb-2">
              <p className="text-lg font-semibold text-[#4a4a4a]">สรุปยอดที่ต้องจ่าย</p>
            </div>

            <div className="bg-[#f1f1f1] rounded-2xl p-5">
              {summary.rows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">ยังไม่มีผู้เข้าร่วม</p>
              ) : (
                <div className="space-y-2">
                  {summary.rows.map((p) => (
                    <div key={p.key} className="flex items-center justify-between">
                      <div className="text-[#4a4a4a]">
                        {p.name} ({summary.total > 0 ? p.percent.toFixed(0) : '0'}%)
                        <div className="text-xs text-gray-500">
                          {splitType === 'equal'
                            ? `หารเท่ากัน: ${selectedCount > 0 ? money(sharePerPerson).toFixed(2) : '0.00'} ฿`
                            : splitType === 'percentage'
                              ? `ตั้งไว้: ${p.percentInput.toFixed(2)}%`
                              : `ใส่เอง: ${money(p.amount).toFixed(2)} ฿`}
                        </div>
                      </div>

                      <div className="text-[#4a4a4a] font-semibold">{money(p.amount).toFixed(2)} ฿</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center mt-4">
            <button
              onClick={handleSubmit}
              disabled={submitting || uploading}
              className={`w-70 inline-flex items-center justify-center gap-2 px-3 py-3 font-semibold rounded-full shadow-md transition-all duration-300 ${submitting || uploading
                ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                : 'bg-[#fb8c00] text-white hover:bg-[#e65100] hover:shadow-lg'
                }`}
              type="button"
            >
              <CheckCircleIcon className="w-5 h-5" />
              <span>{submitting ? 'Saving...' : 'Confirm and Save Bill'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ✅ OCR Preview Modal */}
      <OcrPreviewModal
        isOpen={ocrPreview.isOpen}
        title={ocrPreview.previewData.title}
        items={ocrPreview.previewData.items}
        total={ocrPreview.previewData.total}
        imagePreview={ocrPreview.imagePreview}
        fileName={ocrPreview.selectedFileName}
        onAccept={onAcceptOcr}
        onReject={onRejectOcr}
        isLoading={ocrPreview.isLoading}
      />
    </div>
  );
}

export default function CreatePercentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <CreatePercentPageInner />
    </Suspense>
  );
}