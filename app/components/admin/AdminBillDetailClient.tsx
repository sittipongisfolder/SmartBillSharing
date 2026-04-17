"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type SplitType = "equal" | "percentage" | "personal";
type BillStatus = "unpaid" | "pending" | "paid";
type PaymentStatus = "unpaid" | "pending" | "paid";

type ParticipantRow = {
  _id?: string;
  kind?: string;
  userId?: string;
  guestId?: string;
  name?: string;
  amount: string; // string เพื่อคุม input
  paymentStatus: PaymentStatus;
};

type ApiGetBill = {
  ok: boolean;
  bill?: {
    id: string;
    title?: string | null;
    description?: string | null;
    splitType?: SplitType | null;
    billStatus?: BillStatus | null;
    total?: number | null;
    items?: Array<Record<string, unknown>> | null;
    participants?: Array<Record<string, unknown>> | null;
  };
  error?: string;
};

type ItemRow = {
  id: string;
  name: string;
  qty: string;       // เก็บเป็น string เพื่อคุม input
  unitPrice: string; // ราคา/ชิ้น
};

const makeId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;

const n = (v: string) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

const asNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  }
  return null;
};

const money2 = (v: number) => Math.round(v * 100) / 100;

function normalizeItems(raw: unknown): ItemRow[] {
  const arr = Array.isArray(raw) ? raw : [];

  return arr.map((it) => {
    const r = it as Record<string, unknown>;

    // รองรับหลายชื่อ field: name/items
    const name =
      typeof r.name === "string"
        ? r.name
        : typeof r.items === "string"
          ? r.items
          : "";

    // qty อาจเป็น number/string/undefined
    const qtyVal =
      typeof r.qty === "number"
        ? String(r.qty)
        : typeof r.qty === "string"
          ? r.qty
          : "1";

    // บางระบบเก็บ unit_price / unitPrice / price / line_total เป็น number หรือ string
    const unitPriceFromUnit = asNum(r.unit_price) ?? asNum(r.unitPrice);
    const lineTotalLike = asNum(r.line_total) ?? asNum(r.price) ?? asNum(r.total);

    const qtyNum = Math.max(1, n(qtyVal));
    // ถ้ามี unit_price ใช้เลย
    // ถ้าไม่มี unit_price แต่มี price (อาจเป็น lineTotal) -> สุ่มเดาว่าเป็น lineTotal แล้วหาร qty เป็น unitPrice
    const unitPrice =
      unitPriceFromUnit != null
        ? unitPriceFromUnit
        : lineTotalLike != null
          ? lineTotalLike / qtyNum
          : 0;

    return {
      id: typeof r.id === "string" ? r.id : makeId(),
      name,
      qty: qtyVal,
      unitPrice: String(money2(unitPrice)),
    };
  });
}

export default function AdminBillDetailClient() {
  const router = useRouter();
  const params = useParams();

  const billId =
    typeof (params as Record<string, unknown>).billId === "string"
      ? ((params as Record<string, unknown>).billId as string)
      : Array.isArray((params as Record<string, unknown>).billId)
        ? String(((params as Record<string, unknown>).billId as unknown[])[0] ?? "")
        : "";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [splitType, setSplitType] = useState<SplitType>("equal");
  const [billStatus, setBillStatus] = useState<BillStatus>("unpaid");

  const [items, setItems] = useState<ItemRow[]>([{ id: makeId(), name: "", qty: "1", unitPrice: "0" }]);

  // เก็บ participants แบบ structured
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);

  // ✅ รวมราคาอัตโนมัติจาก items
  const computedTotal = useMemo(() => {
    const sum = items.reduce((acc, it) => acc + n(it.qty) * n(it.unitPrice), 0);
    return money2(sum);
  }, [items]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/admin/bills/${billId}`, { cache: "no-store" });
        const data = (await res.json()) as ApiGetBill;

        if (!data.ok || !data.bill) {
          setError(data.error ?? "โหลดบิลไม่สำเร็จ");
          setLoading(false);
          return;
        }

        const b = data.bill;
        setTitle(b.title ?? "");
        setSplitType((b.splitType ?? "equal") as SplitType);
        setBillStatus((b.billStatus ?? "unpaid") as BillStatus);

        // ✅ items: ถ้า API ส่ง items มา จะเห็นรายการทันที
        const normalized = normalizeItems(b.items ?? []);
        setItems(normalized.length ? normalized : [{ id: makeId(), name: "", qty: "1", unitPrice: "0" }]);

        const raw = Array.isArray(b.participants) ? b.participants as Array<Record<string, unknown>> : [];
        setParticipants(raw.map((p) => ({
          _id: typeof p._id === "string" ? p._id : undefined,
          kind: typeof p.kind === "string" ? p.kind : undefined,
          userId: typeof p.userId === "string" ? p.userId : undefined,
          guestId: typeof p.guestId === "string" ? p.guestId : undefined,
          name: typeof p.name === "string" ? p.name : "-",
          amount: typeof p.amount === "number" ? String(p.amount) : "0",
          paymentStatus: (["unpaid","pending","paid"].includes(String(p.paymentStatus)) ? p.paymentStatus : "unpaid") as PaymentStatus,
        })));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, [billId]);

  const addItem = () => {
    setItems((prev) => [...prev, { id: makeId(), name: "", qty: "1", unitPrice: "0" }]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => (prev.length > 1 ? prev.filter((x) => x.id !== id) : prev));
  };

  const updateItem = (id: string, patch: Partial<ItemRow>) => {
    setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };

  const onSave = async () => {
    setSaving(true);
    setError(null);

    // ✅ แปลง items ให้ส่งแบบ “เข้ากับหลาย schema”
    // - field ใหม่: name/qty/unit_price/line_total
    // - field เก่า: items/qty/price (price = line_total)
    const itemsForSave = items.map((it) => {
      const qtyNum = Math.max(1, n(it.qty));
      const unit = Math.max(0, n(it.unitPrice));
      const lineTotal = money2(qtyNum * unit);

      return {
        id: it.id,
        name: it.name,
        items: it.name,              // เผื่อ schema เก่าใช้ "items"
        qty: qtyNum,
        unit_price: unit,
        line_total: lineTotal,
        price: lineTotal,            // เผื่อ schema เก่าใช้ "price" = lineTotal
      };
    });

    // participants: ใช้ structured state
    const participantsForSave = participants.map((p) => ({
      ...(p._id ? { _id: p._id } : {}),
      ...(p.kind ? { kind: p.kind } : {}),
      ...(p.userId ? { userId: p.userId } : {}),
      ...(p.guestId ? { guestId: p.guestId } : {}),
      name: p.name,
      amount: Math.max(0, n(p.amount)),
      paymentStatus: p.paymentStatus,
    }));

    const payload = {
      title,
      splitType,
      billStatus,
      total: computedTotal, // ✅ รวมจากรายการ
      items: itemsForSave,
      participants: participantsForSave,
    };

    try {
      const res = await fetch(`/api/admin/bills/${billId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const out = (await res.json()) as { ok: boolean; error?: string };
      if (!out.ok) {
        setError(out.error ?? "บันทึกไม่สำเร็จ");
        setSaving(false);
        return;
      }

      router.refresh();
      alert("บันทึกบิลเรียบร้อย");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#fff7ee] p-6">
      <div className="mx-auto max-w-5xl rounded-2xl bg-white  text-black p-6 shadow ring-1 ring-gray-100">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">แก้ไขบิล (Admin)</h1>
          <button onClick={() => router.push("/admin")} className="text-sm underline text-gray-600">
            กลับหน้า Admin
          </button>
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="md:col-span-2">
            <div className="text-sm font-semibold text-gray-700">Title</div>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-gray-900"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-700">Total (Auto)</div>
            <input
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 bg-gray-50 text-gray-900"
              value={computedTotal.toFixed(2)}
              readOnly
            />
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-700">Split Type</div>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-gray-900"
              value={splitType}
              onChange={(e) => setSplitType(e.target.value as SplitType)}
            >
              <option value="equal">equal</option>
              <option value="percentage">percentage</option>
              <option value="personal">personal</option>
            </select>
          </div>

          <div>
            <div className="text-sm font-semibold text-gray-700">Bill Status</div>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2 text-gray-900"
              value={billStatus}
              onChange={(e) => setBillStatus(e.target.value as BillStatus)}
            >
              <option value="unpaid">unpaid</option>
              <option value="pending">pending</option>
              <option value="paid">paid</option>
            </select>
          </div>
        </div>

        {/* ✅ Items table */}
        <div className="mt-8">
          <div className="flex items-center justify-between">
            <div className="text-base font-semibold text-gray-900">รายการสินค้า / เมนู</div>
            <button
              type="button"
              onClick={addItem}
              className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
            >
              + เพิ่มรายการ
            </button>
          </div>

          <div className="mt-3 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-gray-500">
                <tr>
                  <th className="py-2">ชื่อรายการ</th>
                  <th className="w-28">จำนวน</th>
                  <th className="w-36">ราคา/ชิ้น</th>
                  <th className="w-36 text-right">รวม</th>
                  <th className="w-24 text-right">ลบ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((it) => {
                  const lineTotal = money2(n(it.qty) * n(it.unitPrice));
                  return (
                    <tr key={it.id}>
                      <td className="py-3">
                        <input
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                          value={it.name}
                          onChange={(e) => updateItem(it.id, { name: e.target.value })}
                          placeholder="เช่น ข้าวผัด"
                        />
                      </td>
                      <td>
                        <input
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                          value={it.qty}
                          onChange={(e) => updateItem(it.id, { qty: e.target.value })}
                          inputMode="numeric"
                        />
                      </td>
                      <td>
                        <input
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                          value={it.unitPrice}
                          onChange={(e) => updateItem(it.id, { unitPrice: e.target.value })}
                          inputMode="decimal"
                        />
                      </td>
                      <td className="text-right font-semibold">{lineTotal.toFixed(2)}</td>
                      <td className="text-right">
                        <button
                          type="button"
                          onClick={() => removeItem(it.id)}
                          className="rounded-lg border border-gray-200 px-3 py-2 text-xs hover:bg-gray-50"
                        >
                          ลบ
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {items.length === 0 && <div className="py-6 text-center text-sm text-gray-500">ยังไม่มีรายการ</div>}
          </div>
        </div>

        {/* participants table */}
        <div className="mt-8">
          <div className="text-base font-semibold text-gray-900">Participants</div>
          {participants.length === 0 ? (
            <div className="mt-2 text-sm text-gray-500">ไม่มีผู้เข้าร่วม</div>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-2 pr-4">ชื่อ</th>
                    <th className="pr-4">Kind</th>
                    <th className="w-36 pr-4">จำนวนเงิน (฿)</th>
                    <th className="w-40">สถานะการจ่าย</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {participants.map((p, idx) => (
                    <tr key={p._id ?? idx}>
                      <td className="py-3 pr-4 font-medium text-gray-900">{p.name ?? "-"}</td>
                      <td className="pr-4 text-gray-500 text-xs">{p.kind ?? "-"}</td>
                      <td className="pr-4">
                        <input
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                          value={p.amount}
                          inputMode="decimal"
                          onChange={(e) =>
                            setParticipants((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x))
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-gray-900"
                          value={p.paymentStatus}
                          onChange={(e) =>
                            setParticipants((prev) =>
                              prev.map((x, i) =>
                                i === idx ? { ...x, paymentStatus: e.target.value as PaymentStatus } : x
                              )
                            )
                          }
                        >
                          <option value="unpaid">unpaid</option>
                          <option value="pending">pending</option>
                          <option value="paid">paid</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-6">
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-orange-500 px-6 py-3 font-semibold text-white hover:bg-orange-600 disabled:opacity-70"
          >
            {saving ? "Saving..." : "บันทึกการแก้ไข"}
          </button>
        </div>
      </div>
    </div>
  );
}