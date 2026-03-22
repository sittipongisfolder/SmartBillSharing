"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type UserRole = "user" | "admin";

type UserDetail = {
  _id: string;
  name: string;
  email: string;
  role?: UserRole;
  userId?: string | null;
  bank?: string;
  bankAccountNumber?: string;
  promptPayPhone?: string;
};

export default function AdminUserDetailClient() {
  const params = useParams<{ userId: string }>();
  const router = useRouter();
  const userId = params.userId;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [uid, setUid] = useState("");
  const [bank, setBank] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [promptPayPhone, setPromptPayPhone] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      if (!userId) {
        setError("Missing userId in URL");
        setLoading(false);
        return;
      }

      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 10000); // ✅ กันค้าง 10 วิ

      try {
        const res = await fetch(`/api/admin/users/${userId}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        const data = (await res.json()) as { ok: boolean; user?: UserDetail; error?: string };

        if (!data.ok || !data.user) {
          setError(data.error ?? `โหลดผู้ใช้ไม่สำเร็จ (${res.status})`);
          return;
        }

        const u = data.user;
        setName(u.name ?? "");
        setEmail(u.email ?? "");
        setRole((u.role ?? "user") as UserRole);
        setUid(u.userId ?? "");
        setBank(u.bank ?? "");
        setBankAccountNumber(u.bankAccountNumber ?? "");
        setPromptPayPhone(u.promptPayPhone ?? "");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        clearTimeout(t);
        setLoading(false); // ✅ สำคัญ: ยังไงก็ต้องปล่อย loading
      }
    })();
  }, [userId]);

  const onSave = async () => {
    setSaving(true);
    setError(null);

    const payload = { name, email, role, userId: uid, bank, bankAccountNumber, promptPayPhone };

    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const out = (await res.json()) as { ok: boolean; error?: string };
      if (!out.ok) {
        setError(out.error ?? "บันทึกไม่สำเร็จ");
        return;
      }

      router.refresh();
      alert("บันทึกข้อมูลผู้ใช้เรียบร้อย");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-6 text-white">Loading...</div>;

  return (
    <div className="min-h-screen bg-[#fff7ee] p-6">
      <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6 shadow ring-1 ring-gray-100">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">แก้ไขผู้ใช้ (Admin)</h1>
          <button onClick={() => router.push("/admin")} className="text-sm underline text-gray-600">
            กลับหน้า Admin
          </button>
        </div>

        {error && <div className="mt-4 text-sm text-red-600">{error}</div>}

        <div className="mt-6 space-y-4">
          <Field label="Name" value={name} onChange={setName} />
          <Field label="Email" value={email} onChange={setEmail} />

          <div>
            <div className="text-sm font-semibold text-gray-700">Role</div>
            <select
              className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </div>

          <Field label="UserId (for search)" value={uid} onChange={setUid} />
          <Field label="Bank" value={bank} onChange={setBank} />
          <Field label="BankAccountNumber" value={bankAccountNumber} onChange={setBankAccountNumber} />
          <Field label="PromptPayPhone" value={promptPayPhone} onChange={setPromptPayPhone} />

          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-orange-500 px-5 py-3 font-semibold text-white hover:bg-orange-600 disabled:opacity-70"
          >
            {saving ? "Saving..." : "บันทึกการแก้ไข"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="text-sm font-semibold text-gray-700">{props.label}</div>
      <input
        className="mt-1 w-full rounded-xl border border-gray-200 px-4 py-2"
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}