import mongoose, { Schema, Model } from 'mongoose';
import type { NotificationType } from './notification';

export interface INotificationSettings extends mongoose.Document {
  userId: mongoose.Types.ObjectId;

  enabledTypes: NotificationType[];     // เปิด/ปิดแต่ละประเภท
  followGroupIds: mongoose.Types.ObjectId[];

  // สรุปค้างรายวัน
  dailySummaryEnabled: boolean;
  dailySummaryHour: number; // 16:00 ตาม Asia/Bangkok แบบคงที่
  lastDailySummaryAt?: Date; // กันส่งซ้ำวันเดียวกัน
}

const settingsSchema = new Schema<INotificationSettings>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', unique: true, required: true },

    enabledTypes: { type: [String], default: [] },
    followGroupIds: { type: [Schema.Types.ObjectId], ref: 'Group', default: [] },

    dailySummaryEnabled: { type: Boolean, default: true },
    dailySummaryHour: { type: Number, default: 16 }, // ค่าเริ่มต้น 16:00 (เวลาไทย)
    lastDailySummaryAt: { type: Date },
  },
  { timestamps: true }
);

const NotificationSettings: Model<INotificationSettings> =
  mongoose.models.NotificationSettings ||
  mongoose.model<INotificationSettings>('NotificationSettings', settingsSchema);

export default NotificationSettings;
