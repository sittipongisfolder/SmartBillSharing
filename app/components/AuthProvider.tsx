"use client"; // ✅ ทำให้ไฟล์นี้เป็น Client Component

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { SessionProvider } from "next-auth/react";
import { useSession } from "next-auth/react";

function SessionExpiryWatcher() {
  const { status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const hadAuthenticated = useRef(false);
  const hasHandledExpiry = useRef(false);

  useEffect(() => {
    if (status === "authenticated") {
      hadAuthenticated.current = true;
      hasHandledExpiry.current = false;
      return;
    }

    if (
      status === "unauthenticated" &&
      hadAuthenticated.current &&
      !hasHandledExpiry.current
    ) {
      hasHandledExpiry.current = true;
      const returnTo = `${window.location.pathname}${window.location.search}`;
      const callbackUrl = encodeURIComponent(returnTo);

      if (pathname !== "/login") {
        alert("Session หมดอายุ กรุณาเข้าสู่ระบบใหม่");
        router.push(`/login?sessionExpired=1&callbackUrl=${callbackUrl}`);
      }
    }
  }, [status, pathname, router]);

  return null;
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchInterval={1 * 60}       // ตรวจสอบ session ทุก 1 นาที
      refetchOnWindowFocus={true}     // ตรวจสอบเมื่อกลับมาใช้งานหน้าเว็บ
    >
      <SessionExpiryWatcher />
      {children}
    </SessionProvider>
  );
}