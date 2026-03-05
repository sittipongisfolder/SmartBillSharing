'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense,useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useSession } from 'next-auth/react';

interface User {
  _id: string;
  name: string;
  email: string;
}

type SplitType = 'equal' | 'percentage' | 'personal';

type ParticipantRow = {
  userId: string;
  name: string;
};

type ItemRow = {
  id: string;
  items: string;
  qty: string; // จำนวน
  price: string; // ราคา/ชิ้น (unit price)
  ownerId: string; // userId หรือ "__shared__"
  sharedWith: string[]; // รายชื่อคนที่ “หารร่วมกัน” เฉพาะรายการที่เป็น Shared
};

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

// ✅ เงื่อนไขใหม่: ไม่เกิน 6 หลัก + ทศนิยม 2 ตำแหน่ง
const MAX_INT_DIGITS = 6;
const MAX_MONEY = 999999.99;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const clampMoney = (n: number) => {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > MAX_MONEY) return MAX_MONEY;
  return n;
};

// ✅ ใช้ตัวนี้ทุกครั้งที่คำนวณเงิน
const money = (n: number) => clampMoney(round2(n));

// ✅ จำกัด input เงิน: ก่อนจุด 6 หลัก / หลังจุด 2 หลัก
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
    .replace(/[^A-Za-z\u0E00-\u0E7F\s]/g, '')
    .replace(/\s+/g, ' ')
    .trimStart();
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

function safeStringify(v: unknown) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function getMeByEmail(list: User[], email?: string | null): User | undefined {
  if (!email) return undefined;
  return list.find((u) => u.email === email);
}

// ===== OCR types =====
type TyphoonOcrResponse = {
  ok: boolean;
  error?: string;
  raw?: unknown;
  parsed?: {
    title?: string | null;
    total?: number | null;
    raw_text?: string | null;
    items?: Array<{
      name?: string | null;
      qty?: number | string | null;
      price?: number | string | null;
    }>;
  };
};

function CreateBillPersonalPageInner() {
  const searchParams = useSearchParams();
  const typeRaw = searchParams.get('type');
  const splitType = ((typeRaw as SplitType) || 'personal') as SplitType;

  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? null;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([{ userId: '', name: '' }]);

  const [itemList, setItemList] = useState<ItemRow[]>([
    { id: makeId(), items: '', qty: '1', price: '', ownerId: '', sharedWith: [] },
  ]);

  const [description, setDescription] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);

  // ✅ กด “เพิ่มผู้เข้าร่วม” แล้วค่อยขึ้น panel search
  const [isAddParticipantOpen, setIsAddParticipantOpen] = useState(false);
  const [addParticipantSearch, setAddParticipantSearch] = useState('');
  const addParticipantInputRef = useRef<HTMLInputElement | null>(null);

  const selectedParticipants = useMemo(
    () => participants.filter((p) => p.userId && p.name),
    [participants]
  );
  
  const selectedIds = useMemo(() => selectedParticipants.map((p) => p.userId), [selectedParticipants]);

  const selectedUserIds = useMemo(() => {
    return new Set(participants.filter((p) => p.userId).map((p) => p.userId));
  }, [participants]);

  const addParticipantCandidates = useMemo(() => {
    const q = addParticipantSearch.trim().toLowerCase();

    return users
      .filter((u) => !selectedUserIds.has(u._id))
      .filter((u) => {
        if (!q) return true;
        const name = (u.name ?? '').toLowerCase();
        const email = (u.email ?? '').toLowerCase();
        const id = (u._id ?? '').toLowerCase();
        return name.includes(q) || email.includes(q) || id.includes(q);
      })
      .slice(0, 30);
  }, [users, selectedUserIds, addParticipantSearch]);

  useEffect(() => {
    if (!isAddParticipantOpen) return;
    const t = setTimeout(() => addParticipantInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isAddParticipantOpen]);

  const addParticipantByUser = (u: User) => {
    setParticipants((prev) => {
      if (prev.some((p) => p.userId === u._id)) return prev;
      return [...prev, { userId: u._id, name: u.name }];
    });
    setIsAddParticipantOpen(false);
    setAddParticipantSearch('');
  };

  // ===== Load users =====
  useEffect(() => {
    async function fetchUsers() {
      try {
        const res = await fetch('/api/users', { credentials: 'include' });
        const data: unknown = await res.json().catch(() => null);

        const list =
          Array.isArray(data) ? data : isRecord(data) && Array.isArray(data.users) ? data.users : [];

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

  // ===== Push "me" to first row =====
  useEffect(() => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;

    setParticipants((prev) => {
      if (prev.length > 0 && prev[0].userId === me._id) return prev;

      const tail = prev.slice(1).filter((p) => p.userId !== me._id);
      return [{ userId: me._id, name: me.name }, ...tail];
    });
  }, [users, currentUserEmail]);

  // ===== Ensure ownerId/sharedWith still valid =====
  useEffect(() => {
  const validIds = new Set(selectedIds);

  setItemList((prev) =>
    prev.map((it) => {
      if (it.ownerId === '__shared__') {
        const nextSharedWith = (it.sharedWith || []).filter((id) => validIds.has(id));
        return { ...it, sharedWith: nextSharedWith };
      }

      if (!it.ownerId) return it;
      return validIds.has(it.ownerId) ? it : { ...it, ownerId: '', sharedWith: [] };
    })
  );
}, [selectedIds]); // ✅ ไม่ต้อง disable eslint แล้ว

  // ===== Compute totals =====
  const calc = useMemo(() => {
    const lineTotals = itemList.map((it) => {
      const qty = toQty(it.qty);
      const unit = money(parseFloat(it.price) || 0);
      const lineTotal = money(qty * unit);
      return { ...it, qty, unit, lineTotal };
    });

    const total = money(lineTotals.reduce((s, it) => s + it.lineTotal, 0));
    const validIds = new Set(selectedParticipants.map((p) => p.userId));

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
        personalByUser[it.ownerId] = money((personalByUser[it.ownerId] || 0) + it.lineTotal);
      }
    }

    const perParticipant = selectedParticipants.map((p) => {
      const personal = personalByUser[p.userId] || 0;
      const shared = sharedByUser[p.userId] || 0;
      const amount = money(personal + shared);
      const percent = total > 0 ? (amount / total) * 100 : 0;
      return { ...p, personal, shared, amount, percent };
    });

    const sumAmt = money(perParticipant.reduce((s, p) => s + p.amount, 0));
    const diff = money(total - sumAmt);
    if (perParticipant.length > 0 && diff !== 0) {
      perParticipant[perParticipant.length - 1] = {
        ...perParticipant[perParticipant.length - 1],
        amount: money(perParticipant[perParticipant.length - 1].amount + diff),
      };
    }

    return { total, sharedTotal, perParticipant, lineTotals, unassignedCount };
  }, [itemList, selectedParticipants]);

  // ===== UI actions =====
  const handleAddParticipant = () => {
    setIsAddParticipantOpen((v) => !v);
    setAddParticipantSearch('');
  };

  const handleRemoveParticipant = (index: number) => {
    if (index === 0) return;
    setParticipants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  };

  const handleAddItem = () =>
    setItemList((prev) => [
      ...prev,
      { id: makeId(), items: '', qty: '1', price: '', ownerId: '', sharedWith: [] },
    ]);

  const handleRemoveItem = (id: string) =>
    setItemList((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== id) : prev));

  const handleItemChange = <K extends keyof Omit<ItemRow, 'id'>>(
    id: string,
    field: K,
    value: Omit<ItemRow, 'id'>[K]
  ) => {
    setItemList((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
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

  const sharedSelectAll = (itemId: string) =>
    setItemList((prev) =>
      prev.map((it) =>
        it.id === itemId && it.ownerId === '__shared__' ? { ...it, sharedWith: selectedIds } : it
      )
    );

  const sharedClearAll = (itemId: string) =>
    setItemList((prev) =>
      prev.map((it) => (it.id === itemId && it.ownerId === '__shared__' ? { ...it, sharedWith: [] } : it))
    );

  const assignUnassignedToMe = () => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;
    setItemList((prev) =>
      prev.map((it) => (!it.ownerId && it.items.trim() ? { ...it, ownerId: me._id, sharedWith: [] } : it))
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
    setUploading(false);
    setSubmitting(false);

    setIsAddParticipantOpen(false);
    setAddParticipantSearch('');

    setParticipants(me ? [{ userId: me._id, name: me.name }] : [{ userId: '', name: '' }]);
    setItemList([{ id: makeId(), items: '', qty: '1', price: '', ownerId: '', sharedWith: [] }]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ===== OCR helpers =====
  const normalizeNameQty = (name: string) => {
    const t = (name || '').trim();
    const m = t.match(/^\s*(\d{1,2})\s*(.*)$/);
    if (!m) return { qty: '1', name: t };
    const q = Number(m[1]);
    if (!Number.isFinite(q) || q <= 0 || q > 50) return { qty: '1', name: t };
    const rest = (m[2] || '').trim();
    return { qty: String(q), name: rest || t };
  };

  const runOcr = async (file: File) => {
    const MAX_MB = 10;
    if (file.size > MAX_MB * 1024 * 1024) {
      alert(`ไฟล์ใหญ่เกิน ${MAX_MB}MB`);
      return;
    }

    setSelectedFileName(file.name);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const res = await fetch('/api/ocr', {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });

      const data = (await res.json().catch(() => null)) as TyphoonOcrResponse | null;

      if (!res.ok || !data?.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        alert(`OCR ไม่สำเร็จ: ${msg}`);
        console.error('OCR ERROR:', res.status, data);
        return;
      }

      const parsed = data.parsed;

      if (!title.trim() && typeof parsed?.title === 'string' && parsed.title.trim()) {
        setTitle(parsed.title.trim());
      }

      const desc =
        typeof parsed?.raw_text === 'string' && parsed.raw_text.trim()
          ? parsed.raw_text
          : data.raw != null
            ? safeStringify(data.raw)
            : '';
      setDescription(desc);

      const rawItems = Array.isArray(parsed?.items) ? parsed!.items! : [];
      if (!rawItems.length) return;

      const defaultOwner = participants[0]?.userId || getMeByEmail(users, currentUserEmail)?._id || '';

      const prepared = rawItems
        .map((it) => {
          const rawName = String(it?.name ?? '').trim();
          const rawQtyStr = it?.qty != null ? String(it.qty) : '';
          const nq = rawQtyStr ? { qty: rawQtyStr, name: rawName } : normalizeNameQty(rawName);

          const qtyNum = toQty(nq.qty || '1');
          const p0 = toNum(it?.price, 0);

          return {
            id: makeId(),
            name: sanitizeItemText(nq.name),
            qtyNum,
            p0,
          };
        })
        .filter((x) => x.name);

      if (!prepared.length) return;

      const ocrTotal = typeof parsed?.total === 'number' ? parsed.total : null;

      const sumAsLine = money(prepared.reduce((s, x) => s + money(x.p0), 0));
      const sumAsUnit = money(prepared.reduce((s, x) => s + money(x.p0) * x.qtyNum, 0));

      const treatPriceAsLineTotal =
        ocrTotal != null ? Math.abs(sumAsLine - ocrTotal) <= Math.abs(sumAsUnit - ocrTotal) : true;

      const nextItems: ItemRow[] = prepared.map((x) => {
        const p0 = money(x.p0);
        const unit =
          x.qtyNum > 0
            ? treatPriceAsLineTotal
              ? money(p0 / x.qtyNum)
              : p0
            : p0;

        return {
          id: x.id,
          items: x.name,
          qty: String(x.qtyNum),
          price: unit > 0 ? unit.toFixed(2) : '',
          ownerId: defaultOwner,
          sharedWith: [],
        };
      });

      setItemList(
        nextItems.length
          ? nextItems
          : [{ id: makeId(), items: '', qty: '1', price: '', ownerId: '', sharedWith: [] }]
      );
    } catch (err) {
      console.error(err);
      alert('OCR ล้มเหลว (network/server)');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await runOcr(file);
  };

  const formatSharedNames = (ids: string[]) => {
    const names = ids
      .map((id) => selectedParticipants.find((p) => p.userId === id)?.name)
      .filter(Boolean) as string[];
    if (names.length === 0) return 'Shared';
    if (names.length <= 3) return names.join(',');
    return `${names.slice(0, 3).join(',')}+${names.length - 3}`;
  };

  // ===== Submit =====
  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);

    try {
      if (!title.trim()) return alert('กรุณากรอก Bill Title');
      if (selectedParticipants.length === 0) return alert('กรุณาเลือก Participants อย่างน้อย 1 คน');
      if (calc.total <= 0) return alert('ยอดรวมต้องมากกว่า 0');

      if (calc.unassignedCount > 0) {
        return alert(
          `มี ${calc.unassignedCount} รายการที่ยังไม่ครบ (ยังไม่เลือก Owner หรือยังไม่เลือกคนหารใน Shared)`
        );
      }

      const cleanedItems = calc.lineTotals
        .map((it) => {
          const name = it.items.trim();
          if (!name) return null;

          const tag =
            it.ownerId === '__shared__'
              ? `[Shared:${formatSharedNames(it.sharedWith || [])}]`
              : it.ownerId
                ? `[${selectedParticipants.find((p) => p.userId === it.ownerId)?.name || 'Owner'}]`
                : '';

          const displayName = `${tag} ${name} x${it.qty}`.trim();
          return { items: displayName, price: money(it.lineTotal) };
        })
        .filter((x): x is { items: string; price: number } => !!x);

      const cleanedParticipants = calc.perParticipant.map((p) => ({
        userId: p.userId,
        name: p.name,
        amount: money(p.amount),
      }));

      const res = await fetch('/api/bills', {
        method: 'POST',
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
        alert('สร้างบิลสำเร็จ!');
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
          <h1 className="text-3xl font-bold mb-4 text-center text-[#4a4a4a] ">
            Add New Bill <span className="text-sm font-normal text-gray-500">({splitType})</span>
          </h1>

          {/* Upload */}
          <div className="border-dashed border-2 border-gray-300 rounded-xl p-8 text-center mb-6">
            <p className="text-lg text-[#4a4a4a] mb-2">Upload a receipt or drag and drop</p>
            <p className="text-xs text-gray-400 mb-2">PNG, JPG up to 10MB</p>

            {selectedFileName ? (
              <p className="text-xs text-gray-500 mb-4">
                Selected: <span className="font-medium">{selectedFileName}</span>
              </p>
            ) : (
              <div className="mb-4" />
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleReceiptChange} />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#fb8c00] text-white py-3 px-6 rounded-lg hover:bg-[#e65100] transition duration-300 disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed"
              disabled={uploading || submitting}
            >
              {uploading ? 'Processing...' : 'Upload Image'}
            </button>

            
          </div>

          <div className="flex items-center justify-center mb-6">
            <hr className="w-1/3 border-[#e0e0e0]" />
            <span className="mx-2 text-[#4a4a4a] text-sm">OR</span>
            <hr className="w-1/3 border-[#e0e0e0]" />
          </div>

          {/* Title */}
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

          {/* ✅ Items (อยู่ก่อน Participants) */}
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
                      onChange={(e) => handleItemChange(it.id, 'items', e.target.value)}
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
                      onChange={(e) => handleItemChange(it.id, 'qty', e.target.value)}
                    />
                  </div>

                  {/* ✅ ปรับ Price ให้เท่าช่องอื่น (ไม่มีข้อความใต้ช่องแล้ว) */}
                  <div className="col-span-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      className="w-full p-3 border text-gray-800 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00] text-right tabular-nums"
                      value={it.price}
                      placeholder="0.00"
                      title="สูงสุด 999999.99"
                      onChange={(e) => handleItemChange(it.id, 'price', normalizeMoneyInput(e.target.value))}
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
                        <option key={p.userId} value={p.userId}>
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
                        const checked = (it.sharedWith || []).includes(p.userId);
                        return (
                          <button
                            key={p.userId}
                            type="button"
                            onClick={() => toggleSharedWith(it.id, p.userId)}
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

                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleRemoveItem(it.id)}
                    className="text-xs px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
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
                
              </button>

              <button
                type="button"
                onClick={assignAllShared}
                className="text-sm text-gray-700 font-medium hover:text-gray-900"
              >
              </button>
            </div>

            <p className="mt-2 text-xs text-gray-400">
              * รายการ Owner/Shared จะอ้างอิงจาก Participants ที่เลือกไว้ (อยู่ด้านล่าง)
            </p>
          </div>

          {/* ✅ Participants (ย้ายมาไว้ใต้ Items) */}
          <div className="mb-6 mt-6">
            <label className="block mb-1 text-sm text-gray-600">Participants</label>

            <div className="space-y-3">
              {participants.map((p, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <select
                    className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    value={p.userId}
                    disabled={index === 0}
                    onChange={(e) => {
                      const id = e.target.value;
                      const u = users.find((x) => x._id === id);
                      setParticipants((prev) =>
                        prev.map((row, i) => (i === index ? { userId: id, name: u?.name || '' } : row))
                      );
                    }}
                  >
                    <option value="">-- เลือกผู้ใช้ --</option>

                    {users
                      .filter((u) => !participants.some((x) => x.userId === u._id && x.userId !== p.userId))
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name}
                          {u.email === currentUserEmail ? ' (You)' : ''}
                        </option>
                      ))}
                  </select>

                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => handleRemoveParticipant(index)}
                    className={`px-5 py-2 rounded-lg transition-all duration-200 shadow-sm ${
                      index === 0
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-red-500 text-white hover:bg-red-600 hover:scale-105'
                    }`}
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>

            <button
              onClick={handleAddParticipant}
              className="mt-3 text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
              type="button"
            >
              ➕ เพิ่มผู้เข้าร่วม
            </button>

            {isAddParticipantOpen && (
              <div className="mt-3 rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex gap-2">
                  <input
                    ref={addParticipantInputRef}
                    type="text"
                    className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    placeholder="ค้นหาชื่อ / email / userId..."
                    value={addParticipantSearch}
                    onChange={(e) => setAddParticipantSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddParticipantOpen(false);
                      setAddParticipantSearch('');
                    }}
                    className="px-4 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
                  >
                    ปิด
                  </button>
                </div>

                <div className="mt-2 max-h-56 overflow-auto">
                  {addParticipantCandidates.length === 0 ? (
                    <p className="text-sm text-gray-500 py-3 text-center">ไม่พบผู้ใช้</p>
                  ) : (
                    <div className="space-y-2">
                      {addParticipantCandidates.map((u) => (
                        <button
                          key={u._id}
                          type="button"
                          onClick={() => addParticipantByUser(u)}
                          className="w-full text-left p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 truncate">
                                {u.name} {u.email === currentUserEmail ? '(You)' : ''}
                              </p>
                              <p className="text-xs text-gray-400 truncate">{u.email}</p>
                            </div>
                            <span className="text-xs font-semibold text-[#fb8c00]">เพิ่ม</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Description */}
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

          {/* Total + Summary */}
          <div className="mb-4 text-center">
            <p className="text-lg text-[#4a4a4a]">รวมทั้งหมด</p>
            <p className="text-2xl font-semibold text-[#fb8c00]">{money(calc.total).toFixed(2)} ฿</p>
            <p className="text-xs text-gray-500 mt-1">Shared รวม: {money(calc.sharedTotal).toFixed(2)} ฿</p>
          </div>

          <div className="mb-6">
            <div className="text-center mb-2">
              <p className="text-lg font-semibold text-[#4a4a4a]">สรุปยอดที่ต้องจ่าย</p>
            </div>

            <div className="bg-[#f1f1f1] rounded-2xl p-5">
              {calc.perParticipant.length === 0 ? (
                <p className="text-sm text-gray-500 text-center">ยังไม่มีผู้เข้าร่วม</p>
              ) : (
                <div className="space-y-2">
                  {calc.perParticipant.map((p) => (
                    <div key={p.userId} className="flex items-center justify-between">
                      <div className="text-[#4a4a4a]">
                        {p.name} ({calc.total > 0 ? p.percent.toFixed(0) : '0'}%)
                        <div className="text-xs text-gray-500">
                          ของตัวเอง: {money(p.personal).toFixed(2)} ฿ + Shared ที่โดนหาร: {money(p.shared).toFixed(2)} ฿
                        </div>
                      </div>
                      <div className="text-[#4a4a4a] font-semibold">{money(p.amount).toFixed(2)} ฿</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {calc.unassignedCount > 0 && (
              <p className="mt-2 text-xs text-red-500">
                ยังมี {calc.unassignedCount} รายการที่ยังไม่ครบ (ยังไม่เลือก Owner หรือยังไม่เลือกคนหารใน Shared)
              </p>
            )}
          </div>

          {/* Confirm */}
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
    </div>
  );
}

export default function CreatePercentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <CreateBillPersonalPageInner />
    </Suspense>
  );
}