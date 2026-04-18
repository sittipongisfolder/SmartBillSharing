'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { MagnifyingGlassPlusIcon } from '@heroicons/react/24/outline';
import { useSession } from 'next-auth/react';
import { OcrPreviewModal, type OcrPreviewAcceptPayload } from '@/components/OcrPreviewModal';
import { ImageZoomModal } from '@/components/ImageZoomModal';
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
  if (noExtraDots.includes('.') && decPart === '') return `${intPart || '0'}.`;
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

const btnGhost =
  'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-[#fb8c00] transition hover:bg-orange-50 hover:text-[#e65100]';

const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 transition hover:border-red-300 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50';

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
  const splitType = 'percentage' as SplitType;
  const splitTypeLabel = 'หารตามเปอร์เซ็นต์';

  const [title, setTitle] = useState('');
  const [totalPrice, setTotalPrice] = useState<number | ''>('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([
    { localId: makeLocalId(), kind: 'user', userId: '', name: '', percent: '', amount: 0, pctMode: 'percent' },
  ]);
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
  const [isSelectedImageZoomOpen, setIsSelectedImageZoomOpen] = useState(false);

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

  // โหลดรายชื่อผู้ใช้
  useEffect(() => {
    async function fetchUsers() {
      
      const res = await fetch('/api/users', {
        
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

    localStorage.removeItem('ocrReceiptImageUrl');
    localStorage.removeItem('ocrReceiptImagePublicId');

    setSelectedFileName(picked.name);
    setUploading(true);

    try {
      const compressed = await compressImage(picked);
      const imagePreviewUrl = URL.createObjectURL(compressed);
      setSelectedImagePreview(imagePreviewUrl);
      setOcrImageFile(compressed);

      
      const fd = new FormData();
      fd.append('file', compressed);
      if (draftBillId) {
        fd.append('billId', draftBillId);
      }

      const uploadRes = await fetch('/api/ocr/upload-receipt', {
        method: 'POST',
        
        body: fd,
      });

      if (!uploadRes.ok) {
        throw new Error('อัปโหลดรูปบิลไม่สำเร็จ');
      }

      const uploadData = (await uploadRes.json()) as {
        url?: string;
        publicId?: string;
      };

      const receiptImageUrl = uploadData.url || '';
      const receiptImagePublicId = uploadData.publicId || '';

      if (receiptImageUrl) {
        localStorage.setItem('ocrReceiptImageUrl', receiptImageUrl);
        localStorage.setItem('ocrReceiptImagePublicId', receiptImagePublicId);
      }
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
      

      const compressed = await compressImage(picked);
      const fd = new FormData();
      fd.append('file', compressed);

      // ✅ Set 90 second timeout for OCR API (includes processing time)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          
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

        // ✅ Create preview URL without base64 conversion for faster UI response
        const imagePreviewUrl = URL.createObjectURL(compressed);
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

  const onAcceptOcr = async (accepted: OcrPreviewAcceptPayload) => {
    ocrPreview.setLoading(true);

    try {
      const pendingImageFile = ocrImageFile;

      // ✅ Upload receipt image to Cloudinary if file exists
      // ย้ายไปอัปโหลดแบบเบื้องหลังหลังจากปิด modal เพื่อให้กดปุ่มแล้วตอบสนองทันที

      const rawText = accepted.rawText || '';

      // ✅ Set title from preview
      const ocrTitle = accepted.title?.trim();
      if (ocrTitle) {
        setTitle((prev) => (prev.trim() ? prev : ocrTitle));
      }

      // ✅ Set description from raw_text
      if (rawText) {
        setDescription(rawText);
      }

      // ✅ Map items from preview
      const mappedFromParsed: ItemRow[] = accepted.selectedItems
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
        setItemList(finalItems);
      } else {
        setItemList([{ items: '', qty: '1', price: '' }]);
      }

      // ✅ Set total price
      const totalFromParsed = money(accepted.selectedTotal || 0);
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

      ocrPreview.closePreview();
      setOcrImageFile(null);

      if (pendingImageFile && !localStorage.getItem('ocrReceiptImageUrl')) {
        void (async () => {
          try {
            const fd = new FormData();
            fd.append('file', pendingImageFile);

            const uploadRes = await fetch('/api/ocr/upload-receipt', {
              method: 'POST',
              body: fd,
            });

            if (!uploadRes.ok) return;

            const uploadData = (await uploadRes.json()) as {
              url?: string;
              publicId?: string;
            };

            if (uploadData.url) {
              localStorage.setItem('ocrReceiptImageUrl', uploadData.url);
              localStorage.setItem('ocrReceiptImagePublicId', uploadData.publicId || '');
            }
          } catch (uploadErr) {
            console.error('Background receipt upload failed:', uploadErr);
          }
        })();
      }
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
    setSelectedFileName('');
    setSelectedImagePreview(null);

    localStorage.removeItem('ocrReceiptImageUrl');
    localStorage.removeItem('ocrReceiptImagePublicId');

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (directUploadInputRef.current) directUploadInputRef.current.value = '';
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
    setIsSelectedImageZoomOpen(false);
    setTotalPrice('');
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

  // =========================
  // ✅ PERCENT / AMOUNT (นิ่ง ไม่บัค)
  // =========================
  const clampPercentNum = (n: number) => Math.max(0, Math.min(100, round2(n)));

  const itemsTotalForSplit = useMemo(() => {
    return money(
      itemList.reduce((sum, row) => {
        const qty = toIntQty(row.qty);
        const unitPrice = money(parseFloat(row.price) || 0);
        return sum + qty * unitPrice;
      }, 0)
    );
  }, [itemList]);

  const getTotalNumber = () => {
    const manualTotal = typeof totalPrice === 'number' ? money(totalPrice) : 0;
    return manualTotal > 0 ? manualTotal : itemsTotalForSplit;
  };

  /** หา index ของคนที่เลือกได้ทั้งหมด ยกเว้น editedIndex */
  const findOtherSelectableIndices = (arr: Participant[], editedIndex: number) => {
    const indices: number[] = [];
    for (let i = 0; i < arr.length; i++) {
      if (i !== editedIndex && isSelectableParticipant(arr[i])) indices.push(i);
    }
    return indices;
  };

  const sumAmounts = (arr: Participant[]) =>
    money(arr.reduce((s, p) => (isSelectableParticipant(p) ? s + money(toNumber(p.amount, 0)) : s), 0));

  // ✅ แก้ % แล้วเศษที่เหลือหารเท่ากันให้คนอื่นทุกคน
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

      const others = findOtherSelectableIndices(next, index);
      if (others.length === 0) return next;

      // คำนวณ % ที่เหลือ แล้วหารเท่ากัน
      const editedPct = typeof pct === 'number' ? pct : 0;
      const remainPct = clampPercentNum(100 - editedPct);
      const eachPct = round2(remainPct / others.length);

      for (let i = 0; i < others.length; i++) {
        const idx = others[i];
        const thisPct = i < others.length - 1 ? eachPct : clampPercentNum(remainPct - eachPct * (others.length - 1));
        const thisAmt = money((total * thisPct) / 100);
        next[idx] = { ...next[idx], percent: thisPct, amount: thisAmt, pctMode: 'percent' };
      }

      // กันเศษสตางค์ — ปรับคนสุดท้าย
      const diff = money(total - sumAmounts(next));
      if (diff !== 0) {
        const lastIdx = others[others.length - 1];
        const cur = money(toNumber(next[lastIdx].amount, 0));
        const newAmt = money(cur + diff);
        const newPct = total > 0 ? clampPercentNum((newAmt / total) * 100) : 0;
        next[lastIdx] = { ...next[lastIdx], amount: newAmt, percent: newPct, pctMode: 'percent' };
      }

      return next;
    });
  };

  // ✅ แก้ amount แล้วเศษที่เหลือหารเท่ากันให้คนอื่นทุกคน
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

      const others = findOtherSelectableIndices(next, index);
      if (others.length === 0) return next;

      // คำนวณเงินที่เหลือ แล้วหารเท่ากัน
      const editedAmt = money(toNumber(amt, 0));
      const remainAmt = money(total - editedAmt);
      const eachAmt = money(remainAmt / others.length);

      for (let i = 0; i < others.length; i++) {
        const idx = others[i];
        const thisAmt = i < others.length - 1 ? eachAmt : money(remainAmt - eachAmt * (others.length - 1));
        const thisPct = total > 0 ? clampPercentNum((thisAmt / total) * 100) : 0;
        next[idx] = { ...next[idx], amount: thisAmt, percent: thisPct, pctMode: 'percent' };
      }

      // กันเศษสตางค์
      const diff = money(total - sumAmounts(next));
      if (diff !== 0) {
        const lastIdx = others[others.length - 1];
        const cur = money(toNumber(next[lastIdx].amount, 0));
        const newAmt = money(cur + diff);
        const newPct = total > 0 ? clampPercentNum((newAmt / total) * 100) : 0;
        next[lastIdx] = { ...next[lastIdx], amount: newAmt, percent: newPct, pctMode: 'percent' };
      }

      return next;
    });
  };

  // ✅ ถ้า Total เปลี่ยน (เช่น OCR เติม total) ให้คำนวณตาม mode + หารเท่าให้คนที่เหลือ
  useEffect(() => {
    if (splitType !== 'percentage') return;
    const total = getTotalNumber();
    if (total <= 0) return;

    setParticipants((prev) => {
      const selectableIndices: number[] = [];
      for (let i = 0; i < prev.length; i++) {
        if (isSelectableParticipant(prev[i])) selectableIndices.push(i);
      }
      if (selectableIndices.length === 0) return prev;

      // คำนวณ amount ตาม mode ปัจจุบันของแต่ละคน
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

      // ถ้าไม่มีใครกำหนดค่า (ทุกคน % = 0) → หารเท่ากัน
      const hasAnyValue = selectableIndices.some((i) => {
        const p = next[i];
        return (typeof p.percent === 'number' && p.percent > 0) || money(toNumber(p.amount, 0)) > 0;
      });

      if (!hasAnyValue) {
        const eachPct = round2(100 / selectableIndices.length);
        const eachAmt = money(total / selectableIndices.length);
        for (let i = 0; i < selectableIndices.length; i++) {
          const idx = selectableIndices[i];
          if (i < selectableIndices.length - 1) {
            next[idx] = { ...next[idx], percent: eachPct, amount: eachAmt, pctMode: 'percent' };
          } else {
            const usedPct = eachPct * (selectableIndices.length - 1);
            const usedAmt = eachAmt * (selectableIndices.length - 1);
            next[idx] = {
              ...next[idx],
              percent: clampPercentNum(100 - usedPct),
              amount: money(total - usedAmt),
              pctMode: 'percent',
            };
          }
        }
      } else {
        // balance: กระจายเศษให้คน pctMode !== 'amount' ที่เหลือ
        const fixedIndices = selectableIndices.filter((i) => next[i].pctMode === 'amount');
        const flexIndices = selectableIndices.filter((i) => next[i].pctMode !== 'amount');

        if (flexIndices.length > 0) {
          const fixedSum = money(fixedIndices.reduce((s, i) => s + money(toNumber(next[i].amount, 0)), 0));
          const flexSum = money(flexIndices.reduce((s, i) => s + money(toNumber(next[i].amount, 0)), 0));
          const currentFlexTotal = flexSum;
          const targetFlexTotal = money(total - fixedSum);

          if (currentFlexTotal > 0 && Math.abs(targetFlexTotal - currentFlexTotal) > 0.01) {
            // ปรับสัดส่วน flex ตาม ratio
            const ratio = targetFlexTotal / currentFlexTotal;
            for (const idx of flexIndices) {
              const oldAmt = money(toNumber(next[idx].amount, 0));
              const newAmt = money(oldAmt * ratio);
              const newPct = clampPercentNum((newAmt / total) * 100);
              next[idx] = { ...next[idx], amount: newAmt, percent: newPct, pctMode: 'percent' };
            }
          }

          // กันเศษสตางค์
          const diff = money(total - sumAmounts(next));
          if (diff !== 0) {
            const lastFlex = flexIndices[flexIndices.length - 1];
            const cur = money(toNumber(next[lastFlex].amount, 0));
            const newAmt = money(cur + diff);
            const newPct = clampPercentNum((newAmt / total) * 100);
            next[lastFlex] = { ...next[lastFlex], amount: newAmt, percent: newPct, pctMode: 'percent' };
          }
        }
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
  }, [splitType, totalPrice, itemsTotalForSplit]);

  const handleAmountChange = (e: ChangeEvent<HTMLInputElement>) => {
    const normalized = normalizeMoneyInput(e.target.value);
    if (normalized === '') setTotalPrice('');
    else setTotalPrice(money(Number(normalized)));
  };

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
    return round2(summary.rows.reduce((s, r) => s + r.percent, 0));
  }, [summary.rows]);

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
          joinedAt: matched.joinedAt ?? localRow.joinedAt,
          kind: matched.kind ?? localRow.kind,
          name: String(matched.name ?? localRow.name),
        };
      })
    );
  };

  const syncDraftBill = async (): Promise<{ billId: string; dbParticipants?: DraftDbParticipant[] }> => {
    
    const draftPayload = buildDraftPayload();

    if (!draftBillId) {
      setCreatingDraft(true);
      try {
        const res = await fetch('/api/bills/draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            
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
    

    const res = await fetch(`/api/bills/${billId}`, {
      
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
      if (cleanedParticipantsBase.length <= 1) {
        return alert('ต้องมีผู้เข้าร่วมอย่างน้อย 2 คน ระบบนี้ใช้สำหรับหารบิล');
      }

      const itemsTotal = money(cleanedItems.reduce((sum, it) => sum + it.price, 0));
      const effectiveTotal = typeof totalPrice === 'number' && totalPrice > 0 ? money(totalPrice) : itemsTotal;
      if (!(effectiveTotal > 0)) return alert('ยอดรวมต้องมากกว่า 0 บาท');

      let cleanedParticipants: Array<{
        participantId?: string;
        kind: ParticipantKind;
        userId?: string;
        guestId?: string;
        name: string;
        percent?: number | '';
        amount: number;
      }> = [];
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

      const endpoint = draftBillId ? `/api/bills/${draftBillId}/publish` : '/api/bills';
      const method = draftBillId ? 'PATCH' : 'POST';

      const receiptImageUrl = localStorage.getItem('ocrReceiptImageUrl') || '';
      const receiptImagePublicId = localStorage.getItem('ocrReceiptImagePublicId') || '';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          
        },
        body: JSON.stringify({
          title,
          totalPrice: effectiveTotal,
          splitType,
          participant: cleanedParticipants,
          participants: cleanedParticipants,
          description,
          items: cleanedItems,
          ...(receiptImageUrl ? { receiptImageUrl } : {}),
          ...(receiptImagePublicId ? { receiptImagePublicId } : {}),
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
        localStorage.removeItem('ocrReceiptImageUrl');
        localStorage.removeItem('ocrReceiptImagePublicId');

        const billIdFromResponse = (() => {
          if (!data || typeof data !== 'object') return '';
          const result = data as {
            bill?: { _id?: string };
            billId?: string;
            _id?: string;
          };

          return String(result.bill?._id ?? result.billId ?? result._id ?? '').trim();
        })();

        const targetBillId = billIdFromResponse || draftBillId;
        if (targetBillId) {
          window.location.assign(`/history?billId=${encodeURIComponent(targetBillId)}`);
          return;
        }

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
        <div className="mx-auto max-w-6xl px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg">🍊</span>
            </span>
            <span className="font-semibold">Smart Bill Sharing System</span>
          </div>
        </div>
      </header>

      <div className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl p-4 sm:p-8 relative">
          <h1 className="text-2xl sm:text-3xl font-bold mb-4 text-center text-[#4a4a4a]">
            สร้างบิลใหม่ <span className="block sm:inline text-sm font-normal text-gray-500">({splitTypeLabel})</span>
          </h1>

          <div className="border-dashed border-2 border-gray-300 rounded-xl p-4 sm:p-8 text-center mb-6">
            <p className="text-lg text-[#4a4a4a] mb-2">อัปโหลดรูปบิล หรือ ลากไฟล์มาวาง</p>
            <p className="text-xs text-gray-400 mb-2">รองรับ PNG, JPG ขนาดไม่เกิน 10MB</p>

            {selectedImagePreview ? (
              <div className="mb-4 relative">
                <div className="relative mb-3 h-52 sm:h-64 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white">
                  <Image
                    src={selectedImagePreview}
                    alt="ตัวอย่างรูปบิล"
                    fill
                    unoptimized
                    className="object-contain"
                  />

                  <button
                    type="button"
                    onClick={() => setIsSelectedImageZoomOpen(true)}
                    title="ซูมดูรูป"
                    aria-label="ซูมดูรูป"
                    className="absolute right-2 top-2 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white/95 text-gray-700 shadow-sm transition hover:bg-white"
                  >
                    <MagnifyingGlassPlusIcon className="h-5 w-5" />
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  ไฟล์ที่เลือก: <span className="font-medium">{selectedFileName}</span>
                </p>
              </div>
            ) : (
              <div className="mb-4" />
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptChange} />
            <input ref={directUploadInputRef} type="file" accept="image/*" className="hidden" onChange={handleUploadImageDirectly} />

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={`${btnPrimary} w-full sm:w-auto`}
                disabled={uploading || submitting}
              >
                {uploading ? 'กำลังประมวลผล...' : '🤖 สแกนด้วย OCR'}
              </button>
              <button
                type="button"
                onClick={() => directUploadInputRef.current?.click()}
                className={`${btnSecondary} w-full sm:w-auto`}
                disabled={uploading || submitting}
              >
                {uploading ? 'กำลังประมวลผล...' : '📸 อัปโหลดรูปอย่างเดียว'}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-center mb-6">
            <hr className="w-1/3 border-[#e0e0e0]" />
            <span className="mx-2 text-[#4a4a4a] text-sm">หรือ</span>
            <hr className="w-1/3 border-[#e0e0e0]" />
          </div>

          {/* Bill Title */}
          <div className="mb-4">
            <label className="block mb-1 text-sm text-gray-600">ชื่อบิล</label>
            <input
              type="text"
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="เช่น เลี้ยงข้าวทีมวันศุกร์"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* Items */}
          <div className="mb-4">
            {itemList.map((item, index) => (
              <div key={index} className="mb-4">
                <div className="grid grid-cols-12 gap-3 sm:gap-4">
                  <div className="col-span-12 sm:col-span-6">
                    <label className="block mb-1 text-sm text-gray-600">รายการ</label>
                    <input
                      type="text"
                      className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      placeholder="เช่น ข้าวผัด"
                      value={item.items}
                      onChange={(e) => handleInputChange(index, 'items', e.target.value)}
                    />
                  </div>

                  <div className="col-span-4 sm:col-span-2">
                    <label className="block mb-1 text-sm text-gray-600">จำนวน</label>
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

                  <div className="col-span-8 sm:col-span-4">
                    <label className="block mb-1 text-sm text-gray-600">ราคา</label>
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
                    className={`${itemList.length <= 1 ? btnSecondary : btnDanger} w-full sm:w-auto`}
                  >
                    ลบรายการ
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            onClick={handleAddItems}
            className={`${btnGhost} w-full sm:w-auto`}
            type="button"
          >
            ➕ เพิ่มรายการอาหาร
          </button>

          {/* Participants */}
          <div className="mb-6 mt-6">
            <label className="block mb-1 text-sm font-medium text-gray-700">ผู้เข้าร่วม</label>
            <p className="text-[11px] text-gray-500 mb-2">เพิ่มคนในบิล และสร้างลิงก์เชิญสำหรับ Guest ได้จากที่นี่</p>

            {/* Compact participant list */}
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
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
                  <div key={participant.localId} className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {/* Avatar circle */}
                      <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white ${
                        isOwnerRow ? 'bg-[#fb8c00]' : isGuestSlot ? 'bg-violet-500' : 'bg-slate-400'
                      }`}>
                        {isOwnerRow ? '👑' : isGuestSlot ? 'G' : (index)}
                      </div>

                      {/* Name / select */}
                      <div className="flex-1 min-w-0">
                        {participant.kind === 'user' ? (
                          isOwnerRow ? (
                            <span className="text-sm font-medium text-gray-800 truncate block">
                              {participant.name || 'คุณ'} <span className="text-[10px] text-[#fb8c00] font-normal">(เจ้าของบิล)</span>
                            </span>
                          ) : participant.userId ? (
                            <span className="text-sm text-gray-800 truncate block">{participant.name}</span>
                          ) : (
                            <select
                              className="w-full text-sm border-0 bg-transparent text-gray-800 py-0 focus:outline-none focus:ring-0"
                              value={participant.userId ?? ''}
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
                          )
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm text-gray-800 truncate">{participant.name || 'Guest'}</span>
                            <span className={`text-[9px] px-1.5 py-px rounded-full font-medium ${
                              participant.kind === 'guest'
                                ? 'bg-emerald-50 text-emerald-600'
                                : 'bg-amber-50 text-amber-600'
                            }`}>
                              {participant.kind === 'guest' ? 'เข้าร่วม' : 'รอเชิญ'}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex-shrink-0 flex items-center gap-1">
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
                            className={`h-6 px-2 rounded text-[10px] font-medium whitespace-nowrap transition ${participant.kind !== 'guest_placeholder' ||
                              creatingDraft ||
                              creatingInvite ||
                              submitting
                              ? 'text-slate-400 cursor-not-allowed bg-slate-100'
                              : copiedInviteLocalId === participant.localId
                                ? 'text-green-700 bg-green-50'
                                : inviteLinkByLocalId[participant.localId]
                                  ? 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                                  : 'text-orange-700 bg-orange-50 hover:bg-orange-100'
                              }`}
                          >
                            {copiedInviteLocalId === participant.localId
                              ? '✓ คัดลอก'
                              : inviteLinkByLocalId[participant.localId]
                                ? 'คัดลอกลิงก์'
                                : 'เชิญ'}
                          </button>
                        ) : null}

                        {!isOwnerRow && (
                          <button
                            type="button"
                            onClick={() => {
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
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-rose-400 hover:bg-rose-50 hover:text-rose-600 transition"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 pl-9 pr-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                        <div className="min-w-0">
                          <p className="mb-1 text-xs sm:text-xs font-semibold text-slate-700">เปอร์เซ็นต์ (%)</p>
                          <select
                            disabled={!canEditSplitValue}
                            className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-gray-800 font-medium focus:outline-none focus:ring-2 focus:ring-[#fb8c00] focus:border-[#fb8c00] disabled:bg-gray-100 disabled:text-gray-500 cursor-pointer disabled:cursor-not-allowed transition"
                            value={participant.percent === '' || participant.percent === undefined ? '' : participant.percent}
                            onChange={(e) => setPercentAt(index, e.target.value)}
                          >
                            <option value="">-- เลือก % --</option>
                            {[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => (
                              <option key={v} value={v}>{v}%</option>
                            ))}
                          </select>
                        </div>
                        <div className="min-w-0">
                          <p className="mb-1 text-xs sm:text-xs font-semibold text-slate-700">จำนวนเงิน (บาท)</p>
                          <input
                            type="text"
                            inputMode="decimal"
                            disabled={!canEditSplitValue}
                            className="w-full px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm border border-slate-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00] focus:border-[#fb8c00] disabled:bg-gray-100 disabled:text-gray-500 transition"
                            placeholder="0.00"
                            value={participant.amount === '' ? '' : String(participant.amount)}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setAmountAt(index, e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Action buttons row */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                onClick={handleAddParticipant}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[#fb8c00] bg-orange-50 border border-orange-200 transition hover:bg-orange-100"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" /></svg>
                เพิ่มผู้เข้าร่วม
              </button>

              <button
                onClick={handleAddGuestSlot}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-violet-600 bg-violet-50 border border-violet-200 transition hover:bg-violet-100"
                type="button"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" /></svg>
                เพิ่ม Guest
              </button>

              {draftBillId ? (
                <span className="text-[10px] px-2 py-1 rounded-full bg-orange-50 text-orange-700 border border-orange-200 self-center">
                  ฉบับร่าง
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
            <label className="block mb-1 text-sm text-gray-600">ยอดรวมทั้งหมด</label>
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
            <label className="block mb-1 text-sm text-gray-600">รายละเอียดเพิ่มเติม</label>
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

            <p className={`text-xs mt-1 ${Math.abs(totalPercent - 100) > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
              รวมเปอร์เซ็นต์: {totalPercent}% {Math.abs(totalPercent - 100) > 0.01 ? '(ควรเป็น 100%)' : '✓'}
            </p>
          </div>
          <div className="mb-6">
            <div className="text-center mb-2">
              <p className="text-lg font-semibold text-[#4a4a4a]">สรุปยอดที่ต้องจ่าย</p>
            </div>

            <div className="bg-[#f1f1f1] rounded-2xl p-4 sm:p-5">
              {summary.rows.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">ยังไม่มีผู้เข้าร่วม</p>
              ) : (
                <div className="space-y-2">
                  {summary.rows.map((p) => (
                    <div key={p.key} className="flex items-start sm:items-center justify-between gap-3">
                      <div className="text-[#4a4a4a] min-w-0">
                        {p.name} ({summary.total > 0 ? p.percent.toFixed(0) : '0'}%)
                        <div className="text-xs text-gray-500">
                          {`ตั้งไว้: ${p.percentInput.toFixed(2)}%`}
                        </div>
                      </div>

                      <div className="text-[#4a4a4a] font-semibold whitespace-nowrap">{money(p.amount).toFixed(2)} ฿</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center justify-center mt-4">
            <button
              onClick={handleSubmit}
              disabled={submitting || uploading || creatingDraft || creatingInvite}
              className={`w-full sm:w-72 inline-flex items-center justify-center gap-2 px-3 py-3 font-semibold rounded-full shadow-md transition-all duration-300 ${submitting || uploading || creatingDraft || creatingInvite
                ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                : 'bg-[#fb8c00] text-white hover:bg-[#e65100] hover:shadow-lg'
                }`}
              type="button"
            >
              <CheckCircleIcon className="w-5 h-5 text-white" />
              <span>{submitting || creatingInvite ? 'กำลังบันทึก...' : 'ยืนยันและบันทึกบิล'}</span>
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

      <ImageZoomModal
        isOpen={isSelectedImageZoomOpen}
        imageUrl={selectedImagePreview}
        title={selectedFileName || 'รูปบิล'}
        onClose={() => setIsSelectedImageZoomOpen(false)}
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

