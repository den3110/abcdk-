import mongoose from "mongoose";

// Trạng thái HIỆN TẠI của mỗi máy live (1 doc / source+deviceId). App live gửi heartbeat
// định kỳ + event tức thời; controller upsert vào đây. TTL tự dọn doc cũ theo expireAt.
const liveDeviceStateSchema = new mongoose.Schema(
  {
    source: { type: String, required: true, trim: true, index: true },
    deviceId: { type: String, required: true, trim: true, index: true },
    platform: { type: String, default: "ios", trim: true, index: true },

    deviceName: { type: String, default: "", trim: true },
    deviceModel: { type: String, default: "", trim: true },
    deviceManufacturer: { type: String, default: "", trim: true },
    deviceBrand: { type: String, default: "", trim: true },
    deviceProduct: { type: String, default: "", trim: true },

    operatorUserId: { type: String, default: "", trim: true, index: true },
    operatorName: { type: String, default: "", trim: true },
    operatorRole: { type: String, default: "", trim: true },

    routeLabel: { type: String, default: "", trim: true },
    screenState: { type: String, default: "", trim: true },
    courtId: { type: String, default: "", trim: true, index: true },
    courtName: { type: String, default: "", trim: true },
    matchId: { type: String, default: "", trim: true },
    matchCode: { type: String, default: "", trim: true },
    streamState: { type: String, default: "", trim: true, index: true },
    overlayIssue: { type: String, default: "", trim: true },
    recoverySeverity: { type: String, default: "", trim: true },
    recoveryStage: { type: String, default: "", trim: true },

    warningCount: { type: Number, default: 0 },
    heartbeatIntervalMs: { type: Number, default: 10000 },
    staleAfterMs: { type: Number, default: 30000 },

    capturedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: Date.now, index: true },
    receivedAt: { type: Date, default: Date.now },

    lastEventType: { type: String, default: "", trim: true },
    lastEventLevel: { type: String, default: "", trim: true },
    lastEventReasonCode: { type: String, default: "", trim: true },
    lastEventReasonText: { type: String, default: "", trim: true },
    lastEventAt: { type: Date, default: null },
    lastCrashRecoveredAt: { type: Date, default: null },
    lastCrashRecoveredReason: { type: String, default: "", trim: true },
    lastLifecycleEventType: { type: String, default: "", trim: true },
    lastLifecycleEventAt: { type: Date, default: null },
    lastLifecycleEventReason: { type: String, default: "", trim: true },

    // Các khối con nguyên bản để dashboard xem chi tiết
    app: { type: mongoose.Schema.Types.Mixed, default: {} },
    device: { type: mongoose.Schema.Types.Mixed, default: {} },
    operator: { type: mongoose.Schema.Types.Mixed, default: {} },
    route: { type: mongoose.Schema.Types.Mixed, default: {} },
    court: { type: mongoose.Schema.Types.Mixed, default: {} },
    match: { type: mongoose.Schema.Types.Mixed, default: {} },
    stream: { type: mongoose.Schema.Types.Mixed, default: {} },
    recording: { type: mongoose.Schema.Types.Mixed, default: {} },
    overlay: { type: mongoose.Schema.Types.Mixed, default: {} },
    presence: { type: mongoose.Schema.Types.Mixed, default: {} },
    network: { type: mongoose.Schema.Types.Mixed, default: {} },
    battery: { type: mongoose.Schema.Types.Mixed, default: {} },
    thermal: { type: mongoose.Schema.Types.Mixed, default: {} },
    recovery: { type: mongoose.Schema.Types.Mixed, default: {} },
    warnings: { type: [String], default: [] },
    diagnostics: { type: [String], default: [] },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },

    expireAt: { type: Date, required: true, index: { expires: 0 } },
  },
  {
    minimize: false,
    timestamps: true,
  }
);

liveDeviceStateSchema.index({ source: 1, deviceId: 1 }, { unique: true });
liveDeviceStateSchema.index({ source: 1, lastSeenAt: -1 });

export default mongoose.models.LiveDeviceState ||
  mongoose.model("LiveDeviceState", liveDeviceStateSchema);
