import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { connectMongoDB } from "@/lib/mongodb";
import User from "@/models/user";
import bcrypt from "bcryptjs";

type RegisterBody = {
  username?: unknown;
  email?: unknown;
  password?: unknown;
  bank?: unknown;
  bankAccountNumber?: unknown;
  promptPayPhone?: unknown; // ✅ บังคับ
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizePhone(v: string): string {
  // เอาเฉพาะตัวเลข
  return v.replace(/\D/g, "");
}

function isThaiPhone10Digits(v: string): boolean {
  // 10 หลัก และขึ้นต้นด้วย 0 (เช่น 08x, 09x, 06x)
  return /^0\d{9}$/.test(v);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterBody;

    const username = isNonEmptyString(body.username) ? body.username.trim() : "";
    const email = isNonEmptyString(body.email) ? body.email.trim().toLowerCase() : "";
    const password = isNonEmptyString(body.password) ? body.password : "";
    const bank = isNonEmptyString(body.bank) ? body.bank.trim() : "";
    const bankAccountNumber = isNonEmptyString(body.bankAccountNumber)
      ? body.bankAccountNumber.trim()
      : "";
    const promptPayPhoneRaw = isNonEmptyString(body.promptPayPhone) ? body.promptPayPhone : "";

    // ✅ บังคับกรอกทุกช่อง + promptPayPhone
    if (!username || !email || !password || !bank || !bankAccountNumber || !promptPayPhoneRaw) {
      return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" }, { status: 400 });
    }

    // ✅ validate เลขบัญชี (ของเดิมคุณ)
    if (!/^\d{10}$/.test(bankAccountNumber)) {
      return NextResponse.json({ error: "กรุณากรอกหมายเลขบัญชีธนาคารให้ครบ 10 ตัว (ตัวเลขเท่านั้น)" }, { status: 400 });
    }

    // ✅ validate PromptPay เบอร์โทร 10 หลัก (เก็บเป็น string)
    const promptPayPhone = normalizePhone(promptPayPhoneRaw);
    if (!isThaiPhone10Digits(promptPayPhone)) {
      return NextResponse.json({ error: "กรุณากรอกเบอร์ PromptPay ให้ถูกต้อง (10 หลัก เช่น 08xxxxxxxx)" }, { status: 400 });
    }

    await connectMongoDB();

    // ✅ กัน email ซ้ำ
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return NextResponse.json({ error: "Email is already in use" }, { status: 400 });
    }

    // ✅ กัน username ซ้ำ
    const existingUsername = await User.findOne({ name: username });
    if (existingUsername) {
      return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
    }

    // ✅ (แนะนำ) กัน promptPayPhone ซ้ำด้วย
    const existingPromptPay = await User.findOne({ promptPayPhone });
    if (existingPromptPay) {
      return NextResponse.json({ error: "PromptPay เบอร์นี้ถูกใช้งานแล้ว" }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      name: username,
      email,
      password: hashedPassword,
      bank,
      bankAccountNumber,
      promptPayPhone, // ✅ เก็บจริง
      role: "user",
    });

    return NextResponse.json({ message: "User registered successfully" }, { status: 201 });
  } catch (error) {
    console.error("❌ Error occurred:", error);
    return NextResponse.json({ error: "Invalid data" }, { status: 500 });
  }
}
