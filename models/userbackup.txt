import mongoose, { Schema, Document, Model } from "mongoose";

interface IUser extends Document {
  name: string;
  email: string;
  password: string;

  bank: string;
  bankAccountNumber: string;

  // ✅ บังคับ PromptPay (เบอร์โทรอย่างเดียว)
  promptPayPhone: string;

  role?: "user" | "admin";
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

    bank: { type: String, required: true, trim: true },

    bankAccountNumber: {
      type: String,
      required: true,
      trim: true,
      // (ถ้าคุณยังอยากใช้เลขบัญชี 10 หลักเหมือนเดิม)
      match: [/^\d{10}$/, "bankAccountNumber must be 10 digits"],
    },

    promptPayPhone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      index: true,
      match: [/^0\d{9}$/, "promptPayPhone must be 10 digits and start with 0"],
    },

    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true }
);

// ✅ กันปัญหา hot-reload + ใช้ schema เดียว
const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>("User", userSchema);

export default User;
