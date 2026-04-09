import mongoose, { Schema, type Model } from "mongoose";

export type FriendRelationStatus = "pending" | "accepted" | "rejected" | "canceled";

export interface IFriendRelation extends mongoose.Document {
  pairKey: string;
  requesterId: mongoose.Types.ObjectId;
  addresseeId: mongoose.Types.ObjectId;
  status: FriendRelationStatus;
  createdAt: Date;
  updatedAt: Date;
  respondedAt?: Date | null;
}

function buildPairKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

const friendRelationSchema = new Schema<IFriendRelation>(
  {
    pairKey: { type: String, required: true, unique: true, index: true },
    requesterId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    addresseeId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "canceled"],
      default: "pending",
      index: true,
    },
    respondedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

friendRelationSchema.index({ requesterId: 1, status: 1, updatedAt: -1 });
friendRelationSchema.index({ addresseeId: 1, status: 1, updatedAt: -1 });

export { buildPairKey };

const FriendRelation: Model<IFriendRelation> =
  mongoose.models.FriendRelation ||
  mongoose.model<IFriendRelation>("FriendRelation", friendRelationSchema);

export default FriendRelation;
