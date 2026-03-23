import mongoose, {
  Schema,
  models,
  type InferSchemaType,
  type Model,
} from "mongoose";

const slipInfoSchema = new Schema(
  {
    imageUrl: { type: String, default: "" },
    publicId: { type: String },
    provider: { type: String, default: "" },
    reference: { type: String, default: "" },
    checkedAt: { type: Date },
    verified: { type: Boolean, default: false },
  },
  { _id: false },
);

const participantSchema = new Schema(
  {
    kind: {
      type: String,
      enum: ["user", "guest_placeholder", "guest"],
      default: "user",
      index: true,
    },

    userId: { type: Schema.Types.ObjectId, ref: "User" },
    guestId: { type: Schema.Types.ObjectId, ref: "Guest" },

    name: { type: String, required: true, trim: true },

    // ใช้บอกว่า slot นี้ถูก claim แล้วหรือยัง
    joinedAt: { type: Date },

    // จำนวนเงินสุดท้ายของ participant คนนี้
    amount: { type: Number, required: true, default: 0 },

    paymentStatus: {
      type: String,
      enum: ["unpaid", "paid"],
      default: "unpaid",
      index: true,
    },

    slipInfo: { type: slipInfoSchema, default: undefined },
    paidAt: { type: Date },
  },
  // ✅ สำคัญ: ต้องให้ participant มี _id เพื่อเอาไปผูกกับ item
  { _id: true },
);

const itemSchema = new Schema(
  {
    items: { type: String, required: true, trim: true },

    qty: { type: Number, default: 1, min: 1 },
    unitPrice: { type: Number, default: 0, min: 0 },

    // line total ของรายการนี้
    price: { type: Number, required: true, min: 0 },

    splitMode: {
      type: String,
      enum: ["equal", "single", "shared"],
      default: "equal",
    },

    // ✅ ผูก item กับ participant slot โดยตรง
    assignedParticipantIds: {
      type: [Schema.Types.ObjectId],
      default: [],
    },
  },
  { _id: true },
);

const billSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    items: { type: [itemSchema], required: true, default: [] },
    totalPrice: { type: Number, required: true, min: 0 },

    splitType: {
      type: String,
      enum: ["equal", "percentage", "personal"],
      required: true,
    },

    participants: { type: [participantSchema], default: [] },
    description: { type: String, default: "" },

    // ✅ Receipt image from OCR upload
    receiptImageUrl: { type: String, default: "" },
    receiptImagePublicId: { type: String },

    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },

    stage: {
      type: String,
      enum: ["draft", "active"],
      default: "active",
      index: true,
    },
    publishedAt: { type: Date },
    draftExpiresAt: { type: Date, default: undefined },

    billStatus: {
      type: String,
      enum: ["unpaid", "pending", "paid"],
      default: "unpaid",
      index: true,
    },
  },
  { timestamps: false },
);

billSchema.index({ stage: 1, createdBy: 1 });
billSchema.index({ "participants.userId": 1 });
billSchema.index({ "participants.guestId": 1 });
billSchema.index({ "participants.kind": 1 });
billSchema.index(
  { draftExpiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { stage: "draft" },
  }
);  

export type BillSchemaType = InferSchemaType<typeof billSchema>;
type BillModelType = Model<BillSchemaType>;

const Bill =
  (models.Bill as BillModelType) ||
  mongoose.model<BillSchemaType>("Bill", billSchema);

export default Bill;