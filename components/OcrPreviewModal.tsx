'use client';
/* eslint-disable @next/next/no-img-element */

import { useEffect, useMemo, useState } from 'react';

export interface OcrPreviewItem {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

export interface OcrPreviewAcceptPayload {
  title: string | null;
  rawText: string;
  selectedItems: OcrPreviewItem[];
  selectedTotal: number;
}

interface OcrPreviewModalProps {
  isOpen: boolean;
  title: string | null;
  items: OcrPreviewItem[];
  total: number | null;
  rawText?: string;
  imagePreview: string | null;
  fileName: string;
  onAccept: (payload: OcrPreviewAcceptPayload) => void;
  onReject: () => void;
  isLoading?: boolean;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function shouldCheckByDefault(item: OcrPreviewItem) {
  const name = String(item.name ?? '').trim().toLowerCase();
  if (!name) return false;

  const blockedKeywords = [
    'total',
    'subtotal',
    'vat',
    'tax',
    'service',
    'charge',
    'discount',
    'receipt',
    'date',
    'time',
    'thank you',
    'ยอดรวม',
    'รวมทั้งสิ้น',
    'ใบเสร็จ',
    'วันที่',
    'เวลา',
    'ภาษี',
    'สุทธิ',
    'ค่าบริการ',
  ];

  if (blockedKeywords.some((kw) => name.includes(kw))) return false;
  return true;
}

export function OcrPreviewModal({
  isOpen,
  title,
  items,
  total,
  rawText = '',
  imagePreview,
  fileName,
  onAccept,
  onReject,
  isLoading = false,
}: OcrPreviewModalProps) {
  const [checked, setChecked] = useState<boolean[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setChecked(items.map((item) => shouldCheckByDefault(item)));
  }, [isOpen, items]);

  const selectedItems = useMemo(() => {
    return items.filter((_, idx) => checked[idx]);
  }, [items, checked]);

  const subtotal = useMemo(() => {
    return round2(items.reduce((sum, item) => sum + Number(item.line_total || 0), 0));
  }, [items]);

  const selectedTotal = useMemo(() => {
    return round2(selectedItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0));
  }, [selectedItems]);

  const allChecked = items.length > 0 && checked.every(Boolean);
  const hasAnyChecked = checked.some(Boolean);

  const toggleItem = (index: number) => {
    setChecked((prev) => prev.map((v, i) => (i === index ? !v : v)));
  };

  const handleSelectAll = () => {
    setChecked(items.map(() => true));
  };

  const handleClearAll = () => {
    setChecked(items.map(() => false));
  };

  const handleAccept = () => {
    onAccept({
      title,
      rawText,
      selectedItems,
      selectedTotal,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white p-6">
          <h2 className="text-2xl font-bold text-gray-900">ตรวจสอบข้อมูล OCR</h2>
          <p className="mt-1 text-sm text-gray-600">ไฟล์: {fileName}</p>
        </div>

        {/* Content */}
        <div className="space-y-6 p-6">
          {/* Image Preview */}
          {imagePreview ? (
            <div className="overflow-hidden rounded-lg border border-gray-300 bg-gray-50">
              <img
                src={imagePreview}
                alt="Receipt preview"
                className="h-64 w-full object-contain"
              />
            </div>
          ) : null}

          {/* Title */}
          {title ? (
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-sm text-gray-600">ชื่อบิล</p>
              <p className="text-lg font-semibold text-gray-900">{title}</p>
            </div>
          ) : null}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900">เลือกรายการที่จะใช้</p>
              <p className="text-sm text-gray-500">
                เลือกแล้ว {selectedItems.length} รายการ
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={items.length === 0 || isLoading || allChecked}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                เลือกทั้งหมด
              </button>

              <button
                type="button"
                onClick={handleClearAll}
                disabled={items.length === 0 || isLoading || !hasAnyChecked}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                ล้างทั้งหมด
              </button>
            </div>
          </div>

          {/* Items Table */}
          <div className="overflow-hidden rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-200 bg-gray-100">
                <tr>
                  <th className="w-14 px-4 py-2 text-center font-semibold text-gray-700">เลือก</th>
                  <th className="px-4 py-2 text-left font-semibold text-gray-700">รายการ</th>
                  <th className="w-20 px-4 py-2 text-center font-semibold text-gray-700">จำนวน</th>
                  <th className="w-28 px-4 py-2 text-right font-semibold text-gray-700">ราคาต่อหน่วย</th>
                  <th className="w-28 px-4 py-2 text-right font-semibold text-gray-700">รวม</th>
                </tr>
              </thead>
              <tbody>
                {items.length > 0 ? (
                  items.map((item, idx) => (
                    <tr
                      key={`${item.name}-${idx}`}
                      className={`border-b border-gray-200 ${
                        checked[idx] ? 'bg-white' : 'bg-gray-50'
                      } hover:bg-gray-50`}
                    >
                      <td className="px-4 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={!!checked[idx]}
                          onChange={() => toggleItem(idx)}
                          disabled={isLoading}
                          className="h-4 w-4 accent-blue-600"
                        />
                      </td>
                      <td className="px-4 py-2 text-gray-900">{item.name}</td>
                      <td className="px-4 py-2 text-center text-gray-900">{item.qty}</td>
                      <td className="px-4 py-2 text-right text-gray-900">
                        {Number(item.unit_price || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-right font-semibold text-gray-900">
                        {Number(item.line_total || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                      ไม่พบรายการสินค้า
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-72 space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">รวมจาก OCR</span>
                <span className="font-semibold text-gray-900">
                  {(total ?? subtotal).toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between text-sm">
                <span className="text-gray-600">รวมรายการทั้งหมด</span>
                <span className="font-semibold text-gray-900">{subtotal.toFixed(2)}</span>
              </div>

              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between">
                  <span className="font-bold text-gray-900">รวมที่เลือก</span>
                  <span className="text-lg font-bold text-blue-600">
                    {selectedTotal.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 flex items-center justify-end gap-4 border-t border-gray-200 bg-white p-6">
          <button
            type="button"
            onClick={onReject}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 px-6 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ไม่ใช้ข้อมูลนี้
          </button>

          <button
            type="button"
            onClick={handleAccept}
            disabled={isLoading || selectedItems.length === 0}
            className="rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? 'กำลังประมวลผล...' : 'ใช้ข้อมูลนี้'}
          </button>
        </div>
      </div>
    </div>
  );
}