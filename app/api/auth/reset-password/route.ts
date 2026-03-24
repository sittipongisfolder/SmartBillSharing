import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectMongoDB } from '@/lib/mongodb';
import { hashPasswordResetToken, validatePassword } from '@/lib/passwordReset';
import User from '@/models/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResetPasswordBody = {
  token?: string;
  password?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ResetPasswordBody;
    const token = (body.token ?? '').trim();
    const password = body.password ?? '';

    if (!token || !password) {
      return NextResponse.json(
        { ok: false, message: 'ข้อมูลไม่ครบถ้วน' },
        { status: 400 },
      );
    }

    if (!validatePassword(password)) {
      return NextResponse.json(
        { ok: false, message: 'รหัสผ่านใหม่ควรมีอย่างน้อย 8 ตัวอักษร' },
        { status: 400 },
      );
    }

    await connectMongoDB();

    const hashedToken = hashPasswordResetToken(token);
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpiresAt: { $gt: new Date() },
    }).select('_id');

    if (!user) {
      return NextResponse.json(
        { ok: false, message: 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้องหรือหมดอายุแล้ว' },
        { status: 400 },
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          password: passwordHash,
          resetPasswordToken: null,
          resetPasswordExpiresAt: null,
        },
      },
    );

    return NextResponse.json({ ok: true, message: 'ตั้งรหัสผ่านใหม่สำเร็จ' });
  } catch (error) {
    console.error('Reset password error:', error);
    return NextResponse.json(
      { ok: false, message: 'Server error' },
      { status: 500 },
    );
  }
}