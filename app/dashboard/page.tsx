'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  ScaleIcon,
  ChartPieIcon,
  ClipboardDocumentListIcon,
  ArrowRightIcon,
} from '@heroicons/react/24/outline';
import { CheckIcon } from '@heroicons/react/24/solid';


type SplitKey = 'equal' | 'percentage' | 'personal';

export default function Dashboard() {
  const router = useRouter();
  const [selectedOption, setSelectedOption] = useState<SplitKey | null>(null);

  const handleSelect = (type: SplitKey) => setSelectedOption(type);

  const handleContinue = () => {
    if (selectedOption === 'equal') {
      router.push('/open-bill/create-equal?type=equal');
    } else if (selectedOption === 'percentage') {
      router.push('/open-bill/create-percent?type=percentage');
    } else if (selectedOption === 'personal') {
      router.push('/open-bill/create-separated?type=personal');
    }
  };

  const options: Array<{
    key: SplitKey;
    title: string;
    desc: string;
    Icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      key: 'equal',
      title: 'แบ่งบิลเท่ากัน ',
      desc: 'แบ่งบิลเท่าๆ กันสำหรับทุกคน เหมาะสำหรับการแชร์ค่าอาหารที่ทุกคนกินเหมือนกัน',
      Icon: ScaleIcon,
    },
    {
      key: 'percentage',
      title: 'แบ่งตามเปอร์เซ็นต์ ',
      desc: 'แบ่งบิลตามเปอร์เซ็นต์ที่กำหนด เหมาะสำหรับระดับการจัดการที่ยืดหยุ่นและต้องการความแม่นยำมากขึ้น',
      Icon: ChartPieIcon,
    },
    {
      key: 'personal',
      title: 'แบ่งตามรายการ ',
      desc: 'แบ่งบิลตามรายการเฉพาะของแต่ละคน เหมาะสำหรับการจัดการค่าใช้จ่ายที่ละเอียด',
      Icon: ClipboardDocumentListIcon,
    },
  ];

  return (
    <div className="min-h-screen bg-[#fbf7f1] text-[#111827]">
      {/* Top bar (เหมือนในรูป) */}
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-black/5">
        <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#fb8c00]/10 text-[#fb8c00]">
              <span className="text-lg">🍊</span>
            </span>
            <span className="font-semibold">Smart Bill Sharing System</span>
          </div>   
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6">
        <div className="pt-10 pb-12">
          {/* breadcrumb */}
          <div className="text-xs text-[#9ca3af]">
            <span className="text-[#6b7280]">แบ่งบิล</span>
            <span className="mx-2">/</span>
            <span className="text-[#fb8c00]">เลือกวิธีการแบ่งบิล</span>
          </div>

          <div className="mt-6 text-center">
            <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
              เลือกวิธีการแบ่งบิล
            </h1>
            <p className="mt-3 text-sm md:text-base text-[#6b7280]">
              เลือกวิธีการแบ่งบิลที่เหมาะสมกับคุณและกลุ่มของคุณที่สุด
          
            </p>
          </div>

          {/* Cards */}
          <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6">
            {options.map(({ key, title, desc, Icon }) => {
              const active = selectedOption === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleSelect(key)}
                  className={[
                    'relative text-left rounded-3xl bg-white border transition-all',
                    'px-7 py-7 shadow-[0_10px_30px_rgba(0,0,0,0.06)]',
                    active
                      ? 'border-[#fb8c00] ring-1 ring-[#fb8c00]/20'
                      : 'border-black/5 hover:-translate-y-0.5 hover:shadow-[0_14px_40px_rgba(0,0,0,0.08)]',
                  ].join(' ')}
                >
                  {/* Selected check */}
                  {active && (
                    <span className="absolute right-5 top-5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#fb8c00]">
                      <CheckIcon className="h-4 w-4 text-white" />
                    </span>
                  )}

                  {/* Icon bubble */}
                  <div
                    className={[
                      'h-12 w-12 rounded-2xl flex items-center justify-center',
                      active ? 'bg-[#fb8c00] text-white' : 'bg-[#fb8c00]/10 text-[#fb8c00]',
                    ].join(' ')}
                  >
                    <Icon className="h-6 w-6" />
                  </div>

                  <div className="mt-5">
                    <div className="text-base font-semibold">{title}</div>
                    <p className="mt-2 text-sm leading-relaxed text-[#6b7280]">{desc}</p>

                    {/* <div className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-[#fb8c00]">
                      วิธีการใช้งาน
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#fb8c00]/10">
                        <span className="text-xs">i</span>
                      </span>
                    </div> */}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Confirm button */}
          <div className="mt-10 flex flex-col items-center">
            <button
              type="button"
              onClick={handleContinue}
              disabled={!selectedOption}
              className={[
                'w-full max-w-xl rounded-full py-4 px-7 font-semibold text-white',
                'bg-[#fb8c00] shadow-[0_12px_30px_rgba(251,140,0,0.28)]',
                'hover:bg-[#e65100] transition flex items-center justify-center gap-2',
                'disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-[#fb8c00]',
              ].join(' ')}
            >
              เลือกวิธีนี้
              <ArrowRightIcon className="h-5 w-5" />
            </button>

          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-18 border-black/5">
        <div className="mx-auto max-w-6xl px-6 py-6 text-center text-xs text-[#9ca3af]">
          © 2025 Smart Bill Sharing System. Designed for graduate students. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
