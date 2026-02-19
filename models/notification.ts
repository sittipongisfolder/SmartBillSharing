import mongoose, { Schema, Model } from 'mongoose';

export type NotificationType =
  | 'BILL_ADDED_YOU'
  | 'BILL_UPDATED'
  | 'BILL_STATUS_CHANGED'
  | 'BILL_CLOSED'
  | 'DAILY_UNPAID_SUMMARY'
  | 'GROUP_MEMBER_CHANGED'
  | 'GROUP_UPDATED'
  | 'GROUP_NEW_BILL';

export interface INotification extends mongoose.Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;

  // ใช้สำหรับปุ่ม “ไปยังบิลนี้/ไปยังกลุ่มนี้”
  billId?: mongoose.Types.ObjectId;
  groupId?: mongoose.Types.ObjectId;
  href?: string;

  // ใช้แสดง “ค้างกี่วันแล้ว” / หรือ summary
  meta?: {
    overdueDays?: number;           // ของ notification ที่เกี่ยวกับค้าง
    unpaidCount?: number;           // summary
    totalOwed?: number;             // summary
  };

  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true },
    message: { type: String, required: true },

    billId: { type: Schema.Types.ObjectId, ref: 'Bill' },
    groupId: { type: Schema.Types.ObjectId, ref: 'Group' },
    href: { type: String },

    meta: {
      overdueDays: { type: Number },
      unpaidCount: { type: Number },
      totalOwed: { type: Number },
    },

    isRead: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// ช่วย query เร็ว
notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

const Notification: Model<INotification> =
  mongoose.models.Notification || mongoose.model<INotification>('Notification', notificationSchema);

export default Notification;
