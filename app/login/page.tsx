'use client';

import React, { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { FaEye, FaEyeSlash } from 'react-icons/fa';

function LoginContent() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionExpired = searchParams.get('sessionExpired') === '1';

  const rawCallbackUrl = searchParams.get('callbackUrl');
  const callbackPath =
    rawCallbackUrl && rawCallbackUrl.startsWith('/') && !rawCallbackUrl.startsWith('//')
      ? rawCallbackUrl
      : null;

  const handleLoginSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await signIn('credentials', {
        redirect: false,
        username,
        password,
      });

      if (res?.error) {
        setError('เข้าสู่ระบบล้มเหลว รหัสผ่านหรือชื่อผู้ใช้ไม่ถูกต้อง');
        setLoading(false);
        return;
      }

      // รอสักครู่เพื่อให้ NextAuth update session
      await new Promise((resolve) => setTimeout(resolve, 500));

      // เรียก API เพื่อดึง session ของผู้ใช้ที่เพิ่งเข้าสู่ระบบ
      const sessionRes = await fetch('/api/auth/session', { cache: 'no-store' });
      let sessionData: { user?: { role?: string } } | null = null;

      const sessionContentType = sessionRes.headers.get('content-type') ?? '';
      if (sessionContentType.includes('application/json')) {
        sessionData = (await sessionRes.json().catch(() => null)) as { user?: { role?: string } } | null;
      }

      if (!sessionRes.ok) {
        console.error('Failed to read session after login:', {
          status: sessionRes.status,
          contentType: sessionContentType,
        });
      }
      
      // ถ้ามี callbackUrl ให้กลับไปปลายทางเดิมก่อน
      if (callbackPath) {
        router.push(callbackPath);
      } else if (sessionData?.user?.role === 'admin') {
        // ถ้าเป็น admin ให้ไปหน้า admin dashboard ถ้าไม่เป็น ให้ไปหน้าปกติ
        router.push('/admin');
      } else {
        router.push('/dashboard');
      }
    } catch (error) {
      console.error('Error during login:', error);
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 flex items-center justify-center bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      <div className="w-full max-w-[460px]">
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 space-y-10 border border-orange-50/50 shadow-[0_25px_50px_-12px_rgba(251,140,0,0.15)]">
          {/* Header */}
          <div className="text-center space-y-4">
            {sessionExpired && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
                เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่
              </div>
            )}
           
    
            <div className="space-y-1">
              <h1 className="text-2xl md:text-[26px] font-extrabold tracking-tight text-[var(--text-color)] leading-tight">
                Smart Bill <span className="text-[#fb8c00]">Sharing</span> System
              </h1>
              <p className="text-gray-500 font-medium">ยินดีต้อนรับ กรุณาเข้าสู่ระบบ</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleLoginSubmit} className="space-y-6">
            {/* Email */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700 ml-1" htmlFor="username">
                อีเมล
              </label>
              <div className="relative">
                <input
                  className="peer h-12 w-full border border-gray-300 rounded-lg text-[var(--text-color)]  focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent px-4"
                  id="username"
                  name="email"
                  type="email"
                  placeholder="name@company.com"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between ml-1">
                <label className="text-sm font-semibold text-gray-700" htmlFor="password">
                  รหัสผ่าน
                </label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-[#fb8c00] hover:underline"
                >
                  ลืมรหัสผ่าน?
                </Link>
              </div>

              <div className="relative">
                <input
                  className="peer h-12 w-full border border-gray-300 rounded-lg text-[var(--text-color)]  focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)] focus:border-transparent px-4"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <button
                  type="button"
                  onMouseDown={() => setShowPassword(true)}
                  onMouseUp={() => setShowPassword(false)}
                  onMouseLeave={() => setShowPassword(false)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="toggle password"
                >
                  {showPassword ? <FaEye /> : <FaEyeSlash />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && <p className="text-red-500 text-sm font-medium">{error}</p>}

            {/* Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={loading}
                className={`w-full text-white font-bold py-4 rounded-xl shadow-lg transition-all duration-300 ${
                  loading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 active:scale-[0.98] bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]'
                }`}
              >
                {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
              </button>
            </div>
          </form>

          {/* Footer link */}
          <div className="text-center pt-2">
            <p className="text-sm text-gray-500 font-medium">
              ยังไม่มีบัญชีผู้ใช้?
              <Link
                href="/register"
                className="ml-1 text-[#fb8c00] font-bold hover:text-[#e65100] transition-colors"
              >
                สมัครสมาชิก
              </Link>
            </p>
          </div>
        </div>

        {/* Dots */}
        <div className="mt-8 flex justify-center space-x-2 opacity-20">
          <div className="w-2 h-2 rounded-full bg-orange-400" />
          <div className="w-2 h-2 rounded-full bg-orange-300" />
          <div className="w-2 h-2 rounded-full bg-orange-200" />
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense
      fallback={<div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]" />}
    >
      <LoginContent />
    </React.Suspense>
  );
}
