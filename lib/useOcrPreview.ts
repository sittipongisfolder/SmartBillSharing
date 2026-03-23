import { useState, useCallback } from 'react';

interface OcrPreviewItem {
  name: string;
  qty: number;
  unit_price: number;
  line_total: number;
}

interface OcrPreviewData {
  title: string | null;
  items: OcrPreviewItem[];
  total: number | null;
  rawText: string | null;
  receiptImageUrl: string | null;
  receiptImagePublicId: string | null;
}

export function useOcrPreview() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<OcrPreviewData>({
    title: null,
    items: [],
    total: null,
    rawText: null,
    receiptImageUrl: null,
    receiptImagePublicId: null,
  });

  const openPreview = useCallback(
    (
      data: OcrPreviewData,
      fileName: string,
      preview: string | null
    ) => {
      setPreviewData(data);
      setSelectedFileName(fileName);
      setImagePreview(preview);
      setIsOpen(true);
    },
    []
  );

  const closePreview = useCallback(() => {
    setIsOpen(false);
    setPreviewData({
      title: null,
      items: [],
      total: null,
      rawText: null,
      receiptImageUrl: null,
      receiptImagePublicId: null,
    });
    setImagePreview(null);
    setSelectedFileName('');
  }, []);

  const setLoading = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, []);

  return {
    isOpen,
    isLoading,
    selectedFileName,
    imagePreview,
    previewData,
    openPreview,
    closePreview,
    setLoading,
  };
}
