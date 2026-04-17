"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type OverviewStats = {
  totalUsers: number;
  totalBills: number;
  billsToday: number;
  openBills: number;
  closedBills: number;
  paidBills: number;
  unpaidBills: number;
  pendingBills: number;
};

// ✅ รองรับทั้ง id และ _id (บาง API ส่ง _id)
type BillListItem = {
  id?: string | null;
  _id?: string | null;

  title: string;
  total: number | null;
  splitType: string | null;
  status: string | null;
  owner: { id: string; name: string | null; email: string | null; userId: string | null } | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type UserListItem = {
  id: string;
  name: string;
  email: string;
  userId: string | null;
  role: "user" | "admin";
  bills: number;
  total: number;
};

type ApiOk<T> = { ok: true } & T;
type ApiErr = { ok: false; error: string };

function thb(n: number | null) {
  if (typeof n !== "number") return "-";
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB" }).format(n);
}

function fmtDate(v: unknown) {
  if (!v) return "-";
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 10);
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export default function AdminDashboardClient() {
  const [tab, setTab] = useState<"overview" | "bills" | "users" | "activity">("overview");

  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [bills, setBills] = useState<BillListItem[]>([]);
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [activityRaw, setActivityRaw] = useState<Array<Record<string, unknown>>>([]);

  // filters
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [splitType, setSplitType] = useState("");

  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [selectedOwnerLabel, setSelectedOwnerLabel] = useState<string | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();

    if (selectedOwnerId) params.set("ownerId", selectedOwnerId);

    const qTrim = q.trim();
    if (qTrim) params.set("q", qTrim);

    if (status) params.set("status", status);
    if (splitType) params.set("splitType", splitType);

    params.set("page", "1");
    params.set("limit", "10");
    return params.toString();
  }, [q, status, splitType, selectedOwnerId]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/overview", { cache: "no-store" });
        const json = (await res.json()) as unknown;
        const data = json as ApiOk<{ stats: OverviewStats }> | ApiErr;

        if (data && typeof data === "object" && "ok" in data && (data as { ok: unknown }).ok === true) {
          const okData = data as ApiOk<{ stats: OverviewStats }>;
          setStats(okData.stats ?? null);
        } else {
          setStats(null);
        }
      } catch {
        setStats(null);
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/bills?${queryString}`, { cache: "no-store" });
        const json = (await res.json()) as unknown;
        const data = json as ApiOk<{ items: BillListItem[] }> | ApiErr;

        if (data && typeof data === "object" && "ok" in data && (data as { ok: unknown }).ok === true) {
          const okData = data as ApiOk<{ items: BillListItem[] }>;
          setBills(asArray<BillListItem>((okData as unknown as { items?: unknown }).items));
        } else {
          setBills([]);
        }
      } catch {
        setBills([]);
      }
    })();
  }, [queryString]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/admin/users`, { cache: "no-store" });
        const json = (await res.json()) as unknown;
        const data = json as ApiOk<{ items: UserListItem[] }> | ApiErr;

        if (data && typeof data === "object" && "ok" in data && (data as { ok: unknown }).ok === true) {
          const okData = data as ApiOk<{ items: UserListItem[] }>;
          setUsers(asArray<UserListItem>((okData as unknown as { items?: unknown }).items));
        } else {
          setUsers([]);
        }
      } catch {
        setUsers([]);
      }
    })();
  }, []);

  useEffect(() => {
    if (tab !== "activity") return;

    (async () => {
      try {
        const res = await fetch(`/api/admin/activity?page=1&limit=20`, { cache: "no-store" });
        const json = (await res.json()) as unknown;
        const data = json as ApiOk<{ items: Array<Record<string, unknown>> }> | ApiErr;

        if (data && typeof data === "object" && "ok" in data && (data as { ok: unknown }).ok === true) {
          const okData = data as ApiOk<{ items: Array<Record<string, unknown>> }>;
          setActivityRaw(asArray<Record<string, unknown>>((okData as unknown as { items?: unknown }).items));
        } else {
          setActivityRaw([]);
        }
      } catch {
        setActivityRaw([]);
      }
    })();
  }, [tab]);

  const clearFilters = () => {
    setQ("");
    setStatus("");
    setSplitType("");
    setSelectedOwnerId(null);
    setSelectedOwnerLabel(null);
  };

  return (
    <div className="min-h-screen bg-[#fff7ee] p-6">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>

          <div className="flex rounded-xl bg-white p-1 shadow-sm ring-1 ring-gray-100">
            {[
              { k: "overview", t: "Overview" },
              { k: "bills", t: "Bills" },
              { k: "users", t: "Users" },
              { k: "activity", t: "Activity" },
            ].map((x) => (
              <button
                key={x.k}
                onClick={() => setTab(x.k as typeof tab)}
                className={[
                  "rounded-lg px-4 py-2 text-sm font-medium transition",
                  tab === x.k ? "bg-orange-100 text-orange-700" : "text-gray-600 hover:bg-gray-50",
                ].join(" ")}
              >
                {x.t}
              </button>
            ))}
          </div>
        </div>

        {tab === "overview" && (
          <div className="mt-6 space-y-6">
            {/* Row 1: General counts */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard title="Users" value={stats?.totalUsers ?? 0} color="orange" />
              <StatCard title="Total Bills" value={stats?.totalBills ?? 0} color="orange" />
              <StatCard title="Bills Today" value={stats?.billsToday ?? 0} color="orange" />
            </div>

            {/* Row 2: Status breakdown */}
            <div className="grid gap-4 sm:grid-cols-3">
              <StatCard title="Paid" value={stats?.paidBills ?? 0} color="green" />
              <StatCard title="Unpaid" value={stats?.unpaidBills ?? 0} color="red" />
              <StatCard title="Pending" value={stats?.pendingBills ?? 0} color="yellow" />
            </div>

            <Section title="Latest Bills (คลิก แก้ไขบิล เพื่อดูรายละเอียดและยอดเงิน)">
              <BillsTable bills={Array.isArray(bills) ? bills.slice(0, 10) : []} hideTotal />
            </Section>
          </div>
        )}

        {tab === "bills" && (
          <div className="mt-6 space-y-4">
            <Section title="Bills (ค้นหา/กรอง)">
              <div className="grid gap-3 md:grid-cols-4">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ค้นหา title / email / userId"
                  className="w-full rounded-xl border border-gray-200 text-black bg-white px-4 py-2 text-sm outline-none focus:border-orange-300"
                />
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white text-black px-4 py-2 text-sm outline-none focus:border-orange-300"
                >
                  <option value="">ทุกสถานะ</option>
                  <option value="unpaid">unpaid</option>
                  <option value="pending">pending</option>
                  <option value="paid">paid</option>
                </select>
                <select
                  value={splitType}
                  onChange={(e) => setSplitType(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 text-black bg-white px-4 py-2 text-sm outline-none focus:border-orange-300"
                >
                  <option value="">ทุกวิธีหาร</option>
                  <option value="equal">equal</option>
                  <option value="percentage">percentage</option>
                  <option value="personal">personal</option>
                </select>

                <button
                  onClick={clearFilters}
                  className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-600"
                >
                  ล้างตัวกรอง
                </button>
              </div>

              {selectedOwnerLabel && (
                <div className="mt-3 text-sm text-gray-600">
                  กรองบิลของ: <span className="font-semibold text-orange-700">{selectedOwnerLabel}</span>{" "}
                  <button
                    className="ml-2 underline"
                    onClick={() => {
                      setSelectedOwnerId(null);
                      setSelectedOwnerLabel(null);
                    }}
                  >
                    ยกเลิก
                  </button>
                </div>
              )}

              <div className="mt-4">
                <BillsTable bills={Array.isArray(bills) ? bills : []} />
              </div>
            </Section>
          </div>
        )}

        {tab === "users" && (
          <div className="mt-6 space-y-4">
            <Section title="Users (คลิกเพื่อกรองบิลของ user)">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="text-gray-500">
                    <tr>
                      <th className="py-2">Name</th>
                      <th>Email</th>
                      <th>UserId</th>
                      <th>Role</th>
                      <th className="text-right">Bills</th>
                      <th className="text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(Array.isArray(users) ? users : []).map((u) => (
                      <tr key={u.id} className="text-gray-800">
                        <td className="py-3">{u.name}</td>
                        <td>{u.email}</td>
                        <td>{u.userId ?? "-"}</td>
                        <td>
                          <span className={u.role === "admin" ? "text-orange-700 font-semibold" : "text-gray-600"}>
                            {u.role}
                          </span>
                        </td>
                        <td className="text-right">{u.bills}</td>
                        <td className="text-right space-x-2">
                          <button
                            onClick={() => {
                              setTab("bills");
                              setSelectedOwnerId(u.id);
                              setSelectedOwnerLabel(`${u.name} (${u.email})`);
                            }}
                            className="rounded-lg bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200"
                          >
                            ดูบิล
                          </button>

                          <Link
                            href={`/admin/users/${u.id}`}
                            className="inline-flex rounded-lg bg-white px-3 py-1 text-xs font-semibold text-orange-700 ring-1 ring-orange-200 hover:bg-orange-50"
                          >
                            แก้ไขผู้ใช้
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </div>
        )}

        {tab === "activity" && (
          <div className="mt-6 space-y-4">
            <Section title="Activity Logs (ประวัติการทำงาน)">
              <div className="space-y-2">
                {(Array.isArray(activityRaw) ? activityRaw : []).length === 0 && (
                  <div className="text-sm text-gray-500">ยังไม่มีข้อมูล log</div>
                )}

                {(Array.isArray(activityRaw) ? activityRaw : []).map((row, idx) => (
                  <pre
                    key={idx}
                    className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-700 ring-1 ring-gray-100"
                  >
                    {JSON.stringify(row, null, 2)}
                  </pre>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

const statColorMap: Record<string, { bar: string; badge: string; text: string }> = {
  orange: { bar: "bg-orange-500", badge: "bg-orange-50 text-orange-700", text: "text-gray-900" },
  green:  { bar: "bg-green-500",  badge: "bg-green-50 text-green-700",   text: "text-green-800" },
  red:    { bar: "bg-red-400",    badge: "bg-red-50 text-red-700",       text: "text-red-800"   },
  yellow: { bar: "bg-yellow-400", badge: "bg-yellow-50 text-yellow-700", text: "text-yellow-800" },
};

function StatCard(props: { title: string; value: number; color?: string }) {
  const c = statColorMap[props.color ?? "orange"];
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-100">
      <div className="text-xs font-medium text-gray-500">{props.title}</div>
      <div className={`mt-2 text-2xl font-bold ${c.text}`}>{props.value}</div>
      <div className={`mt-2 h-1 w-16 rounded-full ${c.bar}`} />
    </div>
  );
}

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
      <div className="mb-4 text-base font-semibold text-gray-900">{props.title}</div>
      {props.children}
    </div>
  );
}

function BillsTable({ bills, hideTotal }: { bills: BillListItem[]; hideTotal?: boolean }) {
  const rows = Array.isArray(bills) ? bills : [];

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <thead className="text-gray-500">
          <tr>
            <th className="py-2">Title</th>
            <th>Owner</th>
            <th>Status</th>
            <th>Split</th>
            {!hideTotal && <th className="text-right">Total</th>}
            <th>Created</th>
            <th className="text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((b, idx) => {
            const billId = (b.id ?? b._id ?? "").trim();

            return (
              <tr key={billId || `${b.title}_${idx}`} className="text-gray-800">
                <td className="py-3 font-medium">{b.title}</td>
                <td className="text-gray-600">
                  <div>{b.owner?.name ?? "-"}</div>
                  <div className="text-xs">{b.owner?.email ?? ""}</div>
                </td>
                <td>
                  <span className="rounded-full bg-orange-50 px-2 py-1 text-xs font-semibold text-orange-700">
                    {b.status ?? "-"}
                  </span>
                </td>
                <td className="text-gray-600">{b.splitType ?? "-"}</td>
                {!hideTotal && <td className="text-right font-semibold">{thb(b.total)}</td>}
                <td className="text-gray-600 text-xs">{fmtDate(b.createdAt)}</td>

                <td className="text-right">
                  {billId ? (
                    <Link
                      href={`/admin/bills/${encodeURIComponent(billId)}`}
                      className="inline-flex rounded-lg bg-orange-100 px-3 py-1 text-xs font-semibold text-orange-700 hover:bg-orange-200"
                    >
                      แก้ไขบิล
                    </Link>
                  ) : (
                    <span className="text-xs text-gray-400">ไม่มี id</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rows.length === 0 && <div className="py-6 text-center text-sm text-gray-500">ไม่พบข้อมูลบิล</div>}
    </div>
  );
}