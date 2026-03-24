import { NextResponse } from 'next/server';
import { connectMongoDB } from '@/lib/mongodb';
import { buildPasswordResetUrl, createPasswordResetToken } from '@/lib/passwordReset';
import { sendPasswordResetEmail } from '@/lib/mailer';
import User from '@/models/user';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ForgotPasswordBody = {
  email?: string;
};

const GENERIC_RESPONSE = {
  ok: true,
  message: 'หากอีเมลนี้มีอยู่ในระบบ เราได้ส่งลิงก์รีเซ็ตรหัสผ่านให้แล้ว',
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ForgotPasswordBody;
    const email = normalizeEmail(body.email ?? '');

    if (!email) {
      return NextResponse.json(
        { ok: false, message: 'กรุณากรอกอีเมล' },
        { status: 400 },
      );
    }

    await connectMongoDB();

    const user = await User.findOne({ email }).select('_id email name');
    if (!user) {
      return NextResponse.json(GENERIC_RESPONSE);
    }

    const { rawToken, hashedToken, expiresAt } = createPasswordResetToken();
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          resetPasswordToken: hashedToken,
          resetPasswordExpiresAt: expiresAt,
        },
      },
    );

    const resetUrl = buildPasswordResetUrl(rawToken);

    try {
      await sendPasswordResetEmail({
        to: user.email,
        name: user.name,
        resetUrl,
      });
    } catch (error) {
      await User.updateOne(
        { _id: user._id },
        {
          $set: {
            resetPasswordToken: null,
            resetPasswordExpiresAt: null,
          },
        },
      );

      console.error('Failed to send password reset email:', error);
      return NextResponse.json(
        { ok: false, message: 'ไม่สามารถส่งอีเมลรีเซ็ตรหัสผ่านได้' },
        { status: 500 },
      );
    }

    return NextResponse.json(GENERIC_RESPONSE);
  } catch (error) {
    console.error('Forgot password error:', error);
    return NextResponse.json(
      { ok: false, message: 'Server error' },
      { status: 500 },
    );
  }
}