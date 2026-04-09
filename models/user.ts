import mongoose, { Schema, Document, Model } from "mongoose";

type UserRole = "user" | "admin";

type LineInfo = {
  userId: string | null; // LINE userId ที่ได้จาก webhook
  linkedAt: Date | null; // เวลาที่ผูกสำเร็จ
};

interface IUser extends Document {
  name: string;
  email: string;
  password: string;
  resetPasswordToken?: string;
  resetPasswordExpiresAt?: Date | null;

  bank: string;
  bankAccountNumber: string;

  // ✅ PromptPay ไม่บังคับ
  promptPayPhone?: string;

  role?: UserRole;

  // ✅ เพิ่มสำหรับ LINE OA
  line?: LineInfo;
  lineNotifyEnabled?: boolean;
}

const userSchema: Schema<IUser> = new Schema(
  {
    name: { type: String, required: true, trim: true },

    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },

    password: { type: String, required: true },

  resetPasswordToken: { type: String, default: null, index: true },

  resetPasswordExpiresAt: { type: Date, default: null },

    bank: { type: String, required: true, trim: true },

    bankAccountNumber: {
      type: String,
      required: true,
      trim: true,
      match: [/^\d{10,12}$/, "bankAccountNumber must be 10-12 digits"],
    },

    promptPayPhone: {
      type: String,
      required: false,
      trim: true,
      unique: true,
      sparse: true,
      index: true,
      match: [/^0\d{9}$/, "promptPayPhone must be 10 digits and start with 0"],
    },

    role: { type: String, enum: ["user", "admin"], default: "user" },

    // ✅ LINE OA link
    line: {
      userId: { type: String }, // ❌ ไม่ต้อง default null
      linkedAt: { type: Date }, // ❌ ไม่ต้อง default null
    },

    // ✅ เปิด/ปิดแจ้งเตือน LINE (ใช้กับ lineNotifyEnabled)
    lineNotifyEnabled: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// ✅ ทำ index ให้ line.userId เป็น unique แบบ sparse (กัน null ชนกัน)
userSchema.index(
  { "line.userId": 1 },
  {
    unique: true,
    partialFilterExpression: { "line.userId": { $type: "string" } },
  }
);

// ✅ กันปัญหา hot-reload + ใช้ schema เดียว
const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>("User", userSchema);

export default User;
