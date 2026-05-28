import mongoose from "mongoose";

const ruleSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    severity: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    threshold: { type: Number, default: 0 },
    windowMinutes: { type: Number, default: 0 },
    penalty: { type: Number, default: 0 },
  },
  { _id: false },
);

const identitySecuritySettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "identity-security" },
    enabled: { type: Boolean, default: true },
    analysis: {
      defaultWindowDays: { type: Number, default: 30 },
      overviewLimit: { type: Number, default: 12 },
      eventLimit: { type: Number, default: 240 },
    },
    rules: {
      newIp: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "medium",
          threshold: 3,
          penalty: 8,
        }),
      },
      newDevice: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "medium",
          threshold: 3,
          penalty: 8,
        }),
      },
      failureBurst: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "high",
          threshold: 3,
          windowMinutes: 15,
          penalty: 14,
        }),
      },
      failedThenSuccess: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "medium",
          windowMinutes: 30,
          penalty: 8,
        }),
      },
      offHour: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "low",
          threshold: 8,
          penalty: 4,
        }),
      },
      sharedAccounts: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "medium",
          threshold: 3,
          penalty: 8,
        }),
      },
      deviceChanges: {
        type: ruleSchema,
        default: () => ({
          enabled: true,
          severity: "low",
          threshold: 5,
          penalty: 6,
        }),
      },
    },
    trust: {
      baseScore: { type: Number, default: 65 },
      highTrustMin: { type: Number, default: 85 },
      normalMin: { type: Number, default: 70 },
      watchMin: { type: Number, default: 50 },
      matureAccountDays: { type: Number, default: 180 },
      newAccountDays: { type: Number, default: 7 },
      matureAccountBonus: { type: Number, default: 8 },
      newAccountPenalty: { type: Number, default: 8 },
      verifiedBonus: { type: Number, default: 5 },
      kycBonus: { type: Number, default: 6 },
      phoneVerifiedBonus: { type: Number, default: 5 },
      stableDeviceBonus: { type: Number, default: 5 },
      failedAuthPenaltyEach: { type: Number, default: 3 },
      failedAuthPenaltyMax: { type: Number, default: 18 },
    },
    actions: {
      highRisk: { type: String, default: "challenge" },
      watch: { type: String, default: "monitor" },
      normal: { type: String, default: "allow" },
      highTrust: { type: String, default: "allow" },
    },
    explainableUx: {
      normalUserMessage: {
        type: String,
        default:
          "Hoạt động đăng nhập gần đây của bạn đang phù hợp với thói quen tài khoản.",
      },
      riskyUserMessage: {
        type: String,
        default:
          "Chúng tôi nhận thấy hoạt động đăng nhập khác với thói quen thường ngày. Vui lòng xác minh trước khi tiếp tục thao tác nhạy cảm.",
      },
      normalChallengeCopy: {
        type: String,
        default: "Hiện tại chưa cần xác minh bổ sung.",
      },
      riskyChallengeCopy: {
        type: String,
        default:
          "Để bảo vệ tài khoản, vui lòng xác minh trước khi thực hiện thay đổi này.",
      },
    },
    ai: {
      enabled: { type: Boolean, default: true },
      model: { type: String, default: "" },
      fallbackEnabled: { type: Boolean, default: true },
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true, strict: true },
);

export default mongoose.model(
  "IdentitySecuritySettings",
  identitySecuritySettingsSchema,
);
