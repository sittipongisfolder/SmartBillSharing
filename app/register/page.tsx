'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaEye, FaEyeSlash } from 'react-icons/fa';

export default function Register() {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [bank, setBank] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [promptPayPhone, setPromptPayPhone] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const onlyDigits = (s: string) => s.replace(/\D/g, '');

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    const u = username.trim();
    const em = email.trim();
    const pw = password;
    const cpw = confirmPassword;
    const bk = bank.trim();

    const acc = onlyDigits(bankAccountNumber.trim());
    const pp = onlyDigits(promptPayPhone.trim());

    // ✅ Required fields
    if (!u || !em || !pw || !cpw || !bk || !acc || !pp) {
      setError('กรุณากรอกข้อมูลให้ครบ (รวมถึงเบอร์ PromptPay)');
      return;
    }

    if (pw !== cpw) {
      setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    // ✅ bank account: อนุโลม 10-12 หลัก (เผื่อบางธนาคาร)
    if (acc.length !== 10 ) {
      setError('กรุณากรอกหมายเลขบัญชีธนาคารให้ถูกต้อง (10 หลัก)');
      return;
    }

    // ✅ PromptPay เบอร์โทร: 10 หลัก และขึ้นต้นด้วย 0 (ไทย)
    if (pp.length !== 10 || !pp.startsWith('0')) {
      setError('กรุณากรอกเบอร์ PromptPay ให้ถูกต้อง (10 หลัก และขึ้นต้นด้วย 0)');
      return;
    }

    try {
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: u,
          email: em,
          password: pw,
          bank: bk,
          bankAccountNumber: acc,      // ✅ เก็บเป็น string
          promptPayPhone: pp,          // ✅ เก็บเป็น string (ห้ามแปลงเป็น Number)
        }),
      });

      if (res.ok) {
        const form = e.target as HTMLFormElement;
        form.reset();

        setUsername('');
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setBank('');
        setBankAccountNumber('');
        setPromptPayPhone('');

        setSuccess('สมัครสมาชิกสำเร็จ!');
        router.push('/login');
      } else {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error || 'เกิดข้อผิดพลาดในการสมัครสมาชิก');
      }
    } catch (err) {
      console.error('Unexpected error:', err);
      setError('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้');
    }
  };

  const inputClass =
    'w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white ' +
    'placeholder-gray-400 text-sm text-gray-800';

  const selectClass =
    'w-full px-4 py-3 rounded-xl border border-gray-200 bg-gray-50/50 transition-all duration-200 outline-none ' +
    'focus:border-[#fb8c00] focus:ring-4 focus:ring-orange-100 focus:bg-white ' +
    'text-sm text-gray-800';

  return (
    <div className="min-h-screen p-6 flex items-center justify-center bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      <div className="w-full max-w-[440px]">
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 space-y-8 border border-orange-50/50 shadow-[0_25px_50px_-12px_rgba(251,140,0,0.15)]">
          <div className="text-center space-y-4">
            <div className="mx-auto inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-50 text-[#fb8c00]">
              <span className="text-3xl leading-none">🧾</span>
            </div>

            <div className="space-y-1">
              <h1 className="text-2xl md:text-[26px] font-extrabold tracking-tight text-[var(--text-color)] leading-tight">
                Smart Bill <span className="text-[#fb8c00]">Sharing</span> System
              </h1>
              <p className="text-gray-500 font-medium">Create your account to get started.</p>
            </div>
          </div>

          <form onSubmit={handleRegisterSubmit} className="space-y-5">
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-semibold text-gray-700 ml-1">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                maxLength={30}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 ml-1">
                Email Address
              </label>
              <input
                type="email"
                id="email"
                maxLength={256}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@company.com"
                className={inputClass}
              />
            </div>

            <div className="space-y-2 relative">
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 ml-1">
                Password
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                maxLength={128}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-[44px] text-gray-400 hover:text-gray-600"
                aria-label="toggle password"
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            <div className="space-y-2 relative">
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 ml-1">
                Confirm Password
              </label>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                maxLength={128}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputClass} pr-12`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-4 top-[44px] text-gray-400 hover:text-gray-600"
                aria-label="toggle confirm password"
              >
                {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="bank" className="block text-sm font-semibold text-gray-700 ml-1">
                Bank
              </label>
              <select id="bank" value={bank} onChange={(e) => setBank(e.target.value)} className={selectClass}>
                <option value="" disabled className="text-gray-400">
                  Choose Your Bank
                </option>
                <option value="กสิกรไทย">กสิกรไทย</option>
                <option value="กรุงไทย">กรุงไทย</option>
                <option value="กรุงเทพ">กรุงเทพ</option>
                <option value="ไทยพาณิชย์">ไทยพาณิชย์</option>
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="bankAccountNumber" className="block text-sm font-semibold text-gray-700 ml-1">
                Account Number
              </label>
              <input
                type="tel"
                inputMode="numeric"
                id="bankAccountNumber"
                value={bankAccountNumber}
                maxLength={10}
                onChange={(e) => setBankAccountNumber(e.target.value)}
                placeholder="กรอกเลขบัญชี (10 หลัก)"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="promptPayPhone" className="block text-sm font-semibold text-gray-700 ml-1">
                PromptPay Phone (Required)
              </label>
              <input
                type="tel"
                inputMode="numeric"
                id="promptPayPhone"
                value={promptPayPhone}
                maxLength={10}
                onChange={(e) => setPromptPayPhone(e.target.value)}
                placeholder="กรอกเบอร์ PromptPay (10 หลัก)"
                className={inputClass}
              />
            </div>

            {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
            {success && <p className="text-green-600 text-sm font-medium">{success}</p>}

            <button
              type="submit"
              className="w-full text-white font-bold py-4 rounded-xl shadow-lg shadow-orange-200 hover:shadow-orange-300
                         hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.98]
                         bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]"
            >
              Register
            </button>
          </form>

          <div className="text-center pt-1">
            <p className="text-sm text-gray-500 font-medium">
              มีบัญชีอยู่แล้ว?
              <Link href="/login" className="ml-1 text-[#fb8c00] font-bold hover:text-[#e65100] transition-colors">
                เข้าสู่ระบบ
              </Link>
            </p>
          </div>
        </div>

        <div className="mt-8 flex justify-center space-x-2 opacity-20">
          <div className="w-2 h-2 rounded-full bg-orange-400" />
          <div className="w-2 h-2 rounded-full bg-orange-300" />
          <div className="w-2 h-2 rounded-full bg-orange-200" />
        </div>
      </div>
    </div>
  );
}
