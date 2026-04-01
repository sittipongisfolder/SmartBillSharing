'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useSession } from 'next-auth/react';
import { OcrPreviewModal, type OcrPreviewAcceptPayload } from '@/components/OcrPreviewModal';
import { useOcrPreview } from '@/lib/useOcrPreview';
import { AddParticipantDropdown } from '@/components/AddParticipantDropdown';
import Image from 'next/image';


interface User {
  _id: string;
  name: string;
  email: string;
}

type ParticipantKind = 'user' | 'guest_placeholder' | 'guest';

interface Participant {
  localId: string;
  participantId?: string;
  kind: ParticipantKind;
  userId?: string;
  guestId?: string;
  name: string;
  percent?: number | '';
  amount: number | '';
  joinedAt?: string;
}

type SplitType = 'equal' | 'percentage' | 'personal';

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



type ItemRow = { items: string; qty: string; price: string };

type SummaryRow = {
  key: string;
  userId?: string;
  name: string;
  amount: number;
  percent: number;
  percentInput: number;
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

const MAX_MONEY = 999999.99;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clampMoney = (n: number) => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > MAX_MONEY) return MAX_MONEY;
  return n;
};
const money = (n: number) => clampMoney(round2(n));

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

function CreateBillPageInner() {
  const searchParams = useSearchParams();
  const splitTypeRaw = searchParams.get('type');
  const splitType = (splitTypeRaw as SplitType) || 'equal';
  const splitTypeLabel =
    splitType === 'equal'
      ? 'หารเท่ากัน'
      : splitType === 'percentage'
        ? 'หารตามเปอร์เซ็นต์'
        : 'หารตามรายการ';

  const [title, setTitle] = useState('');
  const [totalPrice, setTotalPrice] = useState<number | ''>('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<Participant[]>([
    {
      localId: makeLocalId(),
      kind: 'user',
      userId: '',
      name: '',
      percent: '',
      amount: 0,
    },
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

      return [
        ...prev,
        {
          localId: makeLocalId(),
          kind: 'user',
          userId: u._id,
          name: u.name,
          percent: '',
          amount: 0,
        },
      ];
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
      },
    ]);
  };

  const isFiniteNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

  const toNumber = (v: unknown, fallback = 0) => {
    const s = typeof v === 'number' ? String(v) : String(v ?? '');
    const n = Number(s.replace(/,/g, ''));
    return Number.isFinite(n) ? n : fallback;
  };

  function getMeByEmail(list: User[], email?: string | null): User | undefined {
    if (!email) return undefined;
    return list.find((u) => u.email === email);
  }

  const selectedParticipants = useMemo(
    () =>
      participants.filter((p) => {
        if (!p.name.trim()) return false;
        if (p.kind === 'user') return !!p.userId;
        return p.kind === 'guest_placeholder' || p.kind === 'guest';
      }),
    [participants]
  );

  const selectedCount = selectedParticipants.length;

  useEffect(() => {
    async function fetchUsers() {
      
      const res = await fetch('/api/users', {
        
      });
      const data = await res.json();
      setUsers(data);
    }
    fetchUsers();
  }, []);

  useEffect(() => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;

    setParticipants((prev) => {
      if (
        prev.length > 0 &&
        prev[0].kind === 'user' &&
        prev[0].userId === me._id
      ) {
        return prev;
      }

      const headAmount = prev[0]?.amount ?? 0;
      const tail = prev.filter((p, idx) => {
        if (idx === 0) return false;
        return !(p.kind === 'user' && p.userId === me._id);
      });

      return [
        {
          localId: prev[0]?.localId ?? makeLocalId(),
          participantId: prev[0]?.participantId,
          kind: 'user',
          userId: me._id,
          name: me.name,
          percent: '',
          amount: headAmount,
        },
        ...tail,
      ];
    });
  }, [users, currentUserEmail]);

  async function compressImage(file: File, maxW = 1600, quality = 0.85): Promise<File> {
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

    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', quality)
    );

    return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' });
  }

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

  const handleReceiptChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (!picked) return;
    localStorage.removeItem('ocrReceiptImageUrl');
    localStorage.removeItem('ocrReceiptImagePublicId');
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

        console.log('[DEBUG] OCR response received, opening preview modal');

        // ✅ Create image preview from file (using URL.createObjectURL for speed)
        const imagePreviewUrl = URL.createObjectURL(compressed);

        // ✅ Display preview in upload area immediately
        setSelectedImagePreview(imagePreviewUrl);
        console.log('[DEBUG] Image preview set:', imagePreviewUrl);

        // ✅ Map OCR items
        const mappedItems = Array.isArray(parsed.items) ? parsed.items : [];
        console.log('[DEBUG] Mapped items:', mappedItems.length);

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
        console.log('[DEBUG] OCR preview modal opened and image file stored');
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


      const rawText = accepted.rawText || '';

      // ✅ Set title from selected OCR payload
      const ocrTitle = accepted.title?.trim();
      if (ocrTitle) {
        setTitle((prev) => (prev.trim() ? prev : ocrTitle));
      }

      // ✅ Set description from raw_text
      if (rawText) {
        setDescription(rawText);
      }

      // ✅ ใช้เฉพาะรายการที่ user ติ๊กเลือกจาก modal
      const mappedFromSelected: ItemRow[] = accepted.selectedItems
        .map((it) => {
          const name = String(it?.name ?? '').trim();
          if (!name) return null;

          const qtyNum = Math.max(1, it.qty || 1);
          const unit = money(it.unit_price || 0);

          return {
            items: name,
            qty: String(qtyNum),
            price: unit.toFixed(2),
          };
        })
        .filter((x): x is ItemRow => x !== null);

      // ✅ fallback: ถ้าไม่มี selected items แต่ raw_text มีอยู่ ให้ลอง parse แบบเดิม
      let finalItems = mappedFromSelected;

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

      // ✅ Set items ลงหน้า open bill
      if (finalItems.length > 0) {
        setItemList(finalItems);
      } else {
        setItemList([{ items: '', qty: '1', price: '' }]);
      }

      // ✅ ใช้ total จากรายการที่ติ๊กเลือก
      const totalFromSelected = money(accepted.selectedTotal || 0);

      if (totalFromSelected > 0) {
        setTotalPrice(totalFromSelected);
      } else {
        const sumFromItems = finalItems.reduce((sum, it) => {
          const unitPrice = money(parseFloat(it.price) || 0);
          const qty = Math.max(1, parseInt(it.qty || '1', 10) || 1);
          return sum + unitPrice * qty;
        }, 0);

        setTotalPrice(sumFromItems > 0 ? money(sumFromItems) : '');
      }

      ocrPreview.closePreview();
      setOcrImageFile(null);

      // อัปโหลดรูปบิลแบบเบื้องหลัง เพื่อให้ปุ่มตอบสนองทันที
      if (pendingImageFile && !localStorage.getItem('ocrReceiptImageUrl')) {
        void (async () => {
          try {
            const fd = new FormData();
            fd.append('file', pendingImageFile);
            if (draftBillId) {
              fd.append('billId', draftBillId);
            }

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

  const onRejectOcr = async () => {
    const keepReceiptImage = window.confirm(
      'ไม่ใช้ข้อมูล OCR ใช่ไหม?\n\nกด OK = เก็บรูปบิลไว้สำหรับแนบตอนบันทึกบิล\nกด Cancel = ล้างรูปและข้อมูล OCR ทั้งหมด'
    );

    ocrPreview.closePreview();

    if (keepReceiptImage) {
      return;
    }

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
        ? [
          {
            localId: makeLocalId(),
            kind: 'user',
            userId: me._id,
            name: me.name,
            percent: '',
            amount: 0,
          },
        ]
        : [
          {
            localId: makeLocalId(),
            kind: 'user',
            userId: '',
            name: '',
            percent: '',
            amount: 0,
          },
        ]
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

    localStorage.removeItem('ocrReceiptImageUrl');
    localStorage.removeItem('ocrReceiptImagePublicId');

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

      const totalAmount = next.reduce((sum, it) => {
        const unitPrice = money(toNumber(it.price, 0));
        const qty = Math.max(1, parseInt(it.qty || '1', 10) || 1);
        return sum + unitPrice * qty;
      }, 0);

      setTotalPrice(money(totalAmount));
      return next;
    });
  };

  const handleInputChange = (index: number, field: 'items' | 'qty' | 'price', value: string) => {
    const updated = [...itemList];
    const nextValue = field === 'price' ? normalizeMoneyInput(value) : value;

    updated[index] = { ...updated[index], [field]: nextValue };

    const totalAmount = updated.reduce((sum, it) => {
      const unitPrice = money(toNumber(it.price, 0));
      const qty = Math.max(1, parseInt(it.qty || '1', 10) || 1);
      return sum + unitPrice * qty;
    }, 0);

    setItemList(updated);
    setTotalPrice(money(totalAmount));
  };

  useEffect(() => {
    if (splitType !== 'equal') {
      setSharePerPerson(0);
      return;
    }

    const t = typeof totalPrice === 'number' ? money(totalPrice) : 0;

    if (t > 0 && selectedCount > 0) {
      const share = money(t / selectedCount);
      setSharePerPerson(share);
      setParticipants((prev) =>
        prev.map((p) => {
          const isSelected =
            (p.kind === 'user' && !!p.userId) ||
            p.kind === 'guest_placeholder' ||
            p.kind === 'guest';

          return isSelected ? { ...p, amount: share } : { ...p, amount: 0 };
        })
      );
    } else {
      setSharePerPerson(0);
      setParticipants((prev) => prev.map((p) => ({ ...p, amount: 0 })));
    }
  }, [splitType, totalPrice, selectedCount]);

  const percentKey = useMemo(
    () => participants.map((p) => (p.percent === '' ? '' : String(p.percent))).join('|'),
    [participants]
  );

  const totalPercent = useMemo(() => {
    return round2(
      selectedParticipants.reduce((sum, p) => sum + (isFiniteNumber(p.percent) ? p.percent : 0), 0)
    );
  }, [selectedParticipants]);

  useEffect(() => {
    if (splitType !== 'percentage') return;

    const t = typeof totalPrice === 'number' ? money(totalPrice) : 0;
    if (t <= 0) {
      setParticipants((prev) => prev.map((p) => ({ ...p, amount: 0 })));
      return;
    }

    setParticipants((prev) => {
      const next = prev.map((p) => {
        if (p.kind !== 'user' || !p.userId) return { ...p, amount: 0 };
        const pct = isFiniteNumber(p.percent) ? p.percent : 0;
        return { ...p, amount: money((t * pct) / 100) };
      });

      const sumAmt = money(next.reduce((s, p) => s + money(toNumber(p.amount, 0)), 0));
      const diff = money(t - sumAmt);

      if (diff !== 0) {
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].kind === 'user' && next[i].userId) {
            next[i] = { ...next[i], amount: money(money(toNumber(next[i].amount, 0)) + diff) };
            break;
          }
        }
      }

      const same = prev.every((p, i) => p.amount === next[i].amount);
      return same ? prev : next;
    });
  }, [splitType, totalPrice, percentKey, participants.length]);

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
      const amount = money(toNumber(p.amount, 0));
      const percent = total > 0 ? (amount / total) * 100 : 0;
      const percentInput = round2(toNumber(p.percent, 0));

      return {
        key: p.participantId || p.localId,
        userId: p.userId,
        name: p.name,
        amount,
        percent,
        percentInput,
      };
    });

    if (rows.length > 0 && total > 0) {
      const sumAmt = money(rows.reduce((s, r) => s + r.amount, 0));
      const diff = money(total - sumAmt);
      if (diff !== 0) {
        const last = rows.length - 1;
        const nextAmt = money(rows[last].amount + diff);
        rows[last] = {
          ...rows[last],
          amount: nextAmt,
          percent: total > 0 ? (nextAmt / total) * 100 : 0,
        };
      }
    }

    return { total, rows };
  }, [totalPrice, selectedParticipants]);

  const buildDraftPayload = () => {
    const cleanedItems = itemList
      .map((it) => {
        const name = (it.items || '').trim();
        if (!name) return null;

        const qty = Math.max(1, parseInt(it.qty || '1', 10) || 1);
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
      .filter(
        (
          it
        ): it is {
          items: string;
          qty: number;
          unit_price: number;
          price: number;
          line_total: number;
        } => it !== null
      );

    const cleanedParticipants = participants
      .filter((p) => {
        if (!p.name.trim()) return false;
        if (p.kind === 'user') return !!p.userId;
        return p.kind === 'guest_placeholder' || p.kind === 'guest';
      })
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
    const effectiveTotal =
      typeof totalPrice === 'number' && totalPrice > 0 ? money(totalPrice) : itemsTotal;

    // ✅ Get receipt image info from localStorage
    const receiptImageUrl = localStorage.getItem('ocrReceiptImageUrl') || '';
    const receiptImagePublicId = localStorage.getItem('ocrReceiptImagePublicId') || '';

    return {
      title: title.trim(),
      totalPrice: effectiveTotal,
      splitType,
      participants: cleanedParticipants,
      description,
      items: cleanedItems,
      receiptImageUrl: receiptImageUrl || undefined,
      receiptImagePublicId: receiptImagePublicId || undefined,
    };
  };

  const buildSubmitPayload = () => {
    const payload = buildDraftPayload();

    if (!payload.title.trim()) {
      throw new Error('กรุณากรอก Bill Title');
    }
    if (payload.items.length === 0) {
      throw new Error('กรุณาเพิ่มรายการอาหารอย่างน้อย 1 รายการ');
    }
    if (payload.participants.length === 0) {
      throw new Error('กรุณาเลือก Participants อย่างน้อย 1 คน');
    }
    if (!(Number(payload.totalPrice) > 0)) {
      throw new Error('ยอดรวมต้องมากกว่า 0 บาท');
    }

    return payload;
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

  const syncDraftBill = async (): Promise<{
    billId: string;
    dbParticipants?: DraftDbParticipant[];
  }> => {
    
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
          | {
            ok?: boolean;
            bill?: {
              _id?: string;
              participants?: DraftDbParticipant[];
            };
            error?: string;
          }
          | null = null;

        try {
          data = JSON.parse(raw) as typeof data;
        } catch {
          data = { error: raw || `HTTP ${res.status}` };
        }

        if (!res.ok || !data?.bill?._id) {
          console.error('CREATE DRAFT BILL ERROR:', res.status, data);
          throw new Error(data?.error || `บันทึก draft bill ไม่สำเร็จ (HTTP ${res.status})`);
        }

        const newDraftId = String(data.bill._id);
        setDraftBillId(newDraftId);

        if (Array.isArray(data.bill.participants)) {
          syncParticipantsFromDraft(data.bill.participants);
        }

        return {
          billId: newDraftId,
          dbParticipants: data.bill.participants,
        };
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
        | {
          ok?: boolean;
          bill?: {
            _id?: string;
            participants?: DraftDbParticipant[];
          };
          error?: string;
        }
        | null = null;

      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        data = { error: raw || `HTTP ${res.status}` };
      }

      if (!res.ok || !data?.bill?._id) {
        console.error('UPDATE DRAFT BILL ERROR:', res.status, data);
        throw new Error(data?.error || `อัปเดต draft bill ไม่สำเร็จ (HTTP ${res.status})`);
      }

      if (Array.isArray(data.bill.participants)) {
        syncParticipantsFromDraft(data.bill.participants);
      }

      return {
        billId: String(data.bill._id),
        dbParticipants: data.bill.participants,
      };
    } finally {
      setCreatingDraft(false);
    }
  };

  const fetchDraftParticipants = async (billId: string): Promise<DraftDbParticipant[]> => {
    

    const res = await fetch(`/api/bills/${billId}`, {
      
      cache: 'no-store',
    });

    const data = (await res.json().catch(() => null)) as
      | {
        bill?: {
          participants?: DraftDbParticipant[];
        };
        error?: string;
      }
      | null;

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

    // โหลดทันที 1 รอบ
    void syncLatestDraftParticipants();

    // poll ทุก 3 วินาที
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void syncLatestDraftParticipants();
      }
    }, 3000);

    // sync เพิ่มตอน user กลับมาที่ tab นี้
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
          setCopiedInviteLocalId((prev) =>
            prev === participantLocalId ? null : prev
          );
        }, 1500);

        return;
      }

      
      const localTarget = participants.find((p) => p.localId === participantLocalId);

      if (!localTarget) {
        throw new Error('ไม่พบ guest slot');
      }

      if (localTarget.kind !== 'guest_placeholder') {
        throw new Error('สร้างลิงก์ได้เฉพาะ guest slot ที่ยังไม่ถูก claim');
      }

      const { billId, dbParticipants } = await syncDraftBill();

      const participantId = await resolveParticipantIdForInvite(
        billId,
        localTarget,
        dbParticipants
      );

      if (!participantId) {
        throw new Error('ยังไม่ได้ participantId ของ guest slot');
      }

      setCreatingInvite(true);

      const inviteRes = await fetch(`/api/bills/${billId}/invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          
        },
        body: JSON.stringify({
          participantId,
          expiresInDays: 7,
          maxUses: 1,
        }),
      });

      const inviteData = (await inviteRes.json().catch(() => null)) as
        | { invitePath?: string; error?: string }
        | null;

      if (!inviteRes.ok || !inviteData?.invitePath) {
        throw new Error(inviteData?.error || 'สร้างลิงก์เชิญไม่สำเร็จ');
      }

      const fullUrl = `${window.location.origin}${inviteData.invitePath}`;

      setInviteLinkByLocalId((prev) => ({
        ...prev,
        [participantLocalId]: fullUrl,
      }));

      await navigator.clipboard.writeText(fullUrl);
      setCopiedInviteLocalId(participantLocalId);

      window.setTimeout(() => {
        setCopiedInviteLocalId((prev) =>
          prev === participantLocalId ? null : prev
        );
      }, 1500);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      alert(message);
    } finally {
      setCreatingInvite(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting || creatingDraft || creatingInvite) return;
    setSubmitting(true);

    try {
      
      const payload = buildSubmitPayload();

      const endpoint = draftBillId ? `/api/bills/${draftBillId}/publish` : '/api/bills';
      const method = draftBillId ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          
        },
        body: JSON.stringify({
          ...payload,
          participant: payload.participants,
        }),
      });

      const raw = await res.text();
      let data: unknown = {};
      try {
        data = JSON.parse(raw) as unknown;
      } catch {
        data = { error: raw };
      }

      if (!res.ok) {
        console.log('SAVE/PUBLISH BILL ERROR:', res.status, data);
        const d = data as { error?: string; message?: string };
        alert(`บันทึกบิลไม่สำเร็จ: ${d.error || d.message || 'Bad Request'}`);
        return;
      }

      alert(draftBillId ? 'เปิดบิลสำเร็จ!' : 'สร้างบิลสำเร็จ!');

      // ✅ Clear OCR receipt image info
      localStorage.removeItem('ocrReceiptImageUrl');
      localStorage.removeItem('ocrReceiptImagePublicId');

      resetForm();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
      alert(message);
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
                const isGuestSlot =
                  participant.kind === 'guest_placeholder' || participant.kind === 'guest';

                return (
                  <div key={participant.localId} className="flex items-center gap-2 px-3 py-2">
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
                                prev.map((p) =>
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
          </div>

          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">รายละเอียดเพิ่มเติม</label>
            <textarea
              className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="....."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="mb-4 text-center">
            <p className="text-lg text-[#4a4a4a]">รวมทั้งหมด</p>
            <p className="text-2xl font-semibold text-[#fb8c00]">{money(summary.total).toFixed(2)} ฿</p>

            {splitType === 'equal' && (
              <p className="text-xs text-gray-500 mt-1">
                หารเท่ากัน: {selectedCount > 0 ? money(sharePerPerson).toFixed(2) : '0.00'} ฿/คน
              </p>
            )}

            {splitType === 'percentage' && (
              <p
                className={`text-xs mt-1 ${Math.abs(totalPercent - 100) > 0.01 ? 'text-red-500' : 'text-green-600'
                  }`}
              >
                รวมเปอร์เซ็นต์: {totalPercent}%{' '}
                {Math.abs(totalPercent - 100) > 0.01 ? '(ควรเป็น 100%)' : '✓'}
              </p>
            )}

            {splitType === 'personal' && (
              <p
                className={`text-xs mt-1 ${summary.total > 0 && Math.abs(personalSum - summary.total) > 0.01
                  ? 'text-red-500'
                  : 'text-gray-500'
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
                    <div key={p.key} className="flex items-start sm:items-center justify-between gap-3">
                      <div className="text-[#4a4a4a] min-w-0">
                        {p.name} ({summary.total > 0 ? p.percent.toFixed(0) : '0'}%)
                        <div className="text-xs text-gray-500">
                          {splitType === 'equal'
                            ? `หารเท่ากัน: ${selectedCount > 0 ? money(sharePerPerson).toFixed(2) : '0.00'
                            } ฿`
                            : splitType === 'percentage'
                              ? `ตั้งไว้: ${p.percentInput.toFixed(2)}%`
                              : `ใส่เอง: ${money(p.amount).toFixed(2)} ฿`}
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
        rawText={ocrPreview.previewData.rawText ?? ''}
        imagePreview={ocrPreview.imagePreview}
        fileName={ocrPreview.selectedFileName}
        onAccept={onAcceptOcr}
        onReject={onRejectOcr}
        isLoading={ocrPreview.isLoading}
      />
    </div>
  );
}

export default function CreateBillPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <CreateBillPageInner />
    </Suspense>
  );
}

