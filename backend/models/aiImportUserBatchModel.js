import mongoose from "mongoose";

const createdUserSnapshotSchema = new mongoose.Schema(
  {
    rowId: { type: String, default: "" },
    rowNumber: { type: Number, default: 0 },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    nickname: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    password: { type: String, default: "" },
  },
  { _id: false }
);

const resultSnapshotSchema = new mongoose.Schema(
  {
    rowId: { type: String, default: "" },
    rowNumber: { type: Number, default: 0 },
    status: { type: String, default: "" },
    registrationId: { type: String, default: "" },
    error: { type: String, default: "" },
  },
  { _id: false }
);

const aiImportUserBatchSchema = new mongoose.Schema(
  {
    tournament: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tournament",
      required: true,
      index: true,
    },
    actor: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },
    source: {
      selectedRowIds: { type: [String], default: [] },
      selectedRowNumbers: { type: [Number], default: [] },
      paidRowIds: { type: [String], default: [] },
    },
    createdRegistrations: { type: Number, default: 0 },
    createdUsers: { type: Number, default: 0 },
    credentials: { type: [createdUserSnapshotSchema], default: [] },
    results: { type: [resultSnapshotSchema], default: [] },
  },
  { timestamps: true }
);

aiImportUserBatchSchema.index({ tournament: 1, createdAt: -1 });
aiImportUserBatchSchema.index({ "actor.id": 1, createdAt: -1 });

export default mongoose.model("AiImportUserBatch", aiImportUserBatchSchema);
