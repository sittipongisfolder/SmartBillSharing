import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PatchBody = {
  bank?: string;
  bankAccountNumber?: string;
  name?: string;
  promptPayPhone?: string;
};

const BANKS = ['กสิกรไทย', 'กรุงไทย', 'กรุงเทพ', 'ไทยพาณิชย์', 'พร้อมเพย์'];

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    await connectMongoDB();

    const user = await User.findOne({ email: session.user.email }).select(
      'name email bank bankAccountNumber promptPayPhone role'
    );

    if (!user) {
      return NextResponse.json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        profile: {
          name: user.name,
          email: user.email,
          bank: user.bank,
          bankAccountNumber: user.bankAccountNumber,
          promptPayPhone: user.promptPayPhone,
          role: user.role,
        },
      },
      { status: 200 }
    );
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Server error' }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as PatchBody;

    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    const bank = typeof body.bank === 'string' ? body.bank.trim() : undefined;
    const bankAccountNumber =
      typeof body.bankAccountNumber === 'string' ? body.bankAccountNumber.trim() : undefined;
    const promptPayPhone =
      typeof body.promptPayPhone === 'string' ? body.promptPayPhone.trim() : undefined;
    // validate
    if (bank !== undefined && bank.length > 0 && !BANKS.includes(bank)) {
      return NextResponse.json({ ok: false, message: 'ธนาคารไม่ถูกต้อง' }, { status: 400 });
    }

    if (bankAccountNumber !== undefined) {
      if (!/^\d{10}$/.test(bankAccountNumber)) {
        return NextResponse.json(
          { ok: false, message: 'กรุณากรอกเลขบัญชี/เบอร์โทร 10 หลัก (ตัวเลขเท่านั้น)' },
          { status: 400 }
        );
      }
    }

    const update: Record<string, string> = {};
    if (name) update.name = name;
    if (bank) update.bank = bank;
    if (bankAccountNumber) update.bankAccountNumber = bankAccountNumber;
    if (promptPayPhone) update.promptPayPhone = promptPayPhone;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ ok: false, message: 'ไม่มีข้อมูลให้อัปเดต' }, { status: 400 });
    }

    await connectMongoDB();

    const res = await User.updateOne({ email: session.user.email }, { $set: update });
    if (res.matchedCount === 0) {
      return NextResponse.json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' }, { status: 404 });
    }

    return NextResponse.json({ ok: true, message: 'บันทึกข้อมูลสำเร็จ' }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Server error' }, { status: 500 });
  }
}
