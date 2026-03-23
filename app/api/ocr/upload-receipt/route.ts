import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { uploadBillReceiptBuffer } from '@/lib/cloudinary';

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const billId = formData.get('billId') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Use billId if provided, otherwise fallback to default folder
    const folderPath = billId 
      ? `smart-bill/bills/${billId}/receipts`
      : 'smart-bill/receipts';

    const { secure_url, public_id } = await uploadBillReceiptBuffer(buffer, {
      folder: folderPath,
    });

    return NextResponse.json({
      ok: true,
      url: secure_url,
      publicId: public_id,
    });
  } catch (error) {
    console.error('Receipt upload error:', error);
    return NextResponse.json(
      { error: 'Upload failed' },
      { status: 500 }
    );
  }
}
