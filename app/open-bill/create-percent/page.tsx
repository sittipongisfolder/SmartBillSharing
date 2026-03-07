'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CheckCircleIcon } from '@heroicons/react/24/solid';
import { useSession } from 'next-auth/react';

interface User {
  _id: string;
  name: string;
  email: string;
}

type SplitType = 'equal' | 'percentage' | 'personal';
type PercentMode = 'percent' | 'amount';
type PercentValue = number | '';
type AmountValue = number | '';

interface Participant {
  userId: string;
  name: string;
  percent?: PercentValue; // percentage
  amount: AmountValue; // personal/percentage
  pctMode?: PercentMode;
}

type ItemRow = {
  items: string;
  qty: string;
  price: string; // unit price (string เพื่อคุมรูปแบบ)
};

type SummaryRow = {
  userId: string;
  name: string;
  amount: number;
  percent: number;
  percentInput: number;
  amountInput: number;
  pctMode: PercentMode;
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
    { userId: '', name: '', percent: '', amount: 0, pctMode: 'percent' },
  ]);
  const [sharePerPerson, setSharePerPerson] = useState(0);
  const [description, setDescription] = useState('');

  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? null;

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [itemList, setItemList] = useState<ItemRow[]>([{ items: '', qty: '1', price: '' }]);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');

  // ✅ เพิ่มผู้เข้าร่วมแบบค้นหา
  const [isAddParticipantOpen, setIsAddParticipantOpen] = useState(false);
  const [addParticipantSearch, setAddParticipantSearch] = useState('');
  const addParticipantInputRef = useRef<HTMLInputElement | null>(null);

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
      .slice(0, 20);
  }, [users, selectedUserIds, addParticipantSearch]);

  useEffect(() => {
    if (!isAddParticipantOpen) return;
    const t = setTimeout(() => addParticipantInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [isAddParticipantOpen]);

  const addParticipantByUser = (u: User) => {
    setParticipants((prev) => {
      if (prev.some((p) => p.userId === u._id)) return prev;
      return [...prev, { userId: u._id, name: u.name, percent: '', amount: 0, pctMode: 'percent' }];
    });
    setIsAddParticipantOpen(false);
    setAddParticipantSearch('');
  };

  const selectedParticipants = useMemo(
    () => participants.filter((p) => p.userId && p.name),
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
      if (prev.length > 0 && prev[0].userId === me._id) return prev;

      const headAmount = prev[0]?.amount ?? 0;
      const headPercent = prev[0]?.percent ?? '';
      const headPctMode: PercentMode = prev[0]?.pctMode ?? 'percent';

      const tail = prev.slice(1).filter((p) => p.userId !== me._id);

      return [
        { userId: me._id, name: me.name, percent: headPercent, amount: headAmount, pctMode: headPctMode },
        ...tail,
      ];
    });
  }, [users, currentUserEmail]);

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

      const token = localStorage.getItem('token');

      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });

      const data = (await res.json().catch(() => null)) as TyphoonOcrResponse | null;

      if (!data) {
        console.error('OCR ERROR:', res.status, data);
        alert(`OCR ไม่สำเร็จ: HTTP ${res.status}`);
        return;
      }

      if (!res.ok || data.ok === false) {
        console.error('OCR ERROR:', res.status, data);
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
      setDescription(rawText);

      const ocrTitle = typeof parsed.title === 'string' ? parsed.title.trim() : '';
      if (ocrTitle) {
        setTitle((prev) => (prev.trim() ? prev : ocrTitle));
      }

      const mapped: ItemRow[] = Array.isArray(parsed.items)
        ? parsed.items
          .map((it) => {
            const name = String(it?.name ?? '').trim();
            if (!name) return null;

            const qtyNum = Math.max(1, Math.floor(toNumber(it.qty ?? 1, 1)));
            const unit = money(toNumber(it.unit_price, 0));

            return {
              items: name,
              qty: String(qtyNum),
              price: unit.toFixed(2),
            };
          })
          .filter((x): x is ItemRow => x !== null)
        : [];

      if (mapped.length > 0) {
        setItemList([...mapped, { items: '', qty: '1', price: '' }]);

        const totalFromParsed = money(toNumber(parsed.total, 0));
        if (totalFromParsed > 0) {
          setTotalPrice(totalFromParsed);
        } else {
          const sumFromItems = money(
            mapped.reduce(
              (sum, r) => sum + toIntQty(r.qty) * money(parseFloat(r.price) || 0),
              0
            )
          );
          setTotalPrice(sumFromItems > 0 ? sumFromItems : '');
        }
      } else {
        setItemList([{ items: '', qty: '1', price: '' }]);
      }
    } catch (err) {
      console.error(err);
      alert('OCR ล้มเหลว (network/server)');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const resetForm = () => {
    const me = getMeByEmail(users, currentUserEmail);
    setTitle('');
    setDescription('');
    setItemList([{ items: '', qty: '1', price: '' }]);
    setParticipants(
      me
        ? [{ userId: me._id, name: me.name, percent: '', amount: 0, pctMode: 'percent' }]
        : [{ userId: '', name: '', percent: '', amount: 0, pctMode: 'percent' }]
    );
    setSelectedFileName('');
    setTotalPrice('');
    setSharePerPerson(0);
    setUploading(false);
    setSubmitting(false);

    setIsAddParticipantOpen(false);
    setAddParticipantSearch('');

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleAddParticipant = () => {
    setIsAddParticipantOpen((v) => !v);
    setAddParticipantSearch('');
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
      setParticipants((prev) => prev.map((p) => (p.userId ? { ...p, amount: share } : { ...p, amount: 0 })));
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
      if (arr[i].userId && i !== editedIndex) return i;
    }
    return -1;
  };

  const sumAmounts = (arr: Participant[]) =>
    money(arr.reduce((s, p) => (p.userId ? s + money(toNumber(p.amount, 0)) : s), 0));

  // ✅ แก้ % แล้วให้ amount ตาม + คน balance รับเศษ
  const setPercentAt = (index: number, raw: string) => {
    const pct: PercentValue = toPercentValue(raw);

    setParticipants((prev) => {
      const total = getTotalNumber();

      const next: Participant[] = prev.map((p, i): Participant => {
        if (i !== index) return p;
        if (!p.userId) return p;

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
          if (!p.userId) return s;
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
          if (!p.userId) return p;
          return { ...p, amount: amt, percent: '', pctMode: 'amount' };
        });
      }

      const next: Participant[] = prev.map((p, i): Participant => {
        if (i !== index) return p;
        if (!p.userId) return p;

        const amtNum = money(toNumber(amt, 0));
        const pctNum = clampPercentNum((amtNum / total) * 100);

        return { ...p, amount: amtNum, percent: pctNum, pctMode: 'amount' };
      });

      const bal = findBalanceIndex(next, index);
      if (bal === -1) return next;

      const sumOtherAmt = money(
        next.reduce((s, p, i) => {
          if (i === bal) return s;
          if (!p.userId) return s;
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
        if (prev[i].userId) {
          bal = i;
          break;
        }
      }
      if (bal === -1) return prev;

      const next: Participant[] = prev.map((p): Participant => {
        if (!p.userId) return p;

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
          if (!p.userId) return s;
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

  // ✅ กันดับเบิ้ลคลิ๊กสร้างบิล + ปัด/จำกัดเงินก่อนส่ง
  const handleSubmit = async () => {
    if (submitting) return;
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
        .filter((p) => p.userId && p.name)
        .map((p) => ({
          userId: p.userId,
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

      let cleanedParticipants: Array<{ userId: string; name: string; percent?: number | ''; amount: number }> = [];

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
          userId: p.userId,
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
            if (!(amt > 0)) return { userId: p.userId, name: p.name, percent: NaN, amount: 0, mode };
            const percent = round2((amt / effectiveTotal) * 100);
            return { userId: p.userId, name: p.name, percent, amount: amt, mode };
          }

          const pctNum = p.percent === '' || p.percent === undefined ? NaN : Number(p.percent);
          if (!Number.isFinite(pctNum)) return { userId: p.userId, name: p.name, percent: NaN, amount: 0, mode };

          const pct = round2(Math.max(0, Math.min(100, pctNum)));
          const amt = money((effectiveTotal * pct) / 100);
          return { userId: p.userId, name: p.name, percent: pct, amount: amt, mode };
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
          userId: p.userId,
          name: p.name,
          amount: money(p.amount),
          percent: round2((money(p.amount) / effectiveTotal) * 100),
        }));
      } else {
        const count = cleanedParticipantsBase.length;
        const share = count > 0 ? money(effectiveTotal / count) : 0;

        cleanedParticipants = cleanedParticipantsBase.map((p) => ({
          userId: p.userId,
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

      const res = await fetch('/api/bills', {
        method: 'POST',
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
        alert('สร้างบิลสำเร็จ!');
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
              {participants.map((participant, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <select
                    className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    value={participant.userId}
                    disabled={index === 0}
                    onChange={(e) =>
                      setParticipants((prev) =>
                        prev.map((p, i): Participant =>
                          i === index
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
                      .filter((u) => !participants.some((p) => p.userId === u._id && p.userId !== participant.userId))
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name}
                          {u.email === currentUserEmail ? ' (You)' : ''}
                        </option>
                      ))}
                  </select>

                  {splitType === 'percentage' && (
                    <>
                      <div className="w-24">
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={0.01}
                          inputMode="decimal"
                          disabled={!participant.userId}
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
                          disabled={!participant.userId}
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
                        className="w-full p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                        placeholder="฿"
                        value={participant.amount === '' ? '' : money(Number(participant.amount)).toFixed(2)}
                        onChange={(e) => {
                          const normalized = normalizeMoneyInput(e.target.value);
                          const amt = normalized === '' ? '' : toAmountValue(normalized);
                          setParticipants((prev) => prev.map((p, i): Participant => (i === index ? { ...p, amount: amt } : p)));
                        }}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    disabled={index === 0}
                    onClick={() => {
                      if (index === 0) return;
                      setParticipants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
                    }}
                    className={`px-5 py-2 rounded-lg transition-all duration-200 shadow-sm ${index === 0
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

                <p className="text-xs text-gray-400 mt-2">พบ {addParticipantCandidates.length} คน</p>

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
                    <div key={p.userId} className="flex items-center justify-between">
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