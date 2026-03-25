import mongoose from "mongoose";

const { Schema, Types } = mongoose;

const liveConfigSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    videoUrl: { type: String, default: "" },
    overrideExisting: { type: Boolean, default: false },
    advancedSettingEnabled: { type: Boolean, default: false },
    pageMode: {
      type: String,
      enum: ["default", "custom"],
      default: "default",
    },
    pageConnectionId: { type: String, default: null },
    pageConnectionName: { type: String, default: "" },
    advancedSetting: { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const presenceSchema = new Schema(
  {
    screenState: { type: String, default: "" },
    liveScreenPresence: { type: Schema.Types.Mixed, default: null },
    lastSeenAt: { type: Date, default: null },
    legacyCourtId: { type: Types.ObjectId, ref: "Court", default: null },
  },
  { _id: false }
);

const assignmentQueueItemSchema = new Schema(
  {
    matchId: {
      type: Types.ObjectId,
      ref: "Match",
      required: true,
    },
    order: { type: Number, default: 1 },
    queuedAt: { type: Date, default: Date.now },
    queuedBy: { type: Types.ObjectId, ref: "User", default: null },
  },
  { _id: false }
);

const assignmentQueueSchema = new Schema(
  {
    items: {
      type: [assignmentQueueItemSchema],
      default: [],
    },
  },
  { _id: false }
);

const courtStationSchema = new Schema(
  {
    clusterId: {
      type: Types.ObjectId,
      ref: "CourtCluster",
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    code: { type: String, default: "", trim: true, uppercase: true },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["idle", "assigned", "live", "maintenance"],
      default: "idle",
    },
    assignmentMode: {
      type: String,
      enum: ["manual", "queue"],
      default: "manual",
    },
    assignmentQueue: {
      type: assignmentQueueSchema,
      default: () => ({ items: [] }),
    },
    currentMatch: { type: Types.ObjectId, ref: "Match", default: null },
    currentTournament: {
      type: Types.ObjectId,
      ref: "Tournament",
      default: null,
      index: true,
    },
    liveConfig: { type: liveConfigSchema, default: () => ({}) },
    presence: { type: presenceSchema, default: () => ({}) },
  },
  { timestamps: true }
);

courtStationSchema.index({ clusterId: 1, order: 1, createdAt: 1 });
courtStationSchema.index({ clusterId: 1, isActive: 1, status: 1 });
courtStationSchema.index({ "assignmentQueue.items.matchId": 1 });
courtStationSchema.index(
  { clusterId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: {
      code: { $type: "string", $ne: "" },
    },
  }
);
courtStationSchema.index(
  { currentMatch: 1 },
  {
    unique: true,
    partialFilterExpression: {
      currentMatch: { $type: "objectId" },
    },
  }
);

export default mongoose.model("CourtStation", courtStationSchema);
