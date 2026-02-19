'use client';
/* eslint-disable @next/next/no-img-element */


import { useEffect, useMemo, useState, Fragment } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import {
  ChevronDownIcon,
  PencilSquareIcon,
  TrashIcon,
  XMarkIcon,
  PlusIcon,
} from '@heroicons/react/24/solid';

type PaymentStatus = 'unpaid' | 'pending' | 'paid';
type SplitType = 'equal' | 'percentage' | 'personal';

interface SlipInfo {
  imageUrl?: string;
  publicId?: string;
  provider?: string;
  reference?: string;
  checkedAt?: string;
  verified?: boolean;
}

interface Participant {
  userId?: string | { _id: string };
  name: string;
  amount: number;
  paymentStatus?: PaymentStatus;
  slipInfo?: SlipInfo;
  paidAt?: string;
}

interface CreatedBy {
  _id: string;
  name?: string;
  email?: string;
}

interface BillItem {
  items: string;
  price: number;
}

interface Bill {
  _id: string;
  title: string;
  totalPrice: number;
  splitType: SplitType | string;
  createdBy: string | CreatedBy;
  createdAt: string;
  participants: Participant[];
  items?: BillItem[];
  description?: string;
  billStatus?: PaymentStatus;
}

interface UserRow {
  _id: string;
  name: string;
  email: string;
}

function normalizeId(v: unknown): string | undefined {
  if (!v) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && '_id' in v) {
    const maybe = (v as { _id?: unknown })._id;
    if (typeof maybe === 'string') return maybe;
  }
  return undefined;
}

function normalizeStatus(v: unknown): PaymentStatus | undefined {
  if (v === 'unpaid' || v === 'pending' || v === 'paid') return v;
  return undefined;
}

function formatDateTimeTH(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatMoneyTHB(n: number): string {
  if (!Number.isFinite(n)) return '-';
  return `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isBillResponse(x: unknown): x is { bill: Bill } {
  return isObject(x) && 'bill' in x && isObject((x as Record<string, unknown>).bill);
}

// ✅ Hybrid billStatus: "ไม่นับหัวบิล"
function computeBillStatusHybrid(bill: Bill): PaymentStatus {
  const ownerId = normalizeId(bill.createdBy);
  const others = bill.participants.filter((p) => normalizeId(p.userId) !== ownerId);

  if (others.length === 0) return 'paid';

  const statuses = others.map((p) => normalizeStatus(p.paymentStatus) ?? 'unpaid');
  if (statuses.every((s) => s === 'paid')) return 'paid';
  if (statuses.some((s) => s === 'paid' || s === 'pending')) return 'pending';
  return 'unpaid';
}

function getMyParticipant(bill: Bill, myId?: string): Participant | undefined {
  if (!myId) return undefined;
  return bill.participants.find((p) => normalizeId(p.userId) === myId);
}

function getMyStatus(bill: Bill, myId?: string): PaymentStatus {
  const me = getMyParticipant(bill, myId);
  return normalizeStatus(me?.paymentStatus) ?? 'unpaid';
}

function getBillStatus(bill: Bill): PaymentStatus {
  const s = normalizeStatus(bill.billStatus);
  return s ?? computeBillStatusHybrid(bill);
}

function getMyShare(bill: Bill, myId?: string): number | null {
  if (!myId) return null;
  const me = getMyParticipant(bill, myId);
  if (me && Number.isFinite(me.amount)) return me.amount;
  return null;
}

function StatusBadge({ status }: { status: PaymentStatus }) {
  const label = status === 'paid' ? 'Paid' : status === 'pending' ? 'Pending' : 'Unpaid';
  const cls =
    status === 'paid'
      ? 'bg-green-50 text-green-700 border-green-200'
      : status === 'pending'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : 'bg-red-50 text-red-700 border-red-200';

  return (
    <span className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-semibold ${cls}`}>
      <span
        className={`inline-block h-2 w-2 rounded-full ${status === 'paid' ? 'bg-green-500' : status === 'pending' ? 'bg-amber-500' : 'bg-red-500'
          }`}
      />
      {label}
    </span>
  );
}

/** ------------------ Edit Modal (ของเดิมคุณ) ------------------ */

type EditDraft = {
  _id: string;
  title: string;
  description: string;
  items: Array<{ items: string; price: number | '' }>;
  participants: Array<{
    userId: string;
    name: string;
    amount: number | '';
    paymentStatus?: PaymentStatus;
  }>;
};

function toEditDraft(bill: Bill): EditDraft {
  return {
    _id: bill._id,
    title: bill.title ?? '',
    description: bill.description ?? '',
    items: (bill.items ?? []).map((it) => ({
      items: it.items ?? '',
      price: Number.isFinite(it.price) ? it.price : '',
    })),
    participants: (bill.participants ?? []).map((p) => ({
      userId: normalizeId(p.userId) ?? '',
      name: p.name ?? '',
      amount: Number.isFinite(p.amount) ? p.amount : '',
      paymentStatus: normalizeStatus(p.paymentStatus),
    })),
  };
}

function cleanEditDraft(d: EditDraft, ownerId: string) {
  const title = (d.title || '').trim();
  const description = (d.description || '').trim();

  const items = d.items
    .map((it) => ({ items: (it.items || '').trim(), price: Number(it.price) || 0 }))
    .filter((it) => it.items.length > 0 && it.price > 0);

  const participants = d.participants
    .map((p) => {
      const uid = (p.userId || '').trim();
      const name = (p.name || '').trim();

      const status: PaymentStatus = uid && uid === ownerId ? 'paid' : (p.paymentStatus ?? 'unpaid');

      return {
        userId: uid,
        name,
        amount: Number(p.amount) || 0,
        paymentStatus: status,
      };
    })
    .filter((p) => p.userId.length > 0 && p.name.length > 0);

  return { title, description, items, participants };
}

function applyEqualSplitAmounts(participants: EditDraft['participants'], totalFromItems: number): EditDraft['participants'] {
  const centsTotal = Math.max(0, Math.round((Number(totalFromItems) || 0) * 100));

  const eligibleIdx: number[] = [];
  participants.forEach((p, idx) => {
    const uid = (p.userId || '').trim();
    if (uid) eligibleIdx.push(idx);
  });

  if (eligibleIdx.length === 0) return participants;

  const n = eligibleIdx.length;
  const base = Math.floor(centsTotal / n);
  const rem = centsTotal - base * n;

  return participants.map((p, idx) => {
    const pos = eligibleIdx.indexOf(idx);
    if (pos === -1) return p;

    const cents = base + (pos < rem ? 1 : 0);
    return { ...p, amount: cents / 100 };
  });
}

function sameParticipantAmounts(a: EditDraft['participants'], b: EditDraft['participants']): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    if ((a[i].userId || '') !== (b[i].userId || '')) return false;

    const av = a[i].amount;
    const bv = b[i].amount;

    if (av === '' || bv === '') {
      if (av === bv) continue;
      return false;
    }

    if (Math.abs(av - bv) > 1e-9) return false;
  }

  return true;
}

function EditBillModal({
  open,
  onClose,
  bill,
  users,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  bill: Bill | null;
  users: UserRow[];
  onSaved: (updated: Bill) => void;
}) {
  const [draft, setDraft] = useState<EditDraft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && bill) setDraft(toEditDraft(bill));
    if (!open) setDraft(null);
  }, [open, bill]);

  const ownerId = bill ? normalizeId(bill.createdBy) ?? '' : '';
  const isEqualSplit = bill ? String(bill.splitType) === 'equal' : false;
  const totalFromItems = draft ? draft.items.reduce((sum, it) => sum + (Number(it.price) || 0), 0) : 0;
  const participantsKey = draft ? draft.participants.map((p) => p.userId).join('|') : '';

  useEffect(() => {
    if (!open || !bill || !draft) return;
    if (!isEqualSplit || !ownerId) return;

    const nextParticipants = applyEqualSplitAmounts(draft.participants, totalFromItems);
    if (sameParticipantAmounts(draft.participants, nextParticipants)) return;

    setDraft({ ...draft, participants: nextParticipants });
  }, [open, bill, draft, isEqualSplit, ownerId, totalFromItems, participantsKey]);

  if (!open || !bill || !draft) return null;

  const duplicateUserId = (userId: string, idx: number) =>
    draft.participants.some((p, i) => i !== idx && p.userId === userId);

  const handleSave = async () => {
    const cleaned = cleanEditDraft(draft, ownerId);

    if (!cleaned.title) return alert('กรุณากรอก Bill Title');
    if (cleaned.items.length === 0) return alert('กรุณาใส่รายการอาหารอย่างน้อย 1 รายการ');
    if (cleaned.participants.length === 0) return alert('กรุณาใส่ผู้ร่วมบิลอย่างน้อย 1 คน');

    setSaving(true);
    try {
      const res = await fetch(`/api/bills/${bill._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: cleaned.title,
          description: cleaned.description,
          items: cleaned.items,
          participants: cleaned.participants,
          totalPrice: cleaned.items.reduce((sum, it) => sum + it.price, 0),
        }),
      });

      const data = (await res.json()) as { bill?: Bill; error?: string };
      if (!res.ok) return alert(data.error || 'แก้ไขไม่สำเร็จ');

      if (data.bill) onSaved(data.bill);
      onClose();
    } catch (e) {
      console.error(e);
      alert('แก้ไขไม่สำเร็จ: Server error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-xl border overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div>
            <div className="text-lg font-bold text-gray-800">แก้ไขบิล</div>
            <div className="text-xs text-gray-500">แก้ Title / Items / Participants / Description</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-gray-100">
            <XMarkIcon className="h-5 w-5 text-gray-600" />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-auto">
          <div>
            <label className="block text-sm text-gray-800 mb-1">Bill Title</label>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full px-4 py-3 text-gray-500 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
            />
          </div>

          <div className="border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-gray-800">Items</div>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, items: [...draft.items, { items: '', price: '' }] })}
                className="inline-flex items-center text-gray-500 gap-2 px-3 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm"
              >
                <PlusIcon className="h-4 w-4" /> เพิ่มรายการ
              </button>
            </div>

            <div className="space-y-3">
              {draft.items.map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2">
                  <input
                    value={it.items}
                    onChange={(e) => {
                      const next = [...draft.items];
                      next[idx] = { ...next[idx], items: e.target.value };
                      setDraft({ ...draft, items: next });
                    }}
                    placeholder="ชื่ออาหาร"
                    className="col-span-7 px-3 text-gray-500 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                  />
                  <input
                    value={it.price}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = raw === '' ? '' : Number(raw);
                      const next = [...draft.items];
                      next[idx] = { ...next[idx], price: Number.isFinite(val as number) ? (val as number) : '' };
                      setDraft({ ...draft, items: next });
                    }}
                    placeholder="ราคา"
                    type="number"
                    className="col-span-4 px-3 text-gray-500 py-2 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = draft.items.filter((_, i) => i !== idx);
                      setDraft({ ...draft, items: next.length ? next : [{ items: '', price: '' }] });
                    }}
                    className="col-span-1 px-2 py-2 rounded-xl hover:bg-gray-100"
                    title="ลบรายการ"
                  >
                    <TrashIcon className="h-5 w-5 text-gray-500" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-3 text-sm text-gray-700">
              รวมจากรายการ: <span className="font-semibold">{formatMoneyTHB(totalFromItems)}</span>
            </div>
          </div>

          <div className="border rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-gray-800">Participants</div>
              <button
                type="button"
                onClick={() => setDraft({ ...draft, participants: [...draft.participants, { userId: '', name: '', amount: '' }] })}
                className="inline-flex items-center gap-2 px-3 py-2 text-gray-500 rounded-xl bg-gray-100 hover:bg-gray-200 text-sm"
              >
                <PlusIcon className="h-4 w-4" /> เพิ่มคน
              </button>
            </div>

            <div className="space-y-3">
              {draft.participants.map((p, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <select
                    value={p.userId}
                    onChange={(e) => {
                      const userId = e.target.value;
                      const u = users.find((x) => x._id === userId);
                      const next = [...draft.participants];
                      next[idx] = {
                        ...next[idx],
                        userId,
                        name: u?.name ?? next[idx].name,
                      };
                      setDraft({ ...draft, participants: next });
                    }}
                    className={`col-span-4 px-3 py-2 border text-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00] ${p.userId && duplicateUserId(p.userId, idx) ? 'border-red-400' : ''
                      }`}
                  >
                    <option value="">-- เลือกผู้ใช้ --</option>
                    {users
                      .filter((u) => !draft.participants.some((pp, i) => i !== idx && pp.userId === u._id))
                      .map((u) => (
                        <option key={u._id} value={u._id}>
                          {u.name} ({u.email})
                        </option>
                      ))}
                  </select>

                  <input
                    value={p.name}
                    onChange={(e) => {
                      const next = [...draft.participants];
                      next[idx] = { ...next[idx], name: e.target.value };
                      setDraft({ ...draft, participants: next });
                    }}
                    placeholder="ชื่อที่แสดง"
                    className="col-span-4 px-3 py-2 border text-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                  />

                  <input
                    value={p.amount}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const val = raw === '' ? '' : Number(raw);
                      const next = [...draft.participants];
                      next[idx] = { ...next[idx], amount: Number.isFinite(val as number) ? (val as number) : '' };
                      setDraft({ ...draft, participants: next });
                    }}
                    placeholder="ยอดที่ต้องจ่าย"
                    type="number"
                    className="col-span-3 px-3 py-2 border text-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
                  />

                  <button
                    type="button"
                    onClick={() => {
                      const next = draft.participants.filter((_, i) => i !== idx);
                      setDraft({ ...draft, participants: next.length ? next : [{ userId: '', name: '', amount: '' }] });
                    }}
                    className="col-span-1 px-2 py-2 rounded-xl hover:bg-gray-100"
                    title="ลบคน"
                  >
                    <TrashIcon className="h-5 w-5 text-gray-500" />
                  </button>

                  {p.userId && duplicateUserId(p.userId, idx) ? (
                    <div className="col-span-12 text-xs text-red-500">* เลือก user ซ้ำ (กรุณาเลือกใหม่)</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-600 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className="w-full px-4 py-3 border text-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#fb8c00]"
              rows={3}
            />
          </div>
        </div>

        <div className="px-5 py-4 border-t flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl border bg-white hover:bg-gray-50" disabled={saving}>
            ยกเลิก
          </button>
          <button type="button" onClick={handleSave} className="px-4 py-2 rounded-xl bg-[#fb8c00] text-white font-semibold hover:bg-[#e65100]" disabled={saving}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** ------------------ Page ------------------ */

export default function HistoryPage() {
  const { data: session, status: sessionStatus } = useSession();
  const myId = (session?.user as { id?: string } | undefined)?.id;

  const [activeTab, setActiveTab] = useState<'all' | 'my'>('all');
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);

  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [dateFilter, setDateFilter] = useState<'all' | '7d' | '30d' | 'year'>('all');

  const [page, setPage] = useState(1);
  const pageSize = 8;

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // ✅ สำหรับ Edit modal
  const [users, setUsers] = useState<UserRow[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editBill, setEditBill] = useState<Bill | null>(null);

  // ✅ Bill detail cache (เอาไว้ดู slipInfo)
  const [detailById, setDetailById] = useState<Record<string, Bill>>({});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);

  // ✅ Slip modal
  const [slipModal, setSlipModal] = useState<{
    name: string;
    imageUrl: string;
    reference?: string;
    checkedAt?: string;
    verified?: boolean;
  } | null>(null);

  useEffect(() => {
    const fetchBills = async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/bills');
        if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
        const data: unknown = await res.json();
        const list = Array.isArray(data) ? (data as Bill[]) : (data as { bills?: Bill[] })?.bills ?? [];
        setBills(list);
      } catch (err) {
        console.error('Error fetching bills:', err);
        setBills([]);
      } finally {
        setLoading(false);
      }
    };

    fetchBills();
  }, []);

  const ensureBillDetail = async (billId: string) => {
    if (detailById[billId]) return;

    setDetailLoadingId(billId);
    try {
      const res = await fetch(`/api/bills/${billId}`, { cache: 'no-store' });
      const json: unknown = await res.json();

      if (!res.ok) {
        const msg =
          isObject(json) && typeof (json as { error?: unknown }).error === 'string'
            ? (json as { error: string }).error
            : `Failed to load bill detail (${res.status})`;
        throw new Error(msg);
      }

      if (!isBillResponse(json)) throw new Error('Invalid API response shape');
      setDetailById((prev) => ({ ...prev, [billId]: json.bill }));
    } catch (e) {
      console.error(e);
    } finally {
      setDetailLoadingId(null);
    }
  };

  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const res = await fetch('/api/users');
        if (!res.ok) return;
        const data = (await res.json()) as UserRow[] | { users?: UserRow[] };
        const list = Array.isArray(data) ? data : data.users ?? [];
        setUsers(list);
      } catch (e) {
        console.error(e);
      }
    };
    fetchUsers();
  }, []);

  const filtered = useMemo(() => {
    const now = Date.now();

    const inDateRange = (iso: string) => {
      if (dateFilter === 'all') return true;
      const d = new Date(iso);
      const t = d.getTime();
      if (Number.isNaN(t)) return false;

      if (dateFilter === '7d') return now - t <= 7 * 24 * 60 * 60 * 1000;
      if (dateFilter === '30d') return now - t <= 30 * 24 * 60 * 60 * 1000;

      return d.getFullYear() === new Date().getFullYear();
    };

    const inTab = (bill: Bill) => {
      const createdById = normalizeId(bill.createdBy);
      if (activeTab === 'my') return !!myId && createdById === myId;

      const isCreator = !!myId && createdById === myId;
      const isParticipant = !!myId && bill.participants.some((p) => normalizeId(p.userId) === myId);

      return isCreator || isParticipant || !myId;
    };

    const matchSearch = (bill: Bill) => {
      const keyword = q.trim().toLowerCase();
      if (!keyword) return true;

      const createdByObj = typeof bill.createdBy === 'object' ? bill.createdBy : undefined;
      const createdByName = createdByObj?.name ?? '';
      const participantsNames = bill.participants.map((p) => p.name).join(' ');

      const haystack = `${bill.title} ${bill.totalPrice} ${bill.splitType} ${createdByName} ${participantsNames}`.toLowerCase();
      return haystack.includes(keyword);
    };

    const matchStatus = (bill: Bill) => {
      if (statusFilter === 'all') return true;

      const createdById = normalizeId(bill.createdBy);
      const isCreator = !!myId && createdById === myId;

      const s = isCreator ? getBillStatus(bill) : getMyStatus(bill, myId);
      return s === statusFilter;
    };

    return bills
      .filter(inTab)
      .filter((b) => inDateRange(b.createdAt))
      .filter(matchSearch)
      .filter(matchStatus)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [activeTab, bills, dateFilter, myId, q, statusFilter]);

  useEffect(() => setPage(1), [activeTab, q, statusFilter, dateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleDelete = async (billId: string) => {
    if (!confirm('ยืนยันลบบิลนี้?')) return;
    try {
      const res = await fetch(`/api/bills/${billId}`, { method: 'DELETE' });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) return alert(data.error || 'ลบไม่สำเร็จ');

      setBills((prev) => prev.filter((b) => b._id !== billId));
      setExpandedId((prev) => (prev === billId ? null : prev));
    } catch (e) {
      console.error(e);
      alert('ลบไม่สำเร็จ: Server error');
    }
  };

  const openEdit = (bill: Bill) => {
    setEditBill(bill);
    setEditOpen(true);
  };

  const onSaved = (updated: Bill) => {
    setBills((prev) => prev.map((b) => (b._id === updated._id ? updated : b)));
    setDetailById((prev) => ({ ...prev, [updated._id]: updated })); // กันข้อมูล detail เก่า
  };

  const toggleExpanded = async (billId: string) => {
    const willOpen = expandedId !== billId;
    setExpandedId(willOpen ? billId : null);
    if (willOpen) await ensureBillDetail(billId);
  };

  if (sessionStatus === 'loading') return <div className="p-6">⏳ กำลังโหลด session...</div>;
  if (!session) return <p className="p-4 text-red-500">กรุณาเข้าสู่ระบบเพื่อดูประวัติ</p>;

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      {/* Slip Modal */}
      {slipModal ? (
        <div className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <div className="text-lg font-bold text-gray-800">สลิปของ {slipModal.name}</div>
                <div className="text-xs text-gray-500">
                  {slipModal.reference ? `ref: ${slipModal.reference}` : ''}
                  {slipModal.checkedAt ? ` • ${formatDateTimeTH(slipModal.checkedAt)}` : ''}
                </div>
              </div>
              <button onClick={() => setSlipModal(null)} className="p-2 rounded-xl hover:bg-gray-100">
                <XMarkIcon className="h-5 w-5 text-gray-600" />
              </button>
            </div>

            <div className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <span className="text-sm text-gray-600">สถานะตรวจสอบ:</span>
                <span className={`text-sm font-semibold ${slipModal.verified ? 'text-green-700' : 'text-red-600'}`}>
                  {slipModal.verified ? 'Verified' : 'Not verified'}
                </span>
              </div>

              <div className="rounded-2xl border overflow-hidden bg-gray-50">
                <img
                  src={slipModal.imageUrl}
                  alt="slip"
                  className="w-3/4 h-84 object-center object-contain mx-auto py-1"
                />
              </div>

              <div className="mt-4 text-right">
                <a
                  href={slipModal.imageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center text-gray-800 px-4 py-2 rounded-xl border bg-white hover:bg-gray-50 text-sm"
                >
                  เปิดภาพในแท็บใหม่
                </a>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* Top Bar */}
      <div className="sticky top-0 z-10 bg-white border-b">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div>
              <h1 className="text-xl font-bold text-[#4a4a4a]">ประวัติ/สถานะบิล</h1>
            </div>
          </div>
        </div>
      </div>

      <EditBillModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        bill={editBill}
        users={users}
        onSaved={onSaved}
      />

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex items-center gap-6 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`pb-2 text-sm font-semibold ${activeTab === 'all' ? 'text-[#fb8c00] border-b-2 border-[#fb8c00]' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            All Bills
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('my')}
            className={`pb-2 text-sm font-semibold ${activeTab === 'my' ? 'text-[#fb8c00] border-b-2 border-[#fb8c00]' : 'text-gray-500 hover:text-gray-700'
              }`}
          >
            My Bills
          </button>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-2xl shadow-sm border p-4 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search by amount, group..."
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fb8c00] placeholder-gray-500 text-sm text-gray-800"
              />
            </div>

            <div className="relative">
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as typeof dateFilter)}
                className="w-full rounded-xl border px-4 py-3 text-sm text-gray-800 border-gray-300 outline-none focus:ring-2 focus:ring-[#fb8c00] appearance-none"
              >
                <option value="all">Filter by Date (All)</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="year">This year</option>
              </select>
              <ChevronDownIcon className="h-4 w-4 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            <div className="relative">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="w-full rounded-xl border px-4 py-3 text-sm text-gray-800 border-gray-300 outline-none focus:ring-2 focus:ring-[#fb8c00] appearance-none"
              >
                <option value="all">Filter by Status (All)</option>
                <option value="unpaid">Unpaid</option>
                <option value="pending">Pending</option>
                <option value="paid">Paid</option>
              </select>
              <ChevronDownIcon className="h-4 w-4 text-gray-400 absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="text-left px-5 py-4 font-semibold">Date</th>
                  <th className="text-left px-5 py-4 font-semibold">Total Amount</th>
                  <th className="text-left px-5 py-4 font-semibold">Your Share</th>
                  <th className="text-left px-5 py-4 font-semibold">Biller</th>
                  <th className="text-left px-5 py-4 font-semibold">Status</th>
                  <th className="text-right px-5 py-4 font-semibold">Actions</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                      ⏳ กำลังโหลด...
                    </td>
                  </tr>
                ) : paged.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-gray-500">
                      ไม่พบบิล
                    </td>
                  </tr>
                ) : (
                  paged.map((bill) => {
                    const billId = String(bill._id);

                    const createdById = normalizeId(bill.createdBy);
                    const createdByObj = typeof bill.createdBy === 'object' ? bill.createdBy : undefined;

                    const isCreator = !!myId && createdById === myId;
                    const me = getMyParticipant(bill, myId);
                    const isParticipant = !!me;

                    const billerName = myId && createdById === myId ? 'You' : createdByObj?.name ?? 'Unknown';
                    const myShare = getMyShare(bill, myId);

                    const myStatus = getMyStatus(bill, myId);
                    const billStatus = getBillStatus(bill);
                    const statusToShow = isCreator ? billStatus : myStatus;

                    const showPayNow = isParticipant && !isCreator && myStatus === 'unpaid';

                    const open = expandedId === billId;

                    const ownerId = normalizeId(bill.createdBy);
                    const others = bill.participants.filter((p) => normalizeId(p.userId) !== ownerId);
                    const paidCount = others.filter((p) => (normalizeStatus(p.paymentStatus) ?? 'unpaid') === 'paid').length;

                    // ✅ ถ้าเปิดแล้ว ใช้ detail จาก API (จะมี slipInfo ครบกว่า)
                    const detail = detailById[billId] ?? bill;
                    const detailOwnerId = normalizeId(detail.createdBy);
                    const detailIsCreator = !!myId && normalizeId(detail.createdBy) === myId;
                    const detailBillStatus = getBillStatus(detail);

                    const viewerIsParticipant =
                      !!myId && detail.participants.some((p) => normalizeId(p.userId) === myId);

                    const canViewSlipSection = detailIsCreator || viewerIsParticipant;

                    const slipTargets = (detail.participants ?? []).filter((p) => {
                      const pid = normalizeId(p.userId);
                      if (!pid) return false;

                      // หัวบิลเห็นทุกคน (ยกเว้น owner)
                      if (detailIsCreator) return pid !== detailOwnerId;

                      // ลูกบิลเห็นเฉพาะตัวเอง
                      return !!myId && pid === myId;
                    });


                    return (
                      <Fragment key={billId}>
                        <tr className="hover:bg-gray-50 transition">
                          <td className="px-5 py-4 text-gray-700">{formatDateTimeTH(bill.createdAt)}</td>
                          <td className="px-5 py-4 text-gray-700">{formatMoneyTHB(bill.totalPrice)}</td>
                          <td className="px-5 py-4 font-semibold text-gray-900">
                            {myShare == null ? '-' : formatMoneyTHB(myShare)}
                          </td>

                          <td className="px-5 py-4 text-gray-700">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{billerName}</span>
                              <span className="text-xs text-gray-400">•</span>
                              <span className="text-xs text-gray-500">{bill.title}</span>

                              {isCreator ? (
                                <span className="ml-2 text-xs text-gray-500">
                                  (ชำระครบ {paidCount}/{others.length})
                                </span>
                              ) : null}
                            </div>
                          </td>

                          <td className="px-5 py-4">
                            <StatusBadge status={statusToShow} />
                            {isCreator ? (
                              <div className="text-[11px] text-gray-400 mt-1">Bill Status</div>
                            ) : (
                              <div className="text-[11px] text-gray-400 mt-1">My Status</div>
                            )}
                          </td>

                          <td className="px-5 py-4">
                            <div className="flex items-center justify-end gap-2">
                              {showPayNow ? (
                                <Link
                                  href={`/bills/${bill._id}/pay`}
                                  className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-[#fb8c00] text-white font-semibold hover:bg-[#e65100] transition"
                                >
                                  Pay Now
                                </Link>
                              ) : null}

                              {isCreator ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openEdit(bill)}
                                    className="p-2 rounded-xl hover:bg-gray-100 transition"
                                    title="Edit"
                                  >
                                    <PencilSquareIcon className="h-5 w-5 text-gray-600" />
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDelete(bill._id)}
                                    className="p-2 rounded-xl hover:bg-gray-100 transition"
                                    title="Delete"
                                  >
                                    <TrashIcon className="h-5 w-5 text-gray-600" />
                                  </button>
                                </>
                              ) : null}

                              <button
                                type="button"
                                onClick={() => void toggleExpanded(billId)}
                                className="p-2 rounded-xl hover:bg-gray-100 transition"
                                title="Details"
                              >
                                <ChevronDownIcon className={`h-5 w-5 text-gray-600 transition ${open ? 'rotate-180' : ''}`} />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {open ? (
                          <tr className="bg-gray-50/60">
                            <td colSpan={6} className="px-5 py-4">
                              {detailLoadingId === billId && !detailById[billId] ? (
                                <div className="text-sm text-gray-500 py-6">⏳ กำลังโหลดรายละเอียดบิล...</div>
                              ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  <div className="bg-white rounded-2xl border p-4">
                                    <div className="flex items-center justify-between">
                                      <div className="font-semibold text-gray-800">รายละเอียดบิล</div>
                                      <StatusBadge status={detailBillStatus} />
                                    </div>
                                    <div className="mt-2 text-sm text-gray-700 space-y-1">
                                      <div>
                                        <span className="text-gray-500">Title:</span> {detail.title}
                                      </div>
                                      <div>
                                        <span className="text-gray-500">Split:</span> {String(detail.splitType)}
                                      </div>
                                      <div>
                                        <span className="text-gray-500">Total:</span> {formatMoneyTHB(detail.totalPrice)}
                                      </div>
                                      {detail.description ? (
                                        <div>
                                          <span className="text-gray-500">Desc:</span> {detail.description}
                                        </div>
                                      ) : null}
                                    </div>
                                  </div>

                                  <div className="bg-white rounded-2xl border p-4">
                                    <div className="font-semibold text-gray-800 mb-2">ผู้ร่วมบิล</div>
                                    <div className="space-y-2">
                                      {detail.participants.map((p, i) => {
                                        const pid = normalizeId(p.userId);
                                        const isOwnerRow = detailOwnerId && pid === detailOwnerId;
                                        const ps = normalizeStatus(p.paymentStatus) ?? 'unpaid';

                                        return (
                                          <div key={`${pid ?? 'x'}-${i}`} className="flex items-center justify-between text-sm">
                                            <div className="text-gray-800">
                                              {p.name}
                                              {isOwnerRow ? <span className="text-xs text-gray-400"> (Owner)</span> : null}
                                            </div>

                                            <div className="flex items-center gap-2">
                                              <span className="text-gray-600">{formatMoneyTHB(p.amount)}</span>
                                              <StatusBadge status={ps} />
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>

                                  {/* ✅ ส่วนดูสลิป (หัวบิลเห็นทุกคน / ลูกบิลเห็นของตัวเอง) */}
                                  {canViewSlipSection ? (
                                    <div className="bg-white rounded-2xl border p-4 md:col-span-2">
                                      <div className="flex items-center justify-between mb-2">
                                        <div className="font-semibold text-gray-800">
                                          {detailIsCreator ? 'สลิปที่อัปโหลด' : 'สลิปของฉัน'}
                                        </div>
                                        <div className="text-xs text-gray-500">
                                          {detailIsCreator ? 'หัวบิล: เห็นสลิปทุกคน' : 'ลูกบิล: เห็นเฉพาะของตัวเอง'}
                                        </div>
                                      </div>

                                      {slipTargets.length === 0 ? (
                                        <div className="text-sm text-gray-500">ไม่พบข้อมูลสลิป</div>
                                      ) : (
                                        <div className="space-y-2">
                                          {slipTargets.map((p, idx) => {
                                            const slip = p.slipInfo;
                                            const hasSlip = !!slip?.imageUrl;

                                            return (
                                              <div key={idx} className="flex items-center justify-between text-sm border rounded-xl px-3 py-2">
                                                <div className="text-gray-800">
                                                  {detailIsCreator ? p.name : 'ฉัน'}
                                                  <div className="text-xs text-gray-500">
                                                    {slip?.reference ? `ref: ${slip.reference}` : 'ยังไม่มี ref'}
                                                    {slip?.checkedAt ? ` • ${formatDateTimeTH(String(slip.checkedAt))}` : ''}
                                                  </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                  <span className={`text-xs font-semibold ${slip?.verified ? 'text-green-700' : 'text-gray-500'}`}>
                                                    {hasSlip ? (slip?.verified ? 'Verified' : 'Uploaded') : 'No Slip'}
                                                  </span>

                                                  {hasSlip ? (
                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        setSlipModal({
                                                          name: detailIsCreator ? p.name : 'ฉัน',
                                                          imageUrl: String(slip.imageUrl),
                                                          reference: slip.reference,
                                                          checkedAt: slip.checkedAt ? String(slip.checkedAt) : undefined,
                                                          verified: slip.verified,
                                                        })
                                                      }
                                                      className="px-3 py-2 rounded-xl border text-gray-900 bg-white hover:bg-gray-50 text-sm"
                                                    >
                                                      ดูสลิป
                                                    </button>
                                                  ) : (
                                                    <span className="text-xs text-gray-400">ยังไม่อัปโหลด</span>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  ) : null}


                                  <div className="bg-white rounded-2xl border p-4 md:col-span-2">
                                    <div className="font-semibold text-gray-800 mb-2">รายการอาหาร</div>
                                    {detail.items && detail.items.length ? (
                                      <div className="divide-y">
                                        {detail.items.map((it, idx) => (
                                          <div key={idx} className="py-2 flex items-center justify-between text-sm">
                                            <div className="text-gray-800">{it.items}</div>
                                            <div className="text-gray-700 font-medium">{formatMoneyTHB(it.price)}</div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-sm text-gray-500">ไม่มีรายการอาหาร</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Footer / Pagination */}
          <div className="flex items-center justify-between px-5 py-4 text-sm text-gray-600 border-t">
            <div>
              Showing{' '}
              <span className="font-semibold">
                {filtered.length === 0 ? 0 : (page - 1) * pageSize + 1}-{Math.min(page * pageSize, filtered.length)}
              </span>{' '}
              of <span className="font-semibold">{filtered.length}</span> results
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-2 rounded-xl border bg-white disabled:opacity-50 hover:bg-gray-50 transition"
              >
                Previous
              </button>

              <div className="px-3 py-2 rounded-xl bg-[#fb8c00] text-white font-semibold">{page}</div>

              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-2 rounded-xl border bg-white disabled:opacity-50 hover:bg-gray-50 transition"
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <p className="text-xs text-gray-500 mt-4">
          * ลูกบิลอ้างอิงจาก <code className="px-1 bg-gray-100 rounded">participants[].paymentStatus</code> ของ “ตัวเอง” / หัวบิลอ้างอิง{' '}
          <code className="px-1 bg-gray-100 rounded">billStatus</code> (Hybrid: ไม่นับหัวบิล)
        </p>
      </div>
    </div>
  );
}
