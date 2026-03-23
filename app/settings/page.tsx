'use client';

import { ReactNode, useEffect, useState, useMemo,Suspense, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import {
  BellIcon,
  ChevronRightIcon,
  KeyIcon,
  UserCircleIcon,
  UserIcon,
} from '@heroicons/react/24/outline';
import { ClipboardIcon, CheckIcon } from '@heroicons/react/24/outline';
import { useSearchParams } from 'next/navigation';

type TabKey = 'profile' | 'password' | 'notifications';

type PatchResOk = { ok: true; message: string };
type PatchResErr = { ok: false; message: string };
type PatchRes = PatchResOk | PatchResErr;



type Profile = {
  name: string;
  email: string;
  bank: string;
  bankAccountNumber: string;
  promptPayPhone: string;
  role?: 'user' | 'admin';
};

type ProfileGetOk = { ok: true; profile: Profile };
type ProfileGetErr = { ok: false; message: string };
type ProfileGetResponse = ProfileGetOk | ProfileGetErr;





function SettingsPageInner() {
  const { data: session } = useSession();
  const userName = session?.user?.name ?? 'User';
  const userEmail = session?.user?.email ?? '—';

  const searchParams = useSearchParams();

  const initialTab = useMemo<TabKey>(() => {
    return searchParams.get('tab') === 'notifications' ? 'notifications' : 'profile';
  }, [searchParams]);

  const [tab, setTab] = useState<TabKey>(initialTab);


  return (
    <div className="min-h-screen bg-[#fbf7f1]">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-black/5">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg">🍊</span>
            </span>
            <span className="font-semibold text-black">Smart Bill Sharing System</span>
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LEFT */}
          <aside className="lg:col-span-4 space-y-6">
            {/* Profile card */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6">
              <div className="flex items-start gap-4">
                <div className="relative">
                  <div className="h-16 w-16 rounded-2xl bg-orange-50 flex items-center justify-center">
                    <UserCircleIcon className="h-12 w-12 text-[#fb8c00]" />
                  </div>
                  <span className="absolute -right-1 -bottom-1 h-7 w-7 rounded-full bg-[#fb8c00] text-white flex items-center justify-center text-xs shadow">
                    ✎
                  </span>
                </div>

                <div className="min-w-0">
                  <div className="font-semibold text-lg text-gray-900 truncate">{userName}</div>
                  <div className=" gap-2text-sm text-gray-500 truncate">{userEmail}</div>
                </div>
              </div>
            </div>



            {/* Settings menu */}
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-3">
              <div className="px-3 py-2 text-sm font-semibold text-gray-700">Settings</div>

              <MenuItem
                active={tab === 'password'}
                icon={<KeyIcon className="h-5 w-5" />}
                title="เปลี่ยนรหัสผ่าน"
                onClick={() => setTab('password')}
              />
              <MenuItem
                active={tab === 'profile'}
                icon={<UserIcon className="h-5 w-5" />}
                title="จัดการบัญชีผู้ใช้"
                onClick={() => setTab('profile')}
              />
              <MenuItem
                active={tab === 'notifications'}
                icon={<BellIcon className="h-5 w-5" />}
                title={
                  <span className="inline-flex items-center gap-1">
                    จัดการแจ้งเตือน <span className="text-green-600">(LINE)</span>
                  </span>
                }
                onClick={() => setTab('notifications')}
              />
            </div>
          </aside>

          {/* RIGHT */}
          <section className="lg:col-span-8">
            <div className="bg-white rounded-2xl border border-black/5 shadow-sm p-6">
              {tab === 'password' && <ChangePasswordCard />}
              {tab === 'profile' && <AccountInfoCard />}
              {tab === 'notifications' && <NotificationsCard />}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function MenuItem({
  active,
  icon,
  title,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full flex items-center justify-between rounded-xl px-3 py-3 transition',
        active ? 'bg-orange-50 text-[#e65100]' : 'hover:bg-gray-50 text-gray-700',
      ].join(' ')}
    >
      <div className="flex items-center gap-3">
        <span className={active ? 'text-[#fb8c00]' : 'text-gray-500'}>{icon}</span>
        <span className="text-sm font-medium">{title}</span>
      </div>
      <ChevronRightIcon className="h-4 w-4 text-gray-400" />
    </button>
  );
}





/** ✅ Change Password UI (เรียก API จริง) */
function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (!currentPassword || !newPassword || !confirm) {
      setMsg({ type: 'err', text: 'กรุณากรอกข้อมูลให้ครบ' });
      return;
    }
    if (newPassword.length < 8) {
      setMsg({ type: 'err', text: 'รหัสผ่านใหม่ควรมีอย่างน้อย 8 ตัวอักษร' });
      return;
    }
    if (newPassword !== confirm) {
      setMsg({ type: 'err', text: 'ยืนยันรหัสผ่านใหม่ไม่ตรงกัน' });
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/account/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json()) as PatchRes;
      if (!res.ok || !data.ok) {
        setMsg({ type: 'err', text: data.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ' });
        return;
      }

      setMsg({ type: 'ok', text: data.message || 'เปลี่ยนรหัสผ่านสำเร็จ' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirm('');
    } catch {
      setMsg({ type: 'err', text: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-xl border text-gray-900 border-gray-500 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white text-sm';

  return (
    <div>
      <div className="font-semibold text-gray-900">Change Password</div>
      <p className="text-sm text-gray-500 mt-1">เพื่อความปลอดภัย กรุณาใส่รหัสผ่านเดิมก่อนตั้งรหัสใหม่</p>

      <form onSubmit={onSubmit} className="mt-5 space-y-4 max-w-xl">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700 ml-1">Current Password</label>
          <input
            type="password"
            className={inputClass}
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700 ml-1">New Password</label>
          <input
            type="password"
            className={inputClass}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="อย่างน้อย 8 ตัว"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-900 ml-1">Confirm New Password</label>
          <input
            type="password"
            className={inputClass}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="พิมพ์อีกครั้ง"
          />
        </div>

        {msg && (
          <div
            className={[
              'rounded-xl px-4 py-3 text-sm font-medium border',
              msg.type === 'ok'
                ? 'bg-green-50 text-green-700 border-green-100'
                : 'bg-red-50 text-red-600 border-red-100',
            ].join(' ')}
          >
            {msg.text}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className={[
            'w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-white transition',
            'bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]',
            'shadow-lg shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 active:scale-[0.98]',
            loading ? 'opacity-60 cursor-not-allowed hover:translate-y-0' : '',
          ].join(' ')}
        >
          {loading ? 'Saving...' : 'Save Password'}
        </button>
      </form>
    </div>
  );
}

/** (UI เฉย ๆ) */
function AccountInfoCard() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState(''); // read-only
  const [bank, setBank] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [promptPayPhone, setPromptPayPhone] = useState('');

  const inputClass =
    'w-full px-4 py-3 rounded-xl text-gray-900 border border-gray-400 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white text-sm';

  const inputClass2 =
    'w-full px-4 py-3 rounded-xl text-gray-300 border border-gray-200 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white text-sm';

  const selectClass =
    'w-full px-4 py-3 rounded-xl text-gray-900 border border-gray-400 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white text-sm';

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        const res = await fetch('/api/account/profile', { method: 'GET' });

        const data = (await res.json()) as ProfileGetResponse;

        if (!alive) return;

        if (!res.ok || !data.ok) {
          setMsg({ type: 'err', text: !data.ok ? data.message : 'โหลดข้อมูลไม่สำเร็จ' });
          return;
        }

        setName(data.profile.name ?? '');
        setEmail(data.profile.email ?? '');
        setBank(data.profile.bank ?? '');
        setBankAccountNumber(data.profile.bankAccountNumber ?? '');
        setPromptPayPhone(data.profile.promptPayPhone ?? '');
      } catch {
        if (!alive) return;
        setMsg({ type: 'err', text: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);


  const onSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (!name || !bank || !bankAccountNumber) {
      setMsg({ type: 'err', text: 'กรุณากรอกข้อมูลให้ครบ' });
      return;
    }

    if (!/^\d{10}$/.test(bankAccountNumber)) {
      setMsg({ type: 'err', text: 'กรุณากรอกเลขบัญชี/เบอร์โทร 10 หลัก (ตัวเลขเท่านั้น)' });
      return;
    }

    if (!/^0\d{9}$/.test(promptPayPhone)) {
      setMsg({ type: 'err', text: 'กรุณากรอกเบอร์พร้อมเพย์ 10 หลัก (ตัวเลขเท่านั้น)' });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, bank, bankAccountNumber, promptPayPhone }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };

      if (!res.ok || !data.ok) {
        setMsg({ type: 'err', text: data.message || 'บันทึกไม่สำเร็จ' });
        return;
      }

      setMsg({ type: 'ok', text: data.message || 'บันทึกข้อมูลสำเร็จ' });
    } catch {
      setMsg({ type: 'err', text: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="font-semibold text-gray-900">Account Info</div>
      <p className="text-sm text-gray-500 mt-1">แก้ไขข้อมูลบัญชีผู้ใช้ (ชื่อ/ธนาคาร/เลขบัญชีหรือเบอร์โทร)</p>

      {loading ? (
        <div className="mt-5 text-sm text-gray-500">Loading...</div>
      ) : (
        <form onSubmit={onSave} className="mt-5 space-y-4 max-w-xl">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 ml-1">Name</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 ml-1">Email (read-only)</label>
            <input className={inputClass2} value={email} readOnly />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 ml-1">Bank</label>
            <select className={selectClass} value={bank} onChange={(e) => setBank(e.target.value)}>
              <option value="" disabled>
                Choose Your Bank
              </option>
              <option value="กสิกรไทย">กสิกรไทย</option>
              <option value="กรุงไทย">กรุงไทย</option>
              <option value="กรุงเทพ">กรุงเทพ</option>
              <option value="ไทยพาณิชย์">ไทยพาณิชย์</option>
              <option value="พร้อมเพย์">พร้อมเพย์</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 ml-1">Account Number / Phone (10 digits)</label>
            <input
              className={inputClass}
              value={bankAccountNumber}
              maxLength={10}
              inputMode="numeric"
              onChange={(e) => setBankAccountNumber(e.target.value)}
              placeholder="เช่น 0123456789"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-700 ml-1">PromptPay Phone (10 digits)</label>
            <input
              className={inputClass}
              value={promptPayPhone}
              maxLength={10}
              inputMode="numeric"
              onChange={(e) => setPromptPayPhone(e.target.value)}
              placeholder="เช่น 0123456789"
            />
          </div>

          {msg && (
            <div
              className={[
                'rounded-xl px-4 py-3 text-sm font-medium border',
                msg.type === 'ok'
                  ? 'bg-green-50 text-green-700 border-green-100'
                  : 'bg-red-50 text-red-600 border-red-100',
              ].join(' ')}
            >
              {msg.text}
            </div>
          )}

          <button
            type="submit"
            disabled={saving}
            className={[
              'w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-white transition',
              'bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]',
              'shadow-lg shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 active:scale-[0.98]',
              saving ? 'opacity-60 cursor-not-allowed hover:translate-y-0' : '',
            ].join(' ')}
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      )}
    </div>
  );
}


function NotificationsCard() {
  type NotificationType =
    | 'BILL_CREATED_OWNER'
    | 'BILL_ADDED_YOU'
    | 'BILL_UPDATED'
    | 'BILL_STATUS_CHANGED'
    | 'BILL_CLOSED'
    | 'DAILY_UNPAID_SUMMARY'
    | 'GROUP_MEMBER_CHANGED'
    | 'GROUP_UPDATED';

  type Settings = {
    enabledTypes: NotificationType[];
    dailySummaryEnabled: boolean;
    dailySummaryHour: number;
    followGroupIds: string[];
  };

  type GetRes = { ok: true; settings: Settings } | { ok: false; message: string };
  type PatchRes = { ok: boolean; message?: string };

  type LineCodeRes = { ok: true; code: string; expiresAt: string } | { ok: false; message: string };

  type LineStatusRes =
    | { ok: true; linked: boolean; lineNotifyEnabled: boolean; linkedAt: string | null }
    | { ok: false; message: string };

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [s, setS] = useState<Settings>({
    enabledTypes: [],
    dailySummaryEnabled: true,
    dailySummaryHour: 9,
    followGroupIds: [],
  });

  // ✅ LINE states
  const [lineLoading, setLineLoading] = useState(false);
  const [lineErr, setLineErr] = useState<string | null>(null);
  const [lineCode, setLineCode] = useState<string | null>(null);
  const [lineExpiresAt, setLineExpiresAt] = useState<string | null>(null);

  const [lineLinked, setLineLinked] = useState(false);
  const [lineChecked, setLineChecked] = useState(false);
  const [linkedAt, setLinkedAt] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);

  const TYPES: Array<{ key: NotificationType; label: string; desc: string }> = [
    { key: 'BILL_CREATED_OWNER', label: 'Bill created (owner)', desc: 'คุณสร้างบิลสำเร็จ พร้อมรายละเอียดบิล' },
    { key: 'BILL_ADDED_YOU', label: 'Added to bill', desc: 'ถูกเพิ่มเข้าบิลใหม่' },
    { key: 'BILL_UPDATED', label: 'Bill updated', desc: 'ชื่อบิล/เมนู/ราคา/ยอด/วิธีหาร/สมาชิกถูกแก้ไข' },
    { key: 'BILL_STATUS_CHANGED', label: 'Payment status changed', desc: 'มีคนจ่าย/อัปโหลดสลิป ทำให้สถานะคุณเปลี่ยน' },
    { key: 'BILL_CLOSED', label: 'Bill closed', desc: 'บิลปิดแล้ว ทุกคนจ่ายครบ' },
    { key: 'DAILY_UNPAID_SUMMARY', label: 'Daily unpaid summary', desc: 'แจ้งเตือนสรุปยอดค้างทุกวัน + ค้างกี่วัน' },
    { key: 'GROUP_MEMBER_CHANGED', label: 'Group members changed', desc: 'เพิ่ม/ลบสมาชิกในกลุ่ม' },
    { key: 'GROUP_UPDATED', label: 'Group updated', desc: 'เปลี่ยนชื่อกลุ่ม/รูปกลุ่ม' },
  ];

  const formatTH = (iso: string) =>
    new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const loadLineStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/line/status', { method: 'GET' });
      const data = (await res.json()) as LineStatusRes;

      if (res.ok && data.ok) {
        setLineLinked(data.linked);
        setLinkedAt(data.linkedAt ?? null);

        if (data.linked) {
          setLineErr(null);
          setLineCode(null);
          setLineExpiresAt(null);
        }
      }
    } finally {
      setLineChecked(true);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);

        const res = await fetch('/api/notifications/settings');
        const data = (await res.json()) as GetRes;

        await loadLineStatus();
        if (!alive) return;

        if (!res.ok || !data.ok) {
          setMsg({ type: 'err', text: !data.ok ? data.message : 'โหลดไม่สำเร็จ' });
          return;
        }

        setS(data.settings);
      } catch {
        if (!alive) return;
        setMsg({ type: 'err', text: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [loadLineStatus]);

  // ✅ ถ้ามี code และยังไม่ linked: polling เช็คสถานะทุก 4 วิ (พอ user ไปพิมพ์ใน LINE แล้วหน้าเว็บจะอัปเดตเอง)
  useEffect(() => {
    if (!lineCode) return;
    if (lineLinked) return;

    const t = setInterval(() => {
      loadLineStatus();
    }, 4000);

    return () => clearInterval(t);
  }, [lineCode, lineLinked, loadLineStatus]);

  const toggleType = (t: NotificationType) => {
    setS((prev) => {
      const has = prev.enabledTypes.includes(t);
      return { ...prev, enabledTypes: has ? prev.enabledTypes.filter((x) => x !== t) : [...prev.enabledTypes, t] };
    });
  };

  const save = async () => {
    setMsg(null);
    setSaving(true);
    try {
      const res = await fetch('/api/notifications/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(s),
      });
      const data = (await res.json()) as PatchRes;

      if (!res.ok || !data.ok) {
        setMsg({ type: 'err', text: data.message || 'บันทึกไม่สำเร็จ' });
        return;
      }
      setMsg({ type: 'ok', text: 'บันทึกการตั้งค่าสำเร็จ' });
    } catch {
      setMsg({ type: 'err', text: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' });
    } finally {
      setSaving(false);
    }
  };

  const requestLineCode = async () => {
    setLineLoading(true);
    setLineErr(null);

    try {
      // ✅ แก้ endpoint ให้ตรงกับของคุณ
      // ถ้าโปรเจกต์คุณใช้ /api/line/link-code ให้เปลี่ยนบรรทัดนี้
      const res = await fetch('/api/line/link-code', { method: 'POST' });
      const data = (await res.json()) as LineCodeRes;

      if (!res.ok || !data.ok) {
        setLineCode(null);
        setLineExpiresAt(null);
        setLineErr(!data.ok ? data.message : 'ขอรหัสไม่สำเร็จ');
        return;
      }

      setLineCode(data.code);
      setLineExpiresAt(data.expiresAt);

      // ✅ หลังขอรหัส ลองเช็คสถานะ 1 ครั้ง
      await loadLineStatus();
    } catch {
      setLineErr('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้');
    } finally {
      setLineLoading(false);
    }
  };

  const copyLineCommand = async () => {
    if (!lineCode) return;
    await navigator.clipboard.writeText(`LINK ${lineCode}`);
    setCopied(true);
    setMsg({ type: 'ok', text: `คัดลอกแล้ว: LINK ${lineCode}` });
    setTimeout(() => setCopied(false), 1500);
  };

  const unlinkLine = async () => {
    if (!confirm("ต้องการยกเลิกการเชื่อม LINE ใช่ไหม?")) return;

    try {
      const res = await fetch("/api/line/unlink", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setMsg({ type: "err", text: data.message ?? "ยกเลิกไม่สำเร็จ" });
        return;
      }

      setMsg({ type: "ok", text: "ยกเลิกการเชื่อม LINE แล้ว" });

      // refresh status
      await loadLineStatus();
    } catch {
      setMsg({ type: "err", text: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้" });
    }
  };

  return (
    <div>
      <div className="font-semibold text-gray-900">Manage Notifications</div>
      <p className="text-sm text-gray-500 mt-1">เลือกเปิด/ปิดประเภทการแจ้งเตือน และตั้งเวลาแจ้งสรุปยอดค้าง</p>

      {loading ? (
        <div className="mt-5 text-sm text-gray-500">Loading...</div>
      ) : (
        <div className="mt-6 space-y-4 max-w-2xl">
          {/* ✅ LINE OA Link */}
          <div className="rounded-xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-green-900">เชื่อม LINE OA <span className="text-green-600">(@610buebz)</span> เพื่อรับแจ้งเตือน</div>

                {lineChecked && lineLinked ? (
                  <div className="text-xs text-green-700 mt-1">
                    ✅ เชื่อมต่อแล้ว {linkedAt ? `(${formatTH(linkedAt)})` : ''}
                    <div className="mt-1">ระบบจะส่งแจ้งเตือนบิลมาที่ LINE นี้อัตโนมัติ</div>
                  </div>
                ) : (
                  <div className="text-xs text-green-700 mt-1">
                    กดขอรหัส แล้วไปพิมพ์ใน LINE OA: <b>LINK xxxxxx</b>
                  </div>
                )}
              </div>

              {/* ปุ่มขอรหัส/รีเฟรช */}
              {lineChecked && lineLinked ? (
                  <button
                    type="button"
                    onClick={unlinkLine}
                    className="px-4 py-2 rounded-xl font-bold border border-red-200 bg-white text-red-600 hover:bg-red-50 transition"
                  >
                    ยกเลิกการเชื่อม
                  </button>
              ) : (
                <button
                  type="button"
                  onClick={requestLineCode}
                  disabled={lineLoading}
                  className={[
                    'px-4 py-2 rounded-xl font-bold text-white transition',
                    'bg-[linear-gradient(135deg,#16a34a_0%,#22c55e_100%)]',
                    'shadow-md shadow-green-200 hover:shadow-green-300 hover:-translate-y-0.5 active:scale-[0.98]',
                    lineLoading ? 'opacity-60 cursor-not-allowed hover:translate-y-0' : '',
                  ].join(' ')}
                >
                  {lineLoading ? 'กำลังขอรหัส...' : 'ขอรหัส LINE'}
                </button>

              )
              }
            </div>

            {lineErr && (
              <div className="mt-3 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-600">
                ❌ {lineErr}
              </div>
            )}

            {/* ถ้ายังไม่เชื่อม และมี code ให้โชว์ */}
            {!lineLinked && lineCode && lineExpiresAt && (
              <div className="mt-4">
                <div className="text-xs text-green-800">รหัสของคุณ (หมดอายุ: {formatTH(lineExpiresAt)})</div>

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <div className="px-4 py-2 rounded-xl bg-white border border-green-200 text-2xl font-extrabold tracking-[0.35em] text-green-900">
                    {lineCode}
                  </div>

                  <button
                    type="button"
                    onClick={copyLineCommand}
                    className={[
                      'inline-flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition',
                      'border border-green-600 bg-green-900 text-white',
                      'hover:bg-green-100 active:scale-[0.98]',
                      'shadow-sm',
                    ].join(' ')}
                  >
                    {copied ? (
                      <>
                        <CheckIcon className="h-5 w-5" />
                        คัดลอกแล้ว
                      </>
                    ) : (
                      <>
                        <ClipboardIcon className="h-5 w-5" />
                        คัดลอก
                      </>
                    )}
                  </button>


                </div>

                <div className="mt-3 text-xs text-green-700 leading-relaxed">
                  ไปที่แชท LINE OA แล้วพิมพ์: <b>LINK {lineCode}</b>
                  <br />
                  * หลังพิมพ์สำเร็จ หน้านี้จะอัปเดตเป็น “เชื่อมต่อแล้ว” อัตโนมัติ
                </div>
              </div>
            )}
          </div>

          {/* Daily summary */}
          <div className="rounded-xl border border-black/5 bg-gray-50 p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold text-gray-900">Daily unpaid summary</div>
                <div className="text-xs text-gray-500 mt-1">แจ้งทุกวันเป็นสรุป: ค้าง X บิล / ยอดรวม X บาท / ค้างกี่วัน</div>
              </div>

              <button
                type="button"
                onClick={() => setS((p) => ({ ...p, dailySummaryEnabled: !p.dailySummaryEnabled }))}
                className={[
                  'h-6 w-11 rounded-full relative transition',
                  s.dailySummaryEnabled ? 'bg-[#fb8c00]' : 'bg-gray-300',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition',
                    s.dailySummaryEnabled ? 'left-5' : 'left-0.5',
                  ].join(' ')}
                />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <label className="text-xs text-gray-600 font-semibold">เวลาแจ้ง (ชั่วโมง)</label>
              <select
                className="px-3 py-2 rounded-xl border border-gray-200 bg-white text-sm"
                value={s.dailySummaryHour}
                onChange={(e) => setS((p) => ({ ...p, dailySummaryHour: Number(e.target.value) }))}
                disabled={!s.dailySummaryEnabled}
              >
                {Array.from({ length: 24 }).map((_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Type toggles */}
          <div className="rounded-xl border border-black/5 bg-white">
            {TYPES.map((t) => {
              const on = s.enabledTypes.includes(t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => toggleType(t.key)}
                  className="w-full px-4 py-4 flex items-center justify-between hover:bg-gray-50 border-b last:border-b-0 border-black/5"
                >
                  <div className="text-left">
                    <div className="text-sm font-semibold text-gray-900">{t.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{t.desc}</div>
                  </div>
                  <span className={on ? 'text-[#fb8c00] font-bold' : 'text-gray-400 font-semibold'}>{on ? 'ON' : 'OFF'}</span>
                </button>
              );
            })}
          </div>

          {msg && (
            <div
              className={[
                'rounded-xl px-4 py-3 text-sm font-medium border',
                msg.type === 'ok'
                  ? 'bg-green-50 text-green-700 border-green-100'
                  : 'bg-red-50 text-red-600 border-red-100',
              ].join(' ')}
            >
              {msg.text}
            </div>
          )}

          <button
            type="button"
            onClick={save}
            disabled={saving}
            className={[
              'w-full sm:w-auto px-6 py-3 rounded-xl font-bold text-white transition',
              'bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]',
              'shadow-lg shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 active:scale-[0.98]',
              saving ? 'opacity-60 cursor-not-allowed hover:translate-y-0' : '',
            ].join(' ')}
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#fbf7f1]" />}>
      <SettingsPageInner />
    </Suspense>
  );
}