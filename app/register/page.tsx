'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { FaEye, FaEyeSlash } from 'react-icons/fa';

const THAI_BANK_OPTIONS = [
  { id: 'kbank', name: 'กสิกรไทย', logoPath: '/banks/kbank.svg' },
  { id: 'ktb', name: 'กรุงไทย', logoPath: '/banks/ktb.svg' },
  { id: 'bbl', name: 'กรุงเทพ', logoPath: '/banks/bbl.svg' },
  { id: 'scb', name: 'ไทยพาณิชย์', logoPath: '/banks/scb.svg' },
  { id: 'bay', name: 'กรุงศรีอยุธยา', logoPath: '/banks/bay.svg' },
  { id: 'ttb', name: 'ทหารไทยธนชาต (ttb)', logoPath: '/banks/ttb.svg' },
  { id: 'gsb', name: 'ออมสิน', logoPath: '/banks/gsb.svg' },
  { id: 'baac', name: 'ธ.ก.ส.', logoPath: '/banks/baac.svg' },
  { id: 'uob', name: 'ยูโอบี (UOB)', logoPath: '/banks/uob.svg' },
  { id: 'cimb', name: 'ซีไอเอ็มบี ไทย (CIMB Thai)', logoPath: '/banks/cimb.svg' },
  { id: 'kkp', name: 'เกียรตินาคินภัทร (KKP)', logoPath: '/banks/kkp.svg' },
  { id: 'lhb', name: 'แลนด์ แอนด์ เฮ้าส์ (LH Bank)', logoPath: '/banks/lhb.svg' },
  { id: 'icbc', name: 'ไอซีบีซี (ICBC Thai)', logoPath: '/banks/icbc.svg' },
  { id: 'sc', name: 'สแตนดาร์ดชาร์เตอร์ด (ไทย)', logoPath: '/banks/sc.svg' },
];

const FALLBACK_LOGO_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-green-100 text-green-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-pink-100 text-pink-700',
  'bg-cyan-100 text-cyan-700',
];

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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isBankDropdownOpen, setIsBankDropdownOpen] = useState(false);
  const [brokenBankLogos, setBrokenBankLogos] = useState<Record<string, true>>({});
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const onlyDigits = (s: string) => s.replace(/\D/g, '');
  const isStrongPassword = (s: string) => /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(s);

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setError('');
    setSuccess('');

    const u = username.trim();
    const em = email.trim();
    const pw = password;
    const cpw = confirmPassword;
    const bk = bank.trim();

    const acc = onlyDigits(bankAccountNumber.trim());
    const pp = onlyDigits(promptPayPhone.trim());

    // ✅ Required fields (PromptPay ไม่บังคับ)
    if (!u || !em || !pw || !cpw || !bk || !acc) {
      setError('กรุณากรอกข้อมูลที่จำเป็นให้ครบ');
      return;
    }

    if (pw !== cpw) {
      setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    if (!isStrongPassword(pw)) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัว และต้องมีทั้งตัวอักษรและตัวเลข');
      return;
    }

    // ✅ bank account: อนุโลม 10-12 หลัก (เผื่อบางธนาคาร)
    if (acc.length < 10 || acc.length > 12) {
      setError('กรุณากรอกหมายเลขบัญชีธนาคารให้ถูกต้อง (10-12 หลัก)');
      return;
    }

    // ✅ PromptPay (ถ้ากรอก ต้องเป็น 10 หลักและขึ้นต้นด้วย 0)
    if (pp && (pp.length !== 10 || !pp.startsWith('0'))) {
      setError('กรุณากรอกเบอร์ PromptPay ให้ถูกต้อง (10 หลัก และขึ้นต้นด้วย 0)');
      return;
    }

    try {
      setIsSubmitting(true);

      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: u,
          email: em,
          password: pw,
          bank: bk,
          bankAccountNumber: acc,
          promptPayPhone: pp || undefined,
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
    } finally {
      setIsSubmitting(false);
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

  const selectedBank = THAI_BANK_OPTIONS.find((item) => item.name === bank);
  const selectedBankColor = selectedBank
    ? FALLBACK_LOGO_COLORS[THAI_BANK_OPTIONS.findIndex((item) => item.id === selectedBank.id) % FALLBACK_LOGO_COLORS.length]
    : FALLBACK_LOGO_COLORS[0];

  const getBankInitial = (name: string) => {
    const latin = name.match(/[A-Za-z]{2,}/)?.[0];
    if (latin) return latin.slice(0, 2).toUpperCase();
    return name.trim().charAt(0);
  };

  const markLogoBroken = (bankId: string) => {
    setBrokenBankLogos((prev) => (prev[bankId] ? prev : { ...prev, [bankId]: true }));
  };

  return (
    <div className="min-h-screen p-6 flex items-center justify-center bg-[radial-gradient(circle_at_top_right,#fff5e6_0%,#ffffff_40%,#fff0e0_100%)]">
      <div className="w-full max-w-[440px]">
        <div className="bg-white rounded-[2.5rem] p-8 md:p-12 space-y-8 border border-orange-50/50 shadow-[0_25px_50px_-12px_rgba(251,140,0,0.15)]">
          <div className="text-center space-y-4">
            <div className="mx-auto inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-orange-50 text-[#fb8c00]">
              <span className="text-3xl leading-none">🧾</span>
            </div>

            <div className="space-y-1">
              <h1 className="text-2xl md:text-[24px] font-extrabold tracking-tight text-[var(--text-color)] leading-tight">
                Smart Bill <span className="text-[#fb8c00]">Sharing</span> System
              </h1>
            </div>
          </div>

          <form onSubmit={handleRegisterSubmit} className="space-y-5" aria-busy={isSubmitting}>
            <div className="space-y-2">
              <label htmlFor="username" className="block text-sm font-semibold text-gray-700 ml-1">
                ชื่อผู้ใช้ 
              </label>
              <input
                type="text"
                id="username"
                value={username}
                maxLength={30}
                required
                autoComplete="username"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="กรอกชื่อผู้ใช้ (ไม่เกิน 30 ตัวอักษร)"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="email" className="block text-sm font-semibold text-gray-700 ml-1">
                อีเมล 
              </label>
              <input
                type="email"
                id="email"
                maxLength={256}
                value={email}
                required
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                placeholder="กรอกอีเมลของคุณ"
                className={inputClass}
              />
            </div>

            <div className="space-y-2 relative">
              <label htmlFor="password" className="block text-sm font-semibold text-gray-700 ml-1">
                รหัสผ่าน 
              </label>
              <input
                type={showPassword ? 'text' : 'password'}
                id="password"
                value={password}
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={`${inputClass} pr-12`}
              />
              <p className="mt-1 ml-1 text-xs text-gray-500">รหัสผ่านต้องมีอย่างน้อย 8 ตัว และมีทั้งตัวอักษรกับตัวเลข</p>
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-[44px] text-gray-400 hover:text-gray-600"
                aria-label="toggle password"
              >
                {showPassword ? <FaEye /> : <FaEyeSlash />}
              </button>
            </div>

            <div className="space-y-2 relative">
              <label htmlFor="confirmPassword" className="block text-sm font-semibold text-gray-700 ml-1">
                ยืนยันรหัสผ่าน 
              </label>
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                id="confirmPassword"
                value={confirmPassword}
                minLength={8}
                maxLength={128}
                required
                autoComplete="new-password"
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
                {showConfirmPassword ? <FaEye /> : <FaEyeSlash />}
              </button>
            </div>

            <div className="space-y-2">
              <label htmlFor="bank" className="block text-sm font-semibold text-gray-700 ml-1">
                ธนาคาร 
              </label>
              <input type="hidden" name="bank" value={bank} />
              <button
                id="bank"
                type="button"
                className={`${selectClass} flex items-center justify-between`}
                onClick={() => setIsBankDropdownOpen((prev) => !prev)}
                aria-expanded={isBankDropdownOpen}
                aria-haspopup="listbox"
              >
                <span className="flex items-center gap-2 min-w-0">
                  {selectedBank ? (
                    <>
                      {brokenBankLogos[selectedBank.id] ? (
                        <span
                          className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${selectedBankColor}`}
                          aria-hidden="true"
                        >
                          {getBankInitial(selectedBank.name)}
                        </span>
                      ) : (
                        <Image
                          src={selectedBank.logoPath}
                          alt={`logo ${selectedBank.name}`}
                          width={20}
                          height={20}
                          className="h-5 w-5 rounded-sm bg-white object-contain"
                          onError={() => markLogoBroken(selectedBank.id)}
                        />
                      )}
                      <span className="truncate">{selectedBank.name}</span>
                    </>
                  ) : (
                    <span className="text-gray-400">เลือกธนาคารของคุณ</span>
                  )}
                </span>
                <span className="text-gray-400" aria-hidden="true">▾</span>
              </button>

              {isBankDropdownOpen && (
                <div className="mt-2 max-h-56 overflow-auto rounded-xl border border-gray-200 bg-white p-1 shadow-lg">
                  <ul role="listbox" aria-label="เลือกธนาคาร" className="space-y-1">
                    {THAI_BANK_OPTIONS.map((item, idx) => {
                      const isActive = item.name === bank;
                      const fallbackColor = FALLBACK_LOGO_COLORS[idx % FALLBACK_LOGO_COLORS.length];
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors ${
                              isActive ? 'bg-orange-50 text-gray-900' : 'hover:bg-gray-50 text-gray-700'
                            }`}
                            onClick={() => {
                              setBank(item.name);
                              setIsBankDropdownOpen(false);
                            }}
                          >
                            {brokenBankLogos[item.id] ? (
                              <span
                                className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${fallbackColor}`}
                                aria-hidden="true"
                              >
                                {getBankInitial(item.name)}
                              </span>
                            ) : (
                              <Image
                                src={item.logoPath}
                                alt={`logo ${item.name}`}
                                width={20}
                                height={20}
                                className="h-5 w-5 rounded-sm bg-white object-contain"
                                onError={() => markLogoBroken(item.id)}
                              />
                            )}
                            <span className="truncate">{item.name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {!bank && <p className="ml-1 text-xs text-red-500">กรุณาเลือกธนาคาร</p>}

              {selectedBank && (
                <div className="ml-1 inline-flex items-center gap-2 rounded-lg border border-orange-100 bg-orange-50 px-3 py-1.5 text-xs font-medium text-gray-700">
                  {brokenBankLogos[selectedBank.id] ? (
                    <span
                      className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${selectedBankColor}`}
                      aria-hidden="true"
                    >
                      {getBankInitial(selectedBank.name)}
                    </span>
                  ) : (
                    <Image
                      src={selectedBank.logoPath}
                      alt={`logo ${selectedBank.name}`}
                      width={20}
                      height={20}
                      className="h-5 w-5 rounded-sm bg-white object-contain"
                      onError={() => markLogoBroken(selectedBank.id)}
                    />
                  )}
                  <span>{selectedBank.name}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label htmlFor="bankAccountNumber" className="block text-sm font-semibold text-gray-700 ml-1">
                เลขที่บัญชี 
              </label>
              <input
                type="tel"
                inputMode="numeric"
                id="bankAccountNumber"
                value={bankAccountNumber}
                maxLength={12}
                required
                autoComplete="off"
                onChange={(e) => setBankAccountNumber(onlyDigits(e.target.value).slice(0, 12))}
                placeholder="กรอกเลขบัญชีโดยไม่มีขีดหรือเว้นวรรค (10-12 หลัก)"
                className={inputClass}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="promptPayPhone" className="block text-sm font-semibold text-gray-700 ml-1">
                เบอร์ PromptPay (ไม่บังคับ)
              </label>
              <input
                type="tel"
                inputMode="numeric"
                id="promptPayPhone"
                value={promptPayPhone}
                maxLength={10}
                autoComplete="tel-national"
                onChange={(e) => setPromptPayPhone(onlyDigits(e.target.value).slice(0, 10))}
                placeholder="กรอกเบอร์ PromptPay (ถ้ามี)"
                className={inputClass}
              />
            </div>

            {error && <p className="text-red-500 text-sm font-medium">{error}</p>}
            {success && <p className="text-green-600 text-sm font-medium">{success}</p>}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full text-white font-bold py-4 rounded-xl shadow-lg shadow-orange-200 hover:shadow-orange-300
                         hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed disabled:hover:translate-y-0
                         bg-[linear-gradient(135deg,#fb8c00_0%,#e65100_100%)]"
            >
              {isSubmitting ? 'กำลังสมัครสมาชิก...' : 'สมัครสมาชิก'}
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
