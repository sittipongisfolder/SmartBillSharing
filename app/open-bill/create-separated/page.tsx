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
type ParticipantKind = 'user' | 'guest_placeholder' | 'guest';

type ParticipantRow = {
  localId: string;
  participantId?: string;
  kind: ParticipantKind;
  userId?: string;
  guestId?: string;
  name: string;
  joinedAt?: string;
};

type ItemRow = {
  id: string;
  items: string;
  qty: string;
  price: string; // unit price
  ownerId: string; // participant localId หรือ "__shared__"
  sharedWith: string[];
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

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#fb8c00] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#e65100] hover:shadow-md disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600';

const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50';

const MAX_INT_DIGITS = 6;
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
      : cleaned.slice(0, firstDot + 1) +
        cleaned.slice(firstDot + 1).replace(/\./g, '');

  const [intRaw, decRaw = ''] = noExtraDots.split('.');
  const intPart = (intRaw || '').slice(0, MAX_INT_DIGITS);
  const decPart = (decRaw || '').slice(0, 2);

  if (!intPart && decPart) return `0.${decPart}`;
  if (!decPart) return intPart;
  return `${intPart}.${decPart}`;
};

const toQty = (v: string) => {
  const n = parseInt(v || '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

const toNum = (v: unknown, fallback = 0) => {
  const raw = typeof v === 'number' ? String(v) : String(v ?? '');
  const n = Number(raw.replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

const sanitizeItemText = (raw: string) => {
  return (raw || '')
    .replace(/[^A-Za-z0-9\u0E00-\u0E7F\s()/%&+.,'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function getErrorMessage(data: unknown): string | null {
  if (!isRecord(data)) return null;
  const e = data.error;
  const m = data.message;
  if (typeof e === 'string' && e.trim()) return e;
  if (typeof m === 'string' && m.trim()) return m;
  return null;
}

function getMeByEmail(list: User[], email?: string | null): User | undefined {
  if (!email) return undefined;
  return list.find((u) => u.email === email);
}

function isLocalGuestLike(p: ParticipantRow) {
  return p.kind === 'guest' || p.kind === 'guest_placeholder';
}

function isDraftGuestLike(row: DraftDbParticipant) {
  return row.kind === 'guest' || row.kind === 'guest_placeholder' || !!row.guestId;
}

function getGuestLikeIndexFromLocalRows(rows: ParticipantRow[], localId: string) {
  return rows.filter(isLocalGuestLike).findIndex((row) => row.localId === localId);
}

function findDraftRowForLocalParticipant(
  localRows: ParticipantRow[],
  localRow: ParticipantRow,
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

function isSelectableParticipant(p: ParticipantRow) {
  if (!p.name.trim()) return false;
  if (p.kind === 'user') return !!p.userId;
  return p.kind === 'guest_placeholder' || p.kind === 'guest';
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

  return new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
    type: 'image/jpeg',
  });
}

function CreateBillPersonalPageInner() {
  const searchParams = useSearchParams();
  const typeRaw = searchParams.get('type');
  const splitType: SplitType =
    typeRaw === 'equal' || typeRaw === 'percentage' || typeRaw === 'personal'
      ? typeRaw
      : 'personal';

  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? null;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const directUploadInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([
    { localId: makeId(), kind: 'user', userId: '', name: '' },
  ]);

  const [itemList, setItemList] = useState<ItemRow[]>([
    {
      id: makeId(),
      items: '',
      qty: '1',
      price: '',
      ownerId: '',
      sharedWith: [],
    },
  ]);

  const [description, setDescription] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  const selectedParticipants = useMemo(
    () => participants.filter(isSelectableParticipant),
    [participants]
  );

  const selectedIds = useMemo(
    () => selectedParticipants.map((p) => p.localId),
    [selectedParticipants]
  );

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
      return [...prev, { localId: makeId(), kind: 'user', userId: u._id, name: u.name }];
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
        localId: makeId(),
        kind: 'guest_placeholder',
        name: `Guest ${guestCount + 1}`,
      },
    ]);
  };

  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await fetch('/api/users', { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);

        const list =
          Array.isArray(data)
            ? data
            : isRecord(data) && Array.isArray(data.users)
              ? data.users
              : [];

        const safe = list
          .filter((x) => isRecord(x))
          .map((x) => ({
            _id: String(x._id ?? ''),
            name: String(x.name ?? ''),
            email: String(x.email ?? ''),
          }))
          .filter((x) => x._id && x.name && x.email);

        setUsers(safe);
      } catch (e) {
        console.error('fetchUsers error', e);
        setUsers([]);
      }
    }

    fetchUsers();
  }, []);

  useEffect(() => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;

    setParticipants((prev) => {
      if (prev.length > 0 && prev[0].kind === 'user' && prev[0].userId === me._id) return prev;

      const tail = prev.filter((p, i) => i !== 0 && !(p.kind === 'user' && p.userId === me._id));
      return [{ localId: prev[0]?.localId ?? makeId(), participantId: prev[0]?.participantId, kind: 'user', userId: me._id, name: me.name }, ...tail];
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

  useEffect(() => {
    const validIds = new Set(selectedIds);

    setItemList((prev) =>
      prev.map((it) => {
        if (it.ownerId === '__shared__') {
          const nextSharedWith = (it.sharedWith || []).filter((id) =>
            validIds.has(id)
          );
          return { ...it, sharedWith: nextSharedWith };
        }

        if (!it.ownerId) return it;
        return validIds.has(it.ownerId)
          ? it
          : { ...it, ownerId: '', sharedWith: [] };
      })
    );
  }, [selectedIds]);

  const calc = useMemo(() => {
    const lineTotals = itemList.map((it) => {
      const qty = toQty(it.qty);
      const unit = money(parseFloat(it.price) || 0);
      const lineTotal = money(qty * unit);
      return { ...it, qty, unit, lineTotal };
    });

    const total = money(lineTotals.reduce((s, it) => s + it.lineTotal, 0));
    const validIds = new Set(selectedParticipants.map((p) => p.localId));

    const personalByUser: Record<string, number> = {};
    const sharedByUser: Record<string, number> = {};
    let sharedTotal = 0;

    const unassignedCount = lineTotals.filter((it) => {
      if (!it.items.trim()) return false;
      if (!it.ownerId) return true;
      if (it.ownerId === '__shared__') return (it.sharedWith?.length ?? 0) === 0;
      return false;
    }).length;

    for (const it of lineTotals) {
      if (!it.items.trim()) continue;
      if (!it.ownerId) continue;

      if (it.ownerId === '__shared__') {
        sharedTotal = money(sharedTotal + it.lineTotal);

        const sharersRaw = Array.isArray(it.sharedWith) ? it.sharedWith : [];
        const sharers = sharersRaw.filter((id) => validIds.has(id));
        if (sharers.length === 0) continue;

        const share = money(it.lineTotal / sharers.length);
        for (const uid of sharers) {
          sharedByUser[uid] = money((sharedByUser[uid] || 0) + share);
        }
        continue;
      }

      if (validIds.has(it.ownerId)) {
        personalByUser[it.ownerId] = money(
          (personalByUser[it.ownerId] || 0) + it.lineTotal
        );
      }
    }

    const perParticipant = selectedParticipants.map((p) => {
      const personal = personalByUser[p.localId] || 0;
      const shared = sharedByUser[p.localId] || 0;
      const amount = money(personal + shared);
      const percent = total > 0 ? (amount / total) * 100 : 0;
      return { ...p, personal, shared, amount, percent };
    });

    const sumAmt = money(perParticipant.reduce((s, p) => s + p.amount, 0));
    const diff = money(total - sumAmt);

    if (perParticipant.length > 0 && diff !== 0) {
      perParticipant[perParticipant.length - 1] = {
        ...perParticipant[perParticipant.length - 1],
        amount: money(
          perParticipant[perParticipant.length - 1].amount + diff
        ),
      };
    }

    return { total, sharedTotal, perParticipant, lineTotals, unassignedCount };
  }, [itemList, selectedParticipants]);

  const handleAddParticipant = () => {
    setIsAddParticipantOpen((v) => !v);
  };

  const handleRemoveParticipant = (index: number) => {
    const target = participants[index];
    if (!target) return;

    const isOwnerRow = Boolean(
      index === 0 &&
      target.kind === 'user' &&
      target.userId &&
      users.find((u) => u.email === currentUserEmail)?._id === target.userId
    );

    if (isOwnerRow) return;

    setParticipants((prev) =>
      prev.length > 1 ? prev.filter((p) => p.localId !== target.localId) : prev
    );
    setInviteLinkByLocalId((prev) => {
      const next = { ...prev };
      delete next[target.localId];
      return next;
    });
    setCopiedInviteLocalId((prev) => (prev === target.localId ? null : prev));
  };

  const handleAddItem = () => {
    setItemList((prev) => [
      ...prev,
      {
        id: makeId(),
        items: '',
        qty: '1',
        price: '',
        ownerId: '',
        sharedWith: [],
      },
    ]);
  };

  const handleRemoveItem = (id: string) => {
    setItemList((prev) =>
      prev.length > 1 ? prev.filter((x) => x.id !== id) : prev
    );
  };

  const handleItemChange = <K extends keyof Omit<ItemRow, 'id'>>(
    id: string,
    field: K,
    value: Omit<ItemRow, 'id'>[K]
  ) => {
    setItemList((prev) =>
      prev.map((it) => (it.id === id ? { ...it, [field]: value } : it))
    );
  };

  const handleOwnerChange = (id: string, ownerId: string) => {
    setItemList((prev) =>
      prev.map((it) => {
        if (it.id !== id) return it;

        if (ownerId === '__shared__') {
          const already = Array.isArray(it.sharedWith) ? it.sharedWith : [];
          const nextSharedWith = already.length > 0 ? already : selectedIds;
          return { ...it, ownerId, sharedWith: nextSharedWith };
        }

        return { ...it, ownerId, sharedWith: [] };
      })
    );
  };

  const toggleSharedWith = (itemId: string, userId: string) => {
    setItemList((prev) =>
      prev.map((it) => {
        if (it.id !== itemId) return it;
        if (it.ownerId !== '__shared__') return it;

        const cur = Array.isArray(it.sharedWith) ? it.sharedWith : [];
        const has = cur.includes(userId);
        const next = has ? cur.filter((x) => x !== userId) : [...cur, userId];
        return { ...it, sharedWith: next };
      })
    );
  };

  const sharedSelectAll = (itemId: string) => {
    setItemList((prev) =>
      prev.map((it) =>
        it.id === itemId && it.ownerId === '__shared__'
          ? { ...it, sharedWith: selectedIds }
          : it
      )
    );
  };

  const sharedClearAll = (itemId: string) => {
    setItemList((prev) =>
      prev.map((it) =>
        it.id === itemId && it.ownerId === '__shared__'
          ? { ...it, sharedWith: [] }
          : it
      )
    );
  };

  const assignUnassignedToMe = () => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;

    const myParticipant = participants.find(
      (p) => p.kind === 'user' && p.userId === me._id
    );
    if (!myParticipant) return;

    setItemList((prev) =>
      prev.map((it) =>
        !it.ownerId && it.items.trim()
          ? { ...it, ownerId: myParticipant.localId, sharedWith: [] }
          : it
      )
    );
  };

  const assignAllShared = () => {
    setItemList((prev) =>
      prev.map((it) => {
        if (!it.items.trim()) return it;
        return { ...it, ownerId: '__shared__', sharedWith: selectedIds };
      })
    );
  };

  const resetForm = () => {
    const me = getMeByEmail(users, currentUserEmail);

    setTitle('');
    setDescription('');
    setSelectedFileName('');
    setSelectedImagePreview(null);
    setUploading(false);
    setSubmitting(false);
    setIsAddParticipantOpen(false);
    setDraftBillId('');
    setInviteLinkByLocalId({});
    setCopiedInviteLocalId(null);
    setCreatingDraft(false);
    setCreatingInvite(false);

    setParticipants(
      me ? [{ localId: makeId(), kind: 'user', userId: me._id, name: me.name }] : [{ localId: makeId(), kind: 'user', userId: '', name: '' }]
    );

    setItemList([
      {
        id: makeId(),
        items: '',
        qty: '1',
        price: '',
        ownerId: '',
        sharedWith: [],
      },
    ]);

    if (fileInputRef.current) fileInputRef.current.value = '';
    if (directUploadInputRef.current) directUploadInputRef.current.value = '';
  };

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
          credentials: 'include',
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
            `OCR ไม่สำเร็จ: ${data.ok === false ? data.error || 'Unknown error' : `HTTP ${res.status}`}`
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
      let receiptImageUrl = '';
      let receiptImagePublicId = '';

      // ✅ Upload receipt image to Cloudinary if file exists
      if (ocrImageFile) {
        try {
          const fd = new FormData();
          fd.append('file', ocrImageFile);

          const uploadRes = await fetch('/api/ocr/upload-receipt', {
            method: 'POST',
            credentials: 'include',
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
      const defaultOwner =
        participants[0]?.localId ||
        '';

      const mappedFromParsed: ItemRow[] = previewData.items
        .map((it) => {
          const name = sanitizeItemText(String(it?.name ?? '').trim());
          if (!name) return null;

          const qtyNum = toQty(String(it?.qty ?? '1'));
          const unitPrice = money(toNum(it?.unit_price, 0));

          return {
            id: makeId(),
            items: name,
            qty: String(qtyNum),
            price: unitPrice.toFixed(2),
            ownerId: defaultOwner,
            sharedWith: [] as string[],
          };
        })
        .filter((x): x is ItemRow => x !== null);

      // ✅ Fallback parsing if items are empty
      let finalItems: ItemRow[] = [...mappedFromParsed];
      if (finalItems.length === 0 && rawText) {
        const lines = rawText.split(/\r?\n/).filter((l) => l.trim());
        finalItems = [];

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
          const name = sanitizeItemText(nameRaw.trim());
          if (name.length < 2) continue;

          const qty = parseInt(qtyRaw, 10);
          const price = parseFloat(priceRaw.replace(/,/g, ''));

          if (qty <= 0 || price <= 0 || !Number.isFinite(price)) continue;

          finalItems.push({
            id: makeId(),
            items: name.slice(0, 100),
            qty: String(qty),
            price: price.toFixed(2),
            ownerId: defaultOwner,
            sharedWith: [] as string[],
          });
        }
      }

      // ✅ Set items
      if (finalItems.length > 0) {
        setItemList(finalItems);
      } else {
        setItemList([
          {
            id: makeId(),
            items: '',
            qty: '1',
            price: '',
            ownerId: '',
            sharedWith: [],
          },
        ]);
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

  const buildDraftPayload = () => {
    const cleanedItems = itemList
      .map((it) => {
        const name = (it.items || '').trim();
        if (!name) return null;

        const qty = toQty(it.qty);
        const unitPrice = money(toNum(it.price, 0));
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
          x
        ): x is { items: string; qty: number; unit_price: number; price: number; line_total: number } => x !== null
      );

    const cleanedParticipants = participants
      .filter(isSelectableParticipant)
      .map((p) => ({
        participantId: p.participantId,
        kind: p.kind,
        userId: p.userId,
        guestId: p.guestId,
        name: p.name.trim(),
        amount: money(
          calc.perParticipant.find((row) => row.localId === p.localId)?.amount ?? 0
        ),
      }));

    return {
      title: title.trim(),
      totalPrice: money(calc.total),
      splitType: 'personal' as const,
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
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
      credentials: 'include',
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
        if (rows.length > 0) syncParticipantsFromDraft(rows);
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
    localTarget: ParticipantRow,
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
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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

  const formatSharedNames = (ids: string[]) => {
    const names = ids
      .map((id) => selectedParticipants.find((p) => p.localId === id)?.name)
      .filter(Boolean) as string[];

    if (names.length === 0) return 'Shared';
    if (names.length <= 3) return names.join(',');
    return `${names.slice(0, 3).join(',')}+${names.length - 3}`;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      if (!title.trim()) {
        alert('กรุณากรอก Bill Title');
        return;
      }

      if (selectedParticipants.length === 0) {
        alert('กรุณาเลือก Participants อย่างน้อย 1 คน');
        return;
      }

      if (calc.total <= 0) {
        alert('ยอดรวมต้องมากกว่า 0');
        return;
      }

      if (calc.unassignedCount > 0) {
        alert(
          `มี ${calc.unassignedCount} รายการที่ยังไม่ครบ (ยังไม่เลือก Owner หรือยังไม่เลือกคนหารใน Shared)`
        );
        return;
      }

      const cleanedItems = calc.lineTotals
        .map((it) => {
          const name = it.items.trim();
          if (!name) return null;

          const tag =
            it.ownerId === '__shared__'
              ? `[Shared:${formatSharedNames(it.sharedWith || [])}]`
              : it.ownerId
                ? `[${selectedParticipants.find((p) => p.localId === it.ownerId)?.name || 'Owner'}]`
                : '';

          const displayName = `${tag} ${name}`.trim();

          return {
            items: displayName,
            qty: it.qty,
            unit_price: money(it.unit),
            price: money(it.lineTotal),
            line_total: money(it.lineTotal),
            ownerId: it.ownerId,
            sharedWith:
              it.ownerId === '__shared__' ? (it.sharedWith || []) : [],
          };
        })
        .filter(
          (
            x
          ): x is {
            items: string;
            qty: number;
            unit_price: number;
            price: number;
            line_total: number;
            ownerId: string;
            sharedWith: string[];
          } => x !== null
        );

      const cleanedParticipants = calc.perParticipant.map((p) => ({
        participantId: p.participantId,
        kind: p.kind,
        userId: p.userId,
        guestId: p.guestId,
        name: p.name,
        amount: money(p.amount),
      }));

      const endpoint = draftBillId ? `/api/bills/${draftBillId}/publish` : '/api/bills';
      const method = draftBillId ? 'PATCH' : 'POST';

      const res = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          totalPrice: money(calc.total),
          splitType: 'personal',
          participant: cleanedParticipants,
          participants: cleanedParticipants,
          description,
          items: cleanedItems,
        }),
      });

      const rawText = await res.text();
      let data: unknown = {};

      try {
        data = JSON.parse(rawText) as unknown;
      } catch {
        data = { error: rawText };
      }

      if (res.ok) {
        alert(draftBillId ? 'เปิดบิลสำเร็จ!' : 'สร้างบิลสำเร็จ!');
        resetForm();
      } else {
        console.log('CREATE BILL ERROR:', res.status, data);
        const msg = getErrorMessage(data) || 'Bad Request';
        alert(`สร้างบิลไม่สำเร็จ: ${msg}`);
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
        <div className="w-full max-w-150 bg-white rounded-2xl shadow-xl p-8 relative">
          <h1 className="text-3xl font-bold mb-4 text-center text-[#4a4a4a]">
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

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReceiptChange}
            />
            <input
              ref={directUploadInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleUploadImageDirectly}
            />

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

          <div className="mb-2">
            <div className="mt-3 grid grid-cols-12 gap-3 text-xs text-gray-500">
              <div className="col-span-4">Items</div>
              <div className="col-span-2">Qty</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-4">Owner</div>
            </div>

            {itemList.map((it) => (
              <div key={it.id} className="mt-2">
                <div className="grid grid-cols-12 gap-3 items-center">
                  <div className="col-span-4">
                    <input
                      type="text"
                      className="w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      placeholder="e.g., Fried rice"
                      value={it.items}
                      onChange={(e) =>
                        handleItemChange(it.id, 'items', e.target.value)
                      }
                    />
                  </div>

                  <div className="col-span-2">
                    <input
                      type="number"
                      min={1}
                      step={1}
                      inputMode="numeric"
                      className="w-full p-3 border text-gray-800 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      value={it.qty}
                      onChange={(e) =>
                        handleItemChange(it.id, 'qty', e.target.value)
                      }
                    />
                  </div>

                  <div className="col-span-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full p-3 border text-gray-800 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00] text-right tabular-nums"
                      value={it.price}
                      placeholder="0.00"
                      title="สูงสุด 999999.99"
                      onChange={(e) =>
                        handleItemChange(
                          it.id,
                          'price',
                          normalizeMoneyInput(e.target.value)
                        )
                      }
                    />
                  </div>

                  <div className="col-span-4 flex flex-col sm:flex-row gap-2 min-w-0">
                    <select
                      className="min-w-0 w-full sm:w-auto flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                      value={it.ownerId}
                      onChange={(e) => handleOwnerChange(it.id, e.target.value)}
                    >
                      <option value="">-- เลือก --</option>
                      <option value="__shared__">Shared</option>
                      {selectedParticipants.map((p) => (
                        <option key={p.localId} value={p.localId}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {it.ownerId === '__shared__' && selectedParticipants.length > 0 && (
                  <div className="mt-2 ml-1 rounded-xl bg-white border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="text-xs text-gray-600">เลือกคนที่หารร่วมกัน</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => sharedSelectAll(it.id)}
                          className="text-xs px-3 py-1 rounded-lg border border-gray-300 hover:bg-gray-50"
                        >
                          เลือกทั้งหมด
                        </button>
                        <button
                          type="button"
                          onClick={() => sharedClearAll(it.id)}
                          className="text-xs px-3 py-1 rounded-lg border border-gray-300 hover:bg-gray-50"
                        >
                          ล้าง
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {selectedParticipants.map((p) => {
                        const checked = (it.sharedWith || []).includes(p.localId);
                        return (
                          <button
                            key={p.localId}
                            type="button"
                            onClick={() => toggleSharedWith(it.id, p.localId)}
                            className={`text-xs px-3 py-1 rounded-full border transition ${
                              checked
                                ? 'border-[#fb8c00] bg-[#fb8c00]/10 text-[#e65100]'
                                : 'border-gray-300 hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            {p.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(it.id)}
                    disabled={itemList.length <= 1}
                    className={`px-4 py-2 rounded-lg text-sm border transition ${
                      itemList.length <= 1
                        ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
                        : 'border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400'
                    }`}
                  >
                    ลบรายการ
                  </button>
                </div>
              </div>
            ))}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAddItem}
                className="text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
              >
                ➕ เพิ่มรายการอาหาร
              </button>

              <button
                type="button"
                onClick={assignUnassignedToMe}
                className="text-sm text-gray-700 font-medium hover:text-gray-900"
              >
                Assign ช่องว่างให้ฉัน
              </button>

              <button
                type="button"
                onClick={assignAllShared}
                className="text-sm text-gray-700 font-medium hover:text-gray-900"
              >
                ตั้งทุกช่องเป็น Shared
              </button>
            </div>

            <p className="mt-2 text-xs text-gray-400">
              * รายการ Owner/Shared จะอ้างอิงจาก Participants ที่เลือกไว้ (อยู่ด้านล่าง)
            </p>
          </div>

          <div className="mb-6 mt-6">
            <label className="block mb-1 text-sm text-gray-600">Participants</label>

            <div className="space-y-3">
              {participants.map((p, index) => {
                const isOwnerRow = Boolean(
                  index === 0 &&
                  p.kind === 'user' &&
                  p.userId &&
                  users.find((u) => u.email === currentUserEmail)?._id === p.userId
                );
                const isGuestSlot = p.kind === 'guest_placeholder' || p.kind === 'guest';

                return (
                  <div key={p.localId} className="flex gap-2 items-center">
                    {p.kind === 'user' ? (
                      <select
                        className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                        value={p.userId ?? ''}
                        disabled={isOwnerRow}
                        onChange={(e) => {
                          const id = e.target.value;
                          const u = users.find((x) => x._id === id);
                          setParticipants((prev) =>
                            prev.map((row) =>
                              row.localId === p.localId
                                ? { ...row, userId: id, name: u?.name || '' }
                                : row
                            )
                          );
                        }}
                      >
                        <option value="">-- เลือกผู้ใช้ --</option>
                        {users
                          .filter(
                            (u) =>
                              !participants.some(
                                (x) =>
                                  x.localId !== p.localId &&
                                  x.kind === 'user' &&
                                  x.userId === u._id
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
                          <span className="font-medium">{p.name}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">
                            {p.kind === 'guest' ? 'Guest joined' : 'Guest slot'}
                          </span>
                        </div>
                      </div>
                    )}

                    {isGuestSlot ? (
                      <button
                        type="button"
                        disabled={
                          p.kind !== 'guest_placeholder' || creatingDraft || creatingInvite || submitting
                        }
                        onClick={() => handleCreateInvite(p.localId)}
                        className={`px-3 py-2 rounded-lg text-sm border ${
                          p.kind !== 'guest_placeholder' || creatingDraft || creatingInvite || submitting
                            ? 'border-gray-200 text-gray-400 cursor-not-allowed bg-gray-50'
                            : copiedInviteLocalId === p.localId
                              ? 'border-green-300 text-green-700 bg-green-50'
                              : inviteLinkByLocalId[p.localId]
                                ? 'border-blue-300 text-blue-700 hover:bg-blue-50'
                                : 'border-orange-300 text-orange-700 hover:bg-orange-50'
                        }`}
                      >
                        {copiedInviteLocalId === p.localId
                          ? '✅ คัดลอกแล้ว'
                          : inviteLinkByLocalId[p.localId]
                            ? '📋 คัดลอกลิงก์'
                            : '🔗 เชิญ'}
                      </button>
                    ) : null}

                    <button
                      type="button"
                      disabled={isOwnerRow}
                      onClick={() => handleRemoveParticipant(index)}
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

          <div className="mb-6 mt-6">
            <label className="block mb-1 text-sm text-gray-600">Description</label>
            <textarea
              rows={3}
              className="w-full p-3 border text-gray-800 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00] resize-none"
              placeholder="....."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="mb-4 text-center">
            <p className="text-lg text-[#4a4a4a]">รวมทั้งหมด</p>
            <p className="text-2xl font-semibold text-[#fb8c00]">
              {money(calc.total).toFixed(2)} ฿
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Shared รวม: {money(calc.sharedTotal).toFixed(2)} ฿
            </p>
          </div>

          <div className="mb-6">
            <div className="text-center mb-2">
              <p className="text-lg font-semibold text-[#4a4a4a]">
                สรุปยอดที่ต้องจ่าย
              </p>
            </div>

            <div className="bg-[#f1f1f1] rounded-2xl p-5">
              {calc.perParticipant.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">
                  ยังไม่มีผู้เข้าร่วม
                </p>
              ) : (
                <div className="space-y-2">
                  {calc.perParticipant.map((p) => (
                    <div key={p.localId} className="flex items-center justify-between">
                      <div className="text-[#4a4a4a]">
                        {p.name} ({calc.total > 0 ? p.percent.toFixed(0) : '0'}%)
                        <div className="text-xs text-gray-500">
                          ของตัวเอง: {money(p.personal).toFixed(2)} ฿ + Shared ที่โดนหาร:{' '}
                          {money(p.shared).toFixed(2)} ฿
                        </div>
                      </div>
                      <div className="text-[#4a4a4a] font-semibold">
                        {money(p.amount).toFixed(2)} ฿
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {calc.unassignedCount > 0 && (
              <p className="mt-2 text-xs text-red-500">
                ยังมี {calc.unassignedCount}{' '}
                รายการที่ยังไม่ครบ (ยังไม่เลือก Owner หรือยังไม่เลือกคนหารใน Shared)
              </p>
            )}
          </div>

          <div className="flex items-center justify-center mt-4">
            <button
              onClick={handleSubmit}
              disabled={submitting || uploading}
              className={`w-70 inline-flex items-center justify-center gap-2 px-3 py-3 font-semibold rounded-full shadow-md transition-all duration-300 ${
                submitting || uploading
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

export default function CreatePersonalPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <CreateBillPersonalPageInner />
    </Suspense>
  );
}