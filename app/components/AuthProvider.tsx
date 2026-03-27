"use client"; // ✅ ทำให้ไฟล์นี้เป็น Client Component

import { SessionProvider } from "next-auth/react";

export default function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider
      refetchInterval={5 * 60}       // ตรวจสอบ session ทุก 5 นาที
      refetchOnWindowFocus={true}     // ตรวจสอบเมื่อกลับมาใช้งานหน้าเว็บ
    >
      {children}
    </SessionProvider>
  );
}