import mongoose from "mongoose";
const { Schema } = mongoose;

const ChangeSchema = new Schema(
  {
    field: { type: String, required: true }, // vd: "name", "avatar", "province"
    from: { type: Schema.Types.Mixed, default: null },
    to: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const AuditLogSchema = new Schema(
  {
    entityType: { type: String, required: true, index: true }, // "User"
    entityId: { type: Schema.Types.ObjectId, required: true, index: true },

    action: {
      type: String,
      enum: ["CREATE", "UPDATE", "DELETE", "OTHER"],
      default: "UPDATE",
      index: true,
    },

    actor: {
      id: { type: Schema.Types.ObjectId, ref: "User", default: null },
      kind: { type: String, default: "user" }, // user/admin/system
      ip: { type: String, default: "" },
      userAgent: { type: String, default: "" },
    },

    changes: { type: [ChangeSchema], default: [] },
    note: { type: String, default: "" },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { versionKey: false }
);

AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

export default mongoose.model("AuditLog", AuditLogSchema);
