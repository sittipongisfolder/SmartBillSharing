import mongoose, { Schema, Model } from 'mongoose';

export interface IGuest extends mongoose.Document {
  displayName: string;
  lineUserId?: string; // Step LINE จะมาเติม
  linkedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const guestSchema = new Schema<IGuest>(
  {
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    lineUserId: { type: String, index: true },
    linkedAt: { type: Date },
  },
  { timestamps: true }
);

const Guest: Model<IGuest> =
  mongoose.models.Guest || mongoose.model<IGuest>('Guest', guestSchema);

export default Guest;
