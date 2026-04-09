import mongoose, { Schema, Model } from 'mongoose';

export interface IGuest extends mongoose.Document {
  displayName: string;
  createdAt: Date;
  updatedAt: Date;
}

const guestSchema = new Schema<IGuest>(
  {
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true }
);

const Guest: Model<IGuest> =
  mongoose.models.Guest || mongoose.model<IGuest>('Guest', guestSchema);

export default Guest;
