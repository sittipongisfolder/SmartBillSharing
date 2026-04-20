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
  promptPayPhone?: unknown;
};

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function normalizePhone(v: string): string {
  // เอาเฉพาะตัวเลข
  return v.replace(/\D/g, "");
}

function normalizeDigits(v: string): string {
  return v.replace(/\D/g, "");
}

function isThaiPhone10Digits(v: string): boolean {
  // 10 หลัก และขึ้นต้นด้วย 0 (เช่น 08x, 09x, 06x)
  return /^0\d{9}$/.test(v);
}

function isStrongPassword(v: string): boolean {
  return /^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(v);
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RegisterBody;

    const username = isNonEmptyString(body.username) ? body.username.trim() : "";
    const email = isNonEmptyString(body.email) ? body.email.trim().toLowerCase() : "";
    const password = isNonEmptyString(body.password) ? body.password : "";
    const bank = isNonEmptyString(body.bank) ? body.bank.trim() : "";
    const bankAccountRaw = isNonEmptyString(body.bankAccountNumber) ? body.bankAccountNumber : "";
    const bankAccountNumber = normalizeDigits(bankAccountRaw.trim());
    const promptPayPhoneRaw = isNonEmptyString(body.promptPayPhone) ? body.promptPayPhone : "";

    // ✅ บังคับเฉพาะข้อมูลหลัก (PromptPay ไม่บังคับ)
    if (!username || !email || !password || !bank || !bankAccountNumber) {
      return NextResponse.json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" }, { status: 400 });
    }

    if (!isStrongPassword(password)) {
      return NextResponse.json(
        { error: "รหัสผ่านต้องมีอย่างน้อย 8 ตัว และต้องมีทั้งตัวอักษรและตัวเลข" },
        { status: 400 },
      );
    }

    // ✅ validate เลขบัญชี 10-12 หลัก
    if (!/^\d{10,12}$/.test(bankAccountNumber)) {
      return NextResponse.json({ error: "กรุณากรอกหมายเลขบัญชีธนาคารให้ถูกต้อง (10-12 หลัก)" }, { status: 400 });
    }

    // ✅ validate PromptPay เฉพาะกรณีที่กรอก
    const promptPayPhone = normalizePhone(promptPayPhoneRaw);
    if (promptPayPhone && !isThaiPhone10Digits(promptPayPhone)) {
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

    // ✅ กันเลขบัญชีซ้ำ
    const existingBankAccount = await User.findOne({ bankAccountNumber });
    if (existingBankAccount) {
      return NextResponse.json({ error: "เลขบัญชีธนาคารนี้ถูกใช้งานแล้ว" }, { status: 400 });
    }

    // ✅ กัน promptPayPhone ซ้ำเฉพาะกรณีที่มีการกรอก
    if (promptPayPhone) {
      const existingPromptPay = await User.findOne({ promptPayPhone });
      if (existingPromptPay) {
        return NextResponse.json({ error: "PromptPay เบอร์นี้ถูกใช้งานแล้ว" }, { status: 400 });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUserData: {
      name: string;
      email: string;
      password: string;
      bank: string;
      bankAccountNumber: string;
      role: "user";
      promptPayPhone?: string;
    } = {
      name: username,
      email,
      password: hashedPassword,
      bank,
      bankAccountNumber,
      role: "user",
    };

    if (promptPayPhone) {
      newUserData.promptPayPhone = promptPayPhone;
    }

    await User.create(newUserData);

    return NextResponse.json({ message: "User registered successfully" }, { status: 201 });
  } catch (error) {
    console.error("❌ Error occurred:", error);

    // แปลง duplicate key จาก MongoDB ให้เป็นข้อความที่ผู้ใช้เข้าใจง่าย
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      const keyPattern =
        "keyPattern" in error && typeof (error as { keyPattern?: unknown }).keyPattern === "object"
          ? ((error as { keyPattern?: Record<string, 1> }).keyPattern ?? {})
          : {};
      const keyValue =
        "keyValue" in error && typeof (error as { keyValue?: unknown }).keyValue === "object"
          ? ((error as { keyValue?: Record<string, unknown> }).keyValue ?? {})
          : {};
      const errorMessage =
        "message" in error && typeof (error as { message?: unknown }).message === "string"
          ? (error as { message: string }).message
          : "";

      const duplicatedField =
        Object.keys(keyPattern)[0] ||
        Object.keys(keyValue)[0] ||
        (/(email|name|username|bankAccountNumber|promptPayPhone)/i.exec(errorMessage)?.[1] ?? "");

      if (duplicatedField === "email") {
        return NextResponse.json({ error: "Email is already in use" }, { status: 400 });
      }

      if (duplicatedField === "name" || duplicatedField === "username") {
        return NextResponse.json({ error: "Username is already taken" }, { status: 400 });
      }

      if (duplicatedField === "promptPayPhone") {
        return NextResponse.json({ error: "PromptPay เบอร์นี้ถูกใช้งานแล้ว" }, { status: 400 });
      }

      if (duplicatedField === "bankAccountNumber") {
        return NextResponse.json({ error: "เลขบัญชีธนาคารนี้ถูกใช้งานแล้ว" }, { status: 400 });
      }

      return NextResponse.json({ error: "ข้อมูลนี้ถูกใช้งานแล้ว" }, { status: 400 });
    }

    return NextResponse.json({ error: "Invalid data" }, { status: 500 });
  }
}
