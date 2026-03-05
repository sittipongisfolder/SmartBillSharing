'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {  CheckCircleIcon } from '@heroicons/react/24/solid';
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
  qty: string;    // จำนวน
  price: string;  // ราคา/ชิ้น (unit price)
  ownerId: string; // userId หรือ "__shared__"
};

const makeId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

function CreateBillPersonalPageInner() {
  const searchParams = useSearchParams();
  const splitTypeRaw = searchParams.get('type');
  const splitType = (splitTypeRaw as SplitType) || 'personal';

  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? null;

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([
    { userId: '', name: '' },
  ]);

  const [itemList, setItemList] = useState<ItemRow[]>([
    { id: makeId(), items: '', qty: '1', price: '', ownerId: '' },
  ]);

  const [description, setDescription] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');
  const [uploading, setUploading] = useState(false);

  const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

  const toQty = (v: string) => {
    const n = parseInt(v || '1', 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  const toNum = (v: unknown, fallback = 0) => {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  };

  const sanitizeItemText = (raw: string) => {
    // อนุญาตเฉพาะ: ตัวอักษรไทย + อังกฤษ + เว้นวรรค (ไม่อนุญาตเลข/สัญลักษณ์)
    return (raw || '')
      .replace(/[^A-Za-z\u0E00-\u0E7F\s]/g, '')
      .replace(/\s+/g, ' ')
      .trimStart();
  };

  function getMeByEmail(list: User[], email?: string | null): User | undefined {
    if (!email) return undefined;
    return list.find((u) => u.email === email);
  }

  const selectedParticipants = useMemo(
    () => participants.filter((p) => p.userId && p.name),
    [participants]
  );
  const selectedCount = selectedParticipants.length;

  // ===== Load users =====
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

  // ===== Push "me" to first row (head bill lock) =====
  useEffect(() => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;

    setParticipants((prev) => {
      if (prev.length > 0 && prev[0].userId === me._id) return prev;

      const tail = prev.slice(1).filter((p) => p.userId !== me._id);
      return [{ userId: me._id, name: me.name }, ...tail];
    });
  }, [users, currentUserEmail]);

  // ===== Ensure ownerId still valid when participants change =====
  useEffect(() => {
    const validIds = new Set(selectedParticipants.map((p) => p.userId));
    setItemList((prev) =>
      prev.map((it) => {
        if (it.ownerId === '__shared__') return it;
        if (!it.ownerId) return it;
        return validIds.has(it.ownerId) ? it : { ...it, ownerId: '' };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCount]);

  // ===== Compute totals =====
  const calc = useMemo(() => {
    const lineTotals = itemList.map((it) => {
      const qty = toQty(it.qty);
      const unit = parseFloat(it.price) || 0;
      const lineTotal = round2(qty * unit);
      return { ...it, qty, unit, lineTotal };
    });

    const total = round2(lineTotals.reduce((s, it) => s + it.lineTotal, 0));
    const sharedTotal = round2(
      lineTotals.filter((it) => it.ownerId === '__shared__').reduce((s, it) => s + it.lineTotal, 0)
    );

    const sharedPerPerson = selectedCount > 0 ? round2(sharedTotal / selectedCount) : 0;

    const byUser: Record<string, number> = {};
    for (const it of lineTotals) {
      if (!it.ownerId || it.ownerId === '__shared__') continue;
      byUser[it.ownerId] = round2((byUser[it.ownerId] || 0) + it.lineTotal);
    }

    const perParticipant = selectedParticipants.map((p) => {
      const base = byUser[p.userId] || 0;
      const amount = round2(base + sharedPerPerson);
      const percent = total > 0 ? (amount / total) * 100 : 0;
      return { ...p, base, amount, percent };
    });

    // ปรับ diff ให้ sum(amount) = total (กันปัดเศษ)
    const sumAmt = round2(perParticipant.reduce((s, p) => s + p.amount, 0));
    const diff = round2(total - sumAmt);
    if (perParticipant.length > 0 && diff !== 0) {
      perParticipant[perParticipant.length - 1] = {
        ...perParticipant[perParticipant.length - 1],
        amount: round2(perParticipant[perParticipant.length - 1].amount + diff),
      };
    }

    const unassignedCount = lineTotals.filter((it) => it.items.trim() && !it.ownerId).length;

    return {
      total,
      sharedTotal,
      sharedPerPerson,
      perParticipant,
      lineTotals,
      unassignedCount,
    };
  }, [itemList, selectedParticipants, selectedCount]);

  // ===== UI actions =====
  const handleAddParticipant = () => {
    setParticipants((prev) => [...prev, { userId: '', name: '' }]);
  };

  const handleAddItem = () => {
    setItemList((prev) => [...prev, { id: makeId(), items: '', qty: '1', price: '', ownerId: '' }]);
  };

  const handleRemoveItem = (id: string) => {
    setItemList((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== id) : prev));
  };

  const handleItemChange = (id: string, field: keyof Omit<ItemRow, 'id'>, value: string) => {
    setItemList((prev) => prev.map((it) => (it.id === id ? { ...it, [field]: value } : it)));
  };

  const assignUnassignedToMe = () => {
    const me = getMeByEmail(users, currentUserEmail);
    if (!me) return;
    setItemList((prev) =>
      prev.map((it) => (!it.ownerId && it.items.trim() ? { ...it, ownerId: me._id } : it))
    );
  };

  const assignAllShared = () => {
    setItemList((prev) => prev.map((it) => (it.items.trim() ? { ...it, ownerId: '__shared__' } : it)));
  };

  const resetForm = () => {
    const me = getMeByEmail(users, currentUserEmail);
    setTitle('');
    setDescription('');
    setSelectedFileName('');
    setUploading(false);
    setParticipants(me ? [{ userId: me._id, name: me.name }] : [{ userId: '', name: '' }]);
    setItemList([{ id: makeId(), items: '', qty: '1', price: '', ownerId: '' }]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ===== OCR =====
  const normalizeNameQty = (name: string) => {
    // ดึง qty ถ้าเจอ "2 น้ำแข็ง" หรือ "3ไก่ทอด"
    const t = (name || '').trim();
    const m = t.match(/^\s*(\d{1,2})\s*(.*)$/);
    if (!m) return { qty: '1', name: t };
    const q = Number(m[1]);
    if (!Number.isFinite(q) || q <= 0 || q > 50) return { qty: '1', name: t };
    const rest = (m[2] || '').trim();
    return { qty: String(q), name: rest || t };
  };

  const handleReceiptChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setUploading(true);

    try {
      const fd = new FormData();
      fd.append('file', file);

      const token = localStorage.getItem('token');

      const res = await fetch('/api/ocr', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: fd,
      });

      const data: unknown = await res.json().catch(() => null);

      // กันรูปแบบไม่คาดคิด
      const dataObj =
        typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : null;

      const ok = Boolean(dataObj && dataObj.ok);
      if (!res.ok || !ok) {
        console.error('OCR ERROR:', res.status, data);
        const errMsg =
          dataObj && typeof dataObj.error === 'string' ? dataObj.error : 'Unknown error';
        alert(`OCR ไม่สำเร็จ: ${errMsg}`);
        return;
      }

      const parsed =
        dataObj && typeof dataObj.parsed === 'object' && dataObj.parsed !== null
          ? (dataObj.parsed as Record<string, unknown>)
          : null;

      // เติม Title/Description
      if (!title.trim() && parsed && typeof parsed.title === 'string' && parsed.title.trim()) {
        setTitle(parsed.title.trim());
      }

      const rawText =
        parsed && typeof parsed.raw_text === 'string' && parsed.raw_text.trim()
          ? parsed.raw_text
          : dataObj && typeof dataObj.raw === 'string'
            ? dataObj.raw
            : JSON.stringify(dataObj?.raw);

      setDescription(rawText);

      const parsedItems = parsed ? parsed.items : null;

      if (Array.isArray(parsedItems) && parsedItems.length) {
        const me = getMeByEmail(users, currentUserEmail);
        const defaultOwner = me?._id || '';

        const next: ItemRow[] = parsedItems.map((it: unknown) => {
          const itObj =
            typeof it === 'object' && it !== null ? (it as Record<string, unknown>) : {};

          const rawName = String(itObj.name ?? '').trim();
          const rawQtyStr = itObj.qty != null ? String(itObj.qty) : '';
          const nq = rawQtyStr ? { qty: rawQtyStr, name: rawName } : normalizeNameQty(rawName);

          const qtyNum = toQty(nq.qty || '1');

          // OCR อาจส่ง price เป็นราคารวมต่อบรรทัดมาได้ → เดาและแปลงกลับเป็นราคา/ชิ้น
          const p0 = toNum(itObj.price, 0);
          const unitGuess =
            qtyNum > 1 && p0 > 0
              ? round2(p0 / qtyNum)
              : p0;

          return {
            id: makeId(),
            items: sanitizeItemText(nq.name),
            qty: String(qtyNum),
            price: unitGuess > 0 ? String(unitGuess) : String(p0 || ''),
            ownerId: defaultOwner, // กันหลง: ใส่เป็น “เรา” ไว้ก่อน แล้วค่อยแก้ owner ทีหลัง
          };
        });

        setItemList(next.length ? next : [{ id: makeId(), items: '', qty: '1', price: '', ownerId: '' }]);
      }
    } catch (err) {
      console.error(err);
      alert('OCR ล้มเหลว (network/server)');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ===== Submit =====
  const handleSubmit = async () => {
    const token = localStorage.getItem('token');

    if (!title.trim()) return alert('กรุณากรอก Bill Title');
    if (selectedParticipants.length === 0) return alert('กรุณาเลือก Participants อย่างน้อย 1 คน');
    if (calc.total <= 0) return alert('ยอดรวมต้องมากกว่า 0');

    // ถ้ายังมีรายการที่มีชื่อแต่ไม่เลือก owner เลย
    if (calc.unassignedCount > 0) {
      return alert(`มี ${calc.unassignedCount} รายการที่ยังไม่เลือก “ของใคร” (Owner)`);
    }

    // items ที่ส่งไป backend: ส่งเป็น lineTotal (qty*unitPrice) เพื่อรวมถูก
    const cleanedItems = calc.lineTotals
      .map((it) => {
        const name = it.items.trim();
        if (!name) return null;

        const tag =
          it.ownerId === '__shared__'
            ? '[Shared]'
            : it.ownerId
              ? `[${selectedParticipants.find((p) => p.userId === it.ownerId)?.name || 'Owner'}]`
              : '';

        const displayName = `${tag} ${name} x${it.qty}`.trim();
        return { items: displayName, price: it.lineTotal };
      })
      .filter(Boolean) as Array<{ items: string; price: number }>;

    const cleanedParticipants = calc.perParticipant.map((p) => ({
      userId: p.userId,
      name: p.name,
      amount: round2(p.amount),
    }));

    const res = await fetch('/api/bills', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        title,
        totalPrice: calc.total,
        splitType,
        participant: cleanedParticipants,
        participants: cleanedParticipants,
        description,
        items: cleanedItems,
      }),
    });

    const raw = await res.text();

    let data: unknown;
    try {
      data = JSON.parse(raw) as unknown;
    } catch {
      data = { error: raw } as { error: string };
    }

    const dataObj =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};

    if (res.ok) {
      alert('สร้างบิลสำเร็จ!');
      resetForm();
    } else {
      console.log('CREATE BILL ERROR:', res.status, dataObj);
      const msg =
        (typeof dataObj.error === 'string' && dataObj.error) ||
        (typeof dataObj.message === 'string' && dataObj.message) ||
        'Bad Request';
      alert(`สร้างบิลไม่สำเร็จ: ${msg}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#fbf7f1] text-[#111827]">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-black/5">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg"></span>
            </span>
            <span className="font-semibold">Smart Bill Sharing System</span>
          </div>
        </div>
      </header>

      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
        <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl p-8 relative">
          <h1 className="text-3xl font-bold mb-4 text-center text-[#4a4a4a] ">
            Add New Bill <span className="text-sm font-normal text-gray-500">(personal)</span>
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

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleReceiptChange}
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#fb8c00] text-white py-3 px-6 rounded-lg hover:bg-[#e65100] transition duration-300"
              disabled={uploading}
            >
              {uploading ? 'Processing...' : 'Upload Image'}
            </button>

            <div className="mt-3 flex gap-2 justify-center flex-wrap">
              <button
                type="button"
                onClick={assignUnassignedToMe}
                className="text-xs px-3 py-2 rounded-lg border border-[#fb8c00] text-[#fb8c00] hover:bg-[#fff5e6]"
              >
                Assign ที่ยังไม่เลือก → ฉัน
              </button>
              <button
                type="button"
                onClick={assignAllShared}
                className="text-xs px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
              >
                ตั้งทุกรายการเป็น Shared
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-3">
              * OCR จะเติมรายการ + คุณเลือก Owner ต่อรายการได้ (Shared = หารเท่ากัน)
            </p>
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

          {/* Items */}
          <div className="mb-2">
            <div className="flex items-center justify-between">
              <button
                onClick={handleAddItem}
                className="mt-3 text-sm text-[#fb8c00] font-medium hover:text-[#e65100]"
                type="button"
              >
                ➕ เพิ่มรายการอาหาร
              </button>
              {calc.unassignedCount > 0 && (
                <span className="text-xs text-red-500">
                  ยังไม่เลือก Owner: {calc.unassignedCount} รายการ
                </span>
              )}
            </div>

            {/* Header row */}
            <div className="mt-3 grid grid-cols-12 gap-3 text-xs text-gray-500">
              <div className="col-span-5">Items</div>
              <div className="col-span-2">Qty</div>
              <div className="col-span-2">Price</div>
              <div className="col-span-3">Owner</div>
            </div>

            {itemList.map((it) => (
              <div key={it.id} className="mt-2 grid grid-cols-12 gap-3 items-center">
                <div className="col-span-5">
                  <input
                    type="text"
                    className={`w-full p-3 border text-gray-800 placeholder:text-gray-400 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00] ${
                      it.items.trim() && !it.ownerId ? 'border-red-400' : ''
                    }`}
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

                <div className="col-span-2">
                  <input
                    type="number"
                    step="0.01"
                    inputMode="decimal"
                    className="w-full p-3 border text-gray-800 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    value={it.price}
                    onChange={(e) => handleItemChange(it.id, 'price', e.target.value)}
                  />
                </div>

                <div className="col-span-3 flex gap-2">
                  <select
                    className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    value={it.ownerId}
                    onChange={(e) => handleItemChange(it.id, 'ownerId', e.target.value)}
                  >
                    <option value="">-- เลือก --</option>
                    <option value="__shared__">Shared (หารเท่ากัน)</option>
                    {selectedParticipants.map((p) => (
                      <option key={p.userId} value={p.userId}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleRemoveItem(it.id)}
                    className="px-4 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600"
                    title="ลบรายการ"
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Participants */}
          <div className="mb-4 mt-6">
            <label className="block mb-1 text-sm text-gray-600">Participants</label>

            <div className="space-y-3">
              {participants.map((p, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <select
                    className="flex-1 p-3 border border-gray-300 rounded-lg bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                    value={p.userId}
                    disabled={index === 0}
                    onChange={(e) =>
                      setParticipants((prev) =>
                        prev.map((row, i) =>
                          i === index
                            ? {
                                userId: e.target.value,
                                name: users.find((u) => u._id === e.target.value)?.name || '',
                              }
                            : row
                        )
                      )
                    }
                  >
                    <option value="">-- เลือกผู้ใช้ --</option>
                    {users
                      .filter((u) => !participants.some((pp) => pp.userId === u._id && pp.userId !== p.userId))
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
                    onClick={() =>
                      setParticipants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev))
                    }
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
          </div>

          {/* Total + Summary */}
          <div className="mb-4 text-center">
            <p className="text-lg text-[#4a4a4a]">รวมทั้งหมด</p>
            <p className="text-2xl font-semibold text-[#fb8c00]">{calc.total.toFixed(2)} ฿</p>
            <p className="text-xs text-gray-500 mt-1">
              Shared: {calc.sharedTotal.toFixed(2)} ฿ · เฉลี่ย Shared:{' '}
              {selectedCount > 0 ? calc.sharedPerPerson.toFixed(2) : '0.00'} ฿/คน
            </p>
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
                          ของตัวเอง: {p.base.toFixed(2)} ฿ + Shared:{' '}
                          {selectedCount > 0 ? calc.sharedPerPerson.toFixed(2) : '0.00'} ฿
                        </div>
                      </div>
                      <div className="text-[#4a4a4a] font-semibold">{p.amount.toFixed(2)} ฿</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Description */}
          <div className="mb-6">
            <label className="block mb-1 text-sm text-gray-600">Description</label>
            <textarea
              className="w-full p-3 border text-gray-800 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              placeholder="....."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* Confirm */}
          <div className="flex items-center justify-center mt-4">
            <button
              onClick={handleSubmit}
              className="w-70 inline-flex items-center justify-center gap-2 px-3 py-3 bg-[#fb8c00] text-white font-semibold rounded-full shadow-md hover:bg-[#e65100] hover:shadow-lg transition-all duration-300"
              type="button"
            >
              <CheckCircleIcon className="w-5 h-5 text-white" />
              <span>Confirm and Save Bill</span>
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