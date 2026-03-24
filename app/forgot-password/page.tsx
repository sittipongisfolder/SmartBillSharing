'use client';

import React, { useState } from 'react';
import Link from 'next/link';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const inputClass =
    'w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white ' +
    'placeholder-gray-400 text-sm text-gray-800';

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      const data = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setError(data?.message || 'ไม่สามารถดำเนินการได้');
        return;
      }

      setMessage(data?.message || 'กรุณาตรวจสอบอีเมลของคุณ');
    } catch (submitError) {
      console.error('Forgot password error:', submitError);
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
              ✉
            </div>
            <div className="space-y-1">
              <h1 className="text-2xl md:text-[26px] font-extrabold tracking-tight text-[var(--text-color)] leading-tight">
                Forgot your password?
              </h1>
              <p className="text-gray-500 font-medium">
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 ml-1">
                Email Address
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                className={inputClass}
              />
            </div>

            {error && <p className="text-sm font-medium text-red-500">{error}</p>}
            {message && <p className="text-sm font-medium text-emerald-600">{message}</p>}

            <button
              type="submit"
              disabled={loading}
              className={`w-full text-white font-bold py-4 rounded-xl shadow-lg transition-all duration-300 ${
                loading
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'shadow-orange-200 hover:shadow-orange-300 hover:-translate-y-0.5 active:scale-[0.98] bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]'
              }`}
            >
              {loading ? 'กำลังส่งลิงก์...' : 'Send Reset Link'}
            </button>
          </form>

          <div className="text-center text-sm text-gray-500 font-medium">
            Remembered your password?
            <Link href="/login" className="ml-1 text-[#fb8c00] font-bold hover:text-[#e65100] transition-colors">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}