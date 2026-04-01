'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  rawToken: string;
  billId: string;
  billStage: 'draft' | 'active';
  myStatus: 'unpaid' | 'pending' | 'paid';
  inviteToken?: string;
};

export default function GuestAccessClient({
  rawToken,
  billStage,
  myStatus,
  inviteToken,
}: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  // ✅ ถ้าหน้า pay เดิมของคุณจะรองรับ guest token
  const payUrl = useMemo(() => {
    const base = `/guest/access/${encodeURIComponent(rawToken)}/pay`;
    if (!inviteToken) return base;
    return `${base}?inviteToken=${encodeURIComponent(inviteToken)}`;
  }, [inviteToken, rawToken]);

  const stableEntryUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    if (!inviteToken) return window.location.href;
    return `${window.location.origin}/i/${encodeURIComponent(inviteToken)}`;
  }, [inviteToken]);

  // ✅ draft -> refresh อัตโนมัติ
  useEffect(() => {
    if (billStage !== 'draft') return;

    const timer = window.setInterval(() => {
      router.refresh();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [billStage, router]);

  // ✅ active + unpaid -> เด้งไป pay
  useEffect(() => {
    if (billStage === 'active' && myStatus === 'unpaid') {
      const t = window.setTimeout(() => {
        router.replace(payUrl);
      }, 1200);

      return () => window.clearTimeout(t);
    }
  }, [billStage, myStatus, payUrl, router]);

  const handleCopyLink = async () => {
    try {
      const target = stableEntryUrl || window.location.href;
      await navigator.clipboard.writeText(target);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('คัดลอกลิงก์ไม่สำเร็จ');
    }
  };

  return (
    
    <div className="mt-6 space-y-3   ">
      
      {billStage === 'draft' ? (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          คุณเข้าร่วมบิลแล้ว ระบบจะรีเฟรชอัตโนมัติทุก 5 วินาที
          เมื่อหัวบิลเปิดบิลแล้ว ระบบจะพาคุณไปหน้าจ่ายเงินอัตโนมัติ
        </div>
      ) : myStatus === 'unpaid' ? (
        <div className="rounded-2xl bg-green-50 p-4 text-sm text-green-800">
          บิลพร้อมแล้ว กำลังพาคุณไปหน้าจ่ายเงิน...
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        {billStage === 'active' && myStatus === 'unpaid' ? (
          <button
            type="button"
            onClick={() => router.push(payUrl)}
            className="rounded-xl bg-[#fb8c00] px-4 py-2 font-semibold text-white hover:bg-[#e65100]"
          >
            ไปหน้าจ่ายเงินตอนนี้
          </button>
        ) : null}

        <button
          type="button"
          onClick={handleCopyLink}
          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50"
        >
          {copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์นี้ไว้จ่ายรอบหน้า'}
        </button>
      </div>
    </div>
  );
}