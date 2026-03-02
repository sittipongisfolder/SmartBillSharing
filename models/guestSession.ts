import mongoose, { Schema, Model } from 'mongoose';

export interface IGuestSession extends mongoose.Document {
  guestId: mongoose.Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const guestSessionSchema = new Schema<IGuestSession>(
  {
    guestId: { type: Schema.Types.ObjectId, ref: 'Guest', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } }, // TTL
  },
  { timestamps: true }
);

const GuestSession: Model<IGuestSession> =
  mongoose.models.GuestSession ||
  mongoose.model<IGuestSession>('GuestSession', guestSessionSchema);

export default GuestSession;
