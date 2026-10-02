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
    // Ghi nhớ VỊ TRÍ OVERLAY mặc định cho SÂN này (auto-live) — để tạo live lần sau
    // không phải chỉnh lại. Tự cập nhật mỗi khi đổi vị trí overlay lúc đang live.
    // Giá trị góc: top-left / top-right / bottom-left / bottom-right.
    overlayLayout: {
      scoreboard: { type: String, default: "" },
      brand: { type: String, default: "" },
      sponsor: { type: String, default: "" },
    },
    // Ghi nhớ KIỂU overlay mặc định cho sân ("classic"/"A"/"B"/"C"/"D"/"url").
    overlayStyle: { type: String, default: "" },
    // Ghi nhớ logo thương hiệu overlay cho sân (URL ảnh; rỗng = logo PickleTour mặc định).
    brandLogoUrl: { type: String, default: "" },
    // Ghi nhớ kiểu tên hiển thị overlay cho sân: "nick" (biệt danh) | "full" (họ tên).
    nameMode: { type: String, enum: ["nick", "full"], default: "nick" },
    defaultReferees: [
      { type: Types.ObjectId, ref: "User", default: undefined },
    ],
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
