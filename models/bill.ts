import mongoose, { Schema, models } from 'mongoose';

// Schema ของรายการอาหาร
// const itemSchema = new Schema({
//   name: { type: String, required: true },
//   price: { type: Number, required: true }
// });

/**
 * ✅ เคส A:
 * - PaymentStatus (ของคนจ่าย) = unpaid | paid เท่านั้น
 * - billStatus (ของบิลรวม) ยังใช้ unpaid | pending | paid ได้
 */
export type PaymentStatus = 'unpaid' | 'paid';

// Schema ของผู้เข้าร่วมบิล
const participantSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true },
    amount: { type: Number, required: true },

    // ✅ สถานะการจ่ายของแต่ละคน (เคส A: ไม่มี pending)
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
      index: true,
    },

    // ✅ เผื่อไว้สำหรับสลิป (ไม่บังคับ)
    slipInfo: {
      imageUrl: { type: String, default: '' },     // url รูปสลิป (ถ้ามี)
      publicId: { type: String },
      provider: { type: String, default: '' },     // ชื่อ provider ที่ check slip
      reference: { type: String, default: '' },    // ref จาก provider
      checkedAt: { type: Date },                   // เวลาเช็ค
      verified: { type: Boolean, default: false }, // ผ่าน/ไม่ผ่าน
    },

    paidAt: { type: Date }, // optional: เวลาที่ paid จริง
  },
  { _id: false }
);

const itemsList = new Schema(
  {
    items: { type: String, required: true },
    price: { type: Number, required: true },
  },
  { _id: false }
);

// Schema ของบิล
const billSchema = new Schema({
  title: { type: String, required: true },
  items: { type: [itemsList], required: true },
  totalPrice: { type: Number, required: true },

  splitType: {
    type: String,
    enum: ['equal', 'percentage', 'personal'],
    required: true,
  },

  participants: { type: [participantSchema], default: [] },
  description: { type: String, default: '' },

  createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now },

  // ✅ สถานะรวมของบิล (คำนวณจาก participants)
  
  billStatus: {
    type: String,
    enum: ['unpaid', 'pending', 'paid'],
    default: 'unpaid',
    index: true,
  },
});

// เช็คว่า Model 'Bill' มีอยู่ใน models หรือไม่
const Bill = models.Bill || mongoose.model('Bill', billSchema);

export default Bill;
