import mongoose, { Schema, Model } from 'mongoose';

export interface IInvite extends mongoose.Document {
  billId: mongoose.Types.ObjectId;
  participantId: mongoose.Types.ObjectId;
  guestId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  tokenHash: string;
  tokenPlain?: string;
  revoked: boolean;
  expiresAt?: Date | null;
  maxUses?: number | null;
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const inviteSchema = new Schema<IInvite>(
  {
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },
    participantId: { type: Schema.Types.ObjectId, required: true, index: true },
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', index: true, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    tokenPlain: { type: String, default: '' },

    revoked: { type: Boolean, default: false, index: true },
    expiresAt: { type: Date, default: null, index: true },

    maxUses: { type: Number, default: null },
    usedCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

inviteSchema.index({ billId: 1, participantId: 1, revoked: 1, expiresAt: 1 });

const Invite: Model<IInvite> =
  mongoose.models.Invite || mongoose.model<IInvite>('Invite', inviteSchema);

export default Invite;