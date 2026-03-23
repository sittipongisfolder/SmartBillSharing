import mongoose, { Schema, models, type InferSchemaType, type Model } from 'mongoose';

const guestAccessLinkSchema = new Schema(
  {
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true, index: true },
    billId: { type: Schema.Types.ObjectId, ref: 'Bill', required: true, index: true },

    tokenHash: { type: String, required: true, unique: true, index: true },
    tokenLast4: { type: String, default: '' },

    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, index: true },

    createdAt: { type: Date, default: Date.now },
    lastUsedAt: { type: Date },
  },
  { timestamps: false }
);

guestAccessLinkSchema.index({ guestId: 1, billId: 1, isActive: 1 });

export type GuestAccessLinkSchemaType = InferSchemaType<typeof guestAccessLinkSchema>;
type GuestAccessLinkModelType = Model<GuestAccessLinkSchemaType>;

const GuestAccessLink =
  (models.GuestAccessLink as GuestAccessLinkModelType) ||
  mongoose.model<GuestAccessLinkSchemaType>('GuestAccessLink', guestAccessLinkSchema);

export default GuestAccessLink;