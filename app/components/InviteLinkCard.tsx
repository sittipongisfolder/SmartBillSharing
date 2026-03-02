'use client';

import { useMemo, useState } from 'react';

type CreateInviteResponse = {
  invitePath: string;
  expiresAt: string; // ISO string
  maxUses: number;
};

type Props = {
  billId: string;
  isOwner: boolean;
};

export default function InviteLinkCard({ billId, isOwner }: Props) {
  const [loading, setLoading] = useState(false);
  const [invitePath, setInvitePath] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteUrl = useMemo(() => {
    if (!invitePath) return null;
    // ฝั่ง client ใช้ origin ได้
    return `${window.location.origin}${invitePath}`;
  }, [invitePath]);

  async function createInvite() {
    try {
      setError(null);
      setCopied(false);
      setLoading(true);

      const res = await fetch(`/api/bills/${billId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresInDays: 7, maxUses: 50 }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Create invite failed (${res.status})`);
      }

      const data: CreateInviteResponse = await res.json();
      setInvitePath(data.invitePath);
      setExpiresAt(data.expiresAt);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (!isOwner) return null;

  return (
    <div className="rounded-2xl bg-white p-6 shadow">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#4a4a4a]">ลิงก์เชิญเพื่อน (Guest)</h2>
          <p className="text-sm text-gray-600">
            ส่งลิงก์นี้ให้เพื่อนเข้าร่วมบิลได้โดยไม่ต้องสมัคร
          </p>
        </div>

        <button
          onClick={createInvite}
          disabled={loading}
          className="rounded-xl bg-[#fb8c00] px-4 py-2 text-sm font-semibold text-white hover:bg-[#e65100] disabled:opacity-60"
        >
          {loading ? 'กำลังสร้าง...' : 'สร้างลิงก์'}
        </button>
      </div>

      {error && (
        <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {inviteUrl && (
        <div className="mt-4 rounded-xl bg-[#f5f5f5] p-4">
          <p className="text-xs text-gray-600">Invite link</p>
          <p className="break-all text-sm font-semibold text-[#4a4a4a]">{inviteUrl}</p>

          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={copy}
              className="rounded-xl border bg-white px-3 py-1.5 text-sm hover:bg-gray-50"
            >
              {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}
            </button>

            {expiresAt && (
              <span className="text-xs text-gray-500">
                หมดอายุ: {new Date(expiresAt).toLocaleString('th-TH')}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
