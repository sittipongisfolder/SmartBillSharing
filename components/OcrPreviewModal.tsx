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
  const [editableItems, setEditableItems] = useState<OcrPreviewItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setChecked(items.map((item) => shouldCheckByDefault(item)));
    setEditableItems(
      items.map((item) => {
        const qty = Math.max(1, Math.trunc(Number(item.qty || 1)));
        const unitPrice = Math.max(0, round2(Number(item.unit_price || 0)));

        return {
          ...item,
          qty,
          unit_price: unitPrice,
          line_total: round2(qty * unitPrice),
        };
      })
    );
  }, [isOpen, items]);

  const selectedItems = useMemo(() => {
    return editableItems.filter((_, idx) => checked[idx]);
  }, [editableItems, checked]);

  const subtotal = useMemo(() => {
    return round2(editableItems.reduce((sum, item) => sum + Number(item.line_total || 0), 0));
  }, [editableItems]);

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

  const handleQtyChange = (index: number, value: string) => {
    const qty = Math.max(1, Math.trunc(Number(value || 1)));

    setEditableItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const nextUnit = Math.max(0, round2(Number(item.unit_price || 0)));
        return {
          ...item,
          qty,
          line_total: round2(qty * nextUnit),
        };
      })
    );
  };

  const handleUnitPriceChange = (index: number, value: string) => {
    const unitPrice = Math.max(0, round2(Number(value || 0)));

    setEditableItems((prev) =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const qty = Math.max(1, Math.trunc(Number(item.qty || 1)));
        return {
          ...item,
          unit_price: unitPrice,
          line_total: round2(qty * unitPrice),
        };
      })
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white p-4 sm:p-6">
          <h2 className="text-xl font-bold text-gray-900 sm:text-2xl">ตรวจสอบข้อมูล OCR</h2>
          <p className="mt-1 text-sm text-gray-600">ไฟล์: {fileName}</p>
        </div>

        {/* Content */}
        <div className="space-y-5 p-4 sm:space-y-6 sm:p-6">
          {/* Image Preview */}
          {imagePreview ? (
            <div className="overflow-hidden rounded-lg border border-gray-300 bg-gray-50">
              <img
                src={imagePreview}
                alt="Receipt preview"
                className="h-40 w-full object-contain sm:h-64"
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
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold text-gray-900">เลือกรายการที่จะใช้</p>
              <p className="text-sm text-gray-500">
                เลือกแล้ว {selectedItems.length} รายการ
              </p>
            </div>

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <button
                type="button"
                onClick={handleSelectAll}
                disabled={items.length === 0 || isLoading || allChecked}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                เลือกทั้งหมด
              </button>

              <button
                type="button"
                onClick={handleClearAll}
                disabled={items.length === 0 || isLoading || !hasAnyChecked}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-none"
              >
                ล้างทั้งหมด
              </button>
            </div>
          </div>

          {/* Items (Desktop Table) */}
          <div className="hidden overflow-hidden rounded-lg border border-gray-200 md:block">
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
                {editableItems.length > 0 ? (
                  editableItems.map((item, idx) => (
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
                      <td className="px-4 py-2 text-center text-gray-900">
                        <input
                          type="number"
                          min={1}
                          step={1}
                          inputMode="numeric"
                          value={String(item.qty)}
                          onChange={(e) => handleQtyChange(idx, e.target.value)}
                          disabled={isLoading}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-right text-gray-900"
                        />
                      </td>
                      <td className="px-4 py-2 text-right text-gray-900">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          inputMode="decimal"
                          value={Number(item.unit_price || 0).toFixed(2)}
                          onChange={(e) => handleUnitPriceChange(idx, e.target.value)}
                          disabled={isLoading}
                          className="w-24 rounded border border-gray-300 px-2 py-1 text-right text-gray-900"
                        />
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

          {/* Items (Mobile Cards) */}
          <div className="space-y-2 md:hidden">
            {editableItems.length > 0 ? (
              editableItems.map((item, idx) => (
                <div
                  key={`${item.name}-${idx}`}
                  className={`rounded-lg border p-3 ${checked[idx] ? 'border-gray-200 bg-white' : 'border-gray-200 bg-gray-50'}`}
                >
                  <div className="mb-2 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={!!checked[idx]}
                      onChange={() => toggleItem(idx)}
                      disabled={isLoading}
                      className="mt-1 h-4 w-4 accent-blue-600"
                    />
                    <p className="text-sm font-medium text-gray-900">{item.name}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-xs text-gray-600">
                      จำนวน
                      <input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        value={String(item.qty)}
                        onChange={(e) => handleQtyChange(idx, e.target.value)}
                        disabled={isLoading}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-right text-sm text-gray-900"
                      />
                    </label>
                    <label className="text-xs text-gray-600">
                      ราคาต่อหน่วย
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        value={Number(item.unit_price || 0).toFixed(2)}
                        onChange={(e) => handleUnitPriceChange(idx, e.target.value)}
                        disabled={isLoading}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-right text-sm text-gray-900"
                      />
                    </label>
                  </div>

                  <div className="mt-2 flex items-center justify-between border-t border-gray-200 pt-2 text-sm">
                    <span className="text-gray-600">รวม</span>
                    <span className="font-semibold text-gray-900">
                      {Number(item.line_total || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-gray-500">
                ไม่พบรายการสินค้า
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-full space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4 sm:w-72">
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
        <div className="sticky bottom-0 flex flex-col-reverse gap-3 border-t border-gray-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-end sm:gap-4 sm:p-6">
          <button
            type="button"
            onClick={onReject}
            disabled={isLoading}
            className="w-full rounded-lg border border-gray-300 px-6 py-2 font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            ไม่ใช้ข้อมูลนี้
          </button>

          <button
            type="button"
            onClick={handleAccept}
            disabled={isLoading || selectedItems.length === 0}
            className="w-full rounded-lg bg-blue-600 px-6 py-2 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isLoading ? 'กำลังประมวลผล...' : 'ใช้ข้อมูลนี้'}
          </button>
        </div>
      </div>
    </div>
  );
}