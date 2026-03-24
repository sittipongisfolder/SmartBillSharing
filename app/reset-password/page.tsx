'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FaEye, FaEyeSlash } from 'react-icons/fa';

function ResetPasswordContent() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const searchParams = useSearchParams();
  const router = useRouter();

  const token = searchParams.get('token') ?? '';

  const inputClass =
    'w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white ' +
    'placeholder-gray-400 text-sm text-gray-800';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setMessage('');

    if (!token) {
      setError('ไม่พบ token สำหรับรีเซ็ตรหัสผ่าน');
      return;
    }

    if (password !== confirmPassword) {
      setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    setLoading(true);

    try {
      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(data?.message || 'ไม่สามารถตั้งรหัสผ่านใหม่ได้');
        return;
      }

      setMessage(data?.message || 'ตั้งรหัสผ่านใหม่สำเร็จ');
      setPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        router.push('/login');
      }, 1200);
    } catch (submitError) {
      console.error('Reset password error:', submitError);
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 flex items-center justify-center bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      <div className="w-full max-w-[440px]">
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 space-y-8 border border-orange-50/50 shadow-[0_25px_50px_-12px_rgba(251,140,0,0.15)]">
          <div className="text-center space-y-3">
            <div className="mx-auto inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-50 text-[#fb8c00] text-3xl">
              🔒
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl md:text-[26px] font-extrabold tracking-tight text-[var(--text-color)] leading-tight">
                Set a new password
              </h1>
              <p className="text-gray-500 font-medium">
                Your new password must be at least 8 characters long.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2 relative">
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 ml-1">
                New Password
              </label>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className={`${inputClass} pr-12`}
                placeholder="••••••••"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-4 top-[44px] text-gray-400 hover:text-gray-600"
                aria-label="toggle password"
              >
                {showPassword ? <FaEye /> : <FaEyeSlash />}
              </button>
            </div>

            <div className="space-y-2 relative">
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 ml-1">
                Confirm New Password
              </label>
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className={`${inputClass} pr-12`}
                placeholder="••••••••"
                minLength={8}
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword((value) => !value)}
                className="absolute right-4 top-[44px] text-gray-400 hover:text-gray-600"
                aria-label="toggle confirm password"
              >
                {showConfirmPassword ? <FaEye /> : <FaEyeSlash />}
              </button>
            </div>

            {error && <p className="text-sm font-medium text-red-500">{error}</p>}
            {message && <p className="text-sm font-medium text-emerald-600">{message}</p>}

            <button
              type="submit"
              disabled={loading || !token}
              className={`w-full text-white font-bold py-4 rounded-xl shadow-lg transition-all duration-300 ${
                loading || !token
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 active:scale-[0.98] bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]'
              }`}
            >
              {loading ? 'กำลังบันทึกรหัสผ่าน...' : 'Save New Password'}
            </button>
          </form>

          <div className="text-center text-sm text-gray-500 font-medium">
            <Link href="/login" className="text-[#fb8c00] font-bold hover:text-[#e65100] transition-colors">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense
      fallback={<div className="min-h-screen bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]" />}
    >
      <ResetPasswordContent />
    </React.Suspense>
  );
}