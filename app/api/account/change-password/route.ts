import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/authOptions';
import { connectMongoDB } from '@/lib/mongodb';
import User from '@/models/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  currentPassword?: string;
  newPassword?: string;
};

const isBcryptHash = (s: string) =>
  s.startsWith('$2a$') || s.startsWith('$2b$') || s.startsWith('$2y$');

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ ok: false, message: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as Body;
    const currentPassword = (body.currentPassword ?? '').trim();
    const newPassword = (body.newPassword ?? '').trim();

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ ok: false, message: 'กรุณากรอกข้อมูลให้ครบ' }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { ok: false, message: 'รหัสผ่านใหม่ควรมีอย่างน้อย 8 ตัวอักษร' },
        { status: 400 }
      );
    }

    await connectMongoDB();

    // เผื่อคุณปรับ password ให้ select:false ในอนาคต ก็ยังใช้ได้
    const user = await User.findOne({ email: session.user.email }).select('+password');
    if (!user) {
      return NextResponse.json({ ok: false, message: 'ไม่พบบัญชีผู้ใช้' }, { status: 404 });
    }

    const stored = user.password;
    if (typeof stored !== 'string' || stored.length === 0) {
      return NextResponse.json({ ok: false, message: 'ข้อมูลรหัสผ่านไม่ถูกต้อง' }, { status: 500 });
    }

    // ✅ รองรับทั้ง hashed และ plain (กรณีเคยเก็บ plain มาก่อน)
    const matched = isBcryptHash(stored)
      ? await bcrypt.compare(currentPassword, stored)
      : currentPassword === stored;

    if (!matched) {
      return NextResponse.json({ ok: false, message: 'รหัสผ่านเดิมไม่ถูกต้อง' }, { status: 400 });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    // ใช้ updateOne เพื่อกันเคสมี pre-save hash แล้วโดน hash ซ้ำ
    await User.updateOne({ _id: user._id }, { $set: { password: newHash } });

    return NextResponse.json({ ok: true, message: 'เปลี่ยนรหัสผ่านสำเร็จ' }, { status: 200 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ ok: false, message: 'Server error' }, { status: 500 });
  }
}
