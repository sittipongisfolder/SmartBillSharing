import mongoose, { Schema, Document, Model } from "mongoose";

export type AuditAction =
  | "LOGIN"
  | "USER_REGISTERED"
  | "BILL_CREATED"
  | "BILL_UPDATED"
  | "SLIP_UPLOADED"
  | "BILL_CLOSED";

export interface IAuditLog extends Document {
  actorId: string;          // user _id
  actorEmail: string | null;
  action: AuditAction;
  targetType: "bill" | "user" | "system";
  targetId: string | null;  // billId/userId
  ip: string | null;
  userAgent: string | null;
  meta: Record<string, unknown>;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: String, required: true, index: true },
    actorEmail: { type: String, default: null, index: true },
    action: { type: String, required: true, index: true },
    targetType: { type: String, required: true, index: true },
    targetId: { type: String, default: null, index: true },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

const AuditLog: Model<IAuditLog> =
  mongoose.models.AuditLog || mongoose.model<IAuditLog>("AuditLog", auditLogSchema);

export default AuditLog;