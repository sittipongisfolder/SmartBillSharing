// models/lineLinkCode.ts
import mongoose, { Schema, Types, models, model } from "mongoose";

export interface LineLinkCodeDoc extends mongoose.Document {
  userId: Types.ObjectId;
  codeHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

const LineLinkCodeSchema = new Schema<LineLinkCodeDoc>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    codeHash: { type: String, required: true, unique: true, index: true },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // TTL
    },
    usedAt: { type: Date, default: null, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export default models.LineLinkCode || model<LineLinkCodeDoc>("LineLinkCode", LineLinkCodeSchema);