import mongoose from "mongoose";

/**
 * OTA Bundle Schema
 * Tracks all uploaded bundles and their metadata
 */
const otaBundleSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      index: true,
    },
    version: {
      type: String,
      required: true,
      index: true,
    },
    hash: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    r2Key: {
      type: String,
      required: true,
    },
    mandatory: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      default: "",
    },
    minAppVersion: {
      type: String,
      default: "1.0.0",
    },
    isLatest: {
      type: Boolean,
      default: false,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    stats: {
      downloads: { type: Number, default: 0 },
      successfulUpdates: { type: Number, default: 0 },
      failedUpdates: { type: Number, default: 0 },
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for quick lookups
otaBundleSchema.index({ platform: 1, version: 1 }, { unique: true });
otaBundleSchema.index({ platform: 1, isLatest: 1 });
otaBundleSchema.index({ platform: 1, isActive: 1, createdAt: -1 });

/**
 * OTA Update Log Schema
 * Tracks individual update attempts for analytics and debugging
 */
const otaUpdateLogSchema = new mongoose.Schema(
  {
    bundleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OTABundle",
      index: true,
    },
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      index: true,
    },
    fromVersion: {
      type: String,
      required: true,
    },
    toVersion: {
      type: String,
      required: true,
    },
    appVersion: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "checking",
        "downloading",
        "installing",
        "success",
        "failed",
        "skipped",
      ],
      default: "checking",
      index: true,
    },
    errorMessage: {
      type: String,
    },
    errorCode: {
      type: String,
    },
    deviceInfo: {
      deviceId: String,
      model: String,
      osVersion: String,
      brand: String,
    },
    duration: {
      type: Number, // milliseconds
    },
    ip: {
      type: String,
    },
    userAgent: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// TTL index - auto delete logs after 90 days
otaUpdateLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);
otaUpdateLogSchema.index({ platform: 1, status: 1, createdAt: -1 });

/**
 * OTA Rollback History Schema
 * Tracks rollback events for audit trail
 */
const otaRollbackSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: ["ios", "android"],
      required: true,
      index: true,
    },
    fromVersion: {
      type: String,
      required: true,
    },
    toVersion: {
      type: String,
      required: true,
    },
    reason: {
      type: String,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

// Static methods for OTABundle
otaBundleSchema.statics = {
  /**
   * Get latest active bundle for platform
   */
  async getLatest(platform) {
    return this.findOne({
      platform,
      isLatest: true,
      isActive: true,
    });
  },

  /**
   * Set version as latest (and unset previous latest)
   */
  async setAsLatest(platform, version) {
    // Unset current latest
    await this.updateMany(
      { platform, isLatest: true },
      { $set: { isLatest: false } }
    );

    // Set new latest
    return this.findOneAndUpdate(
      { platform, version },
      { $set: { isLatest: true } },
      { new: true }
    );
  },

  /**
   * Get version history for platform
   */
  async getVersionHistory(platform, limit = 20) {
    return this.find({ platform, isActive: true })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },

  /**
   * Increment download count
   */
  async incrementDownload(platform, version) {
    return this.findOneAndUpdate(
      { platform, version },
      { $inc: { "stats.downloads": 1 } },
      { new: true }
    );
  },

  /**
   * Update success/fail stats
   */
  async updateStats(platform, version, success = true) {
    const field = success ? "stats.successfulUpdates" : "stats.failedUpdates";
    return this.findOneAndUpdate(
      { platform, version },
      { $inc: { [field]: 1 } },
      { new: true }
    );
  },
};

// Static methods for OTAUpdateLog
otaUpdateLogSchema.statics = {
  /**
   * Log update check
   */
  async logCheck({
    platform,
    fromVersion,
    toVersion,
    appVersion,
    deviceInfo,
    ip,
    userAgent,
  }) {
    return this.create({
      platform,
      fromVersion,
      toVersion,
      appVersion,
      status: "checking",
      deviceInfo,
      ip,
      userAgent,
    });
  },

  /**
   * Update log status
   */
  async updateStatus(logId, status, extra = {}) {
    return this.findByIdAndUpdate(
      logId,
      { $set: { status, ...extra } },
      { new: true }
    );
  },

  /**
   * Get update stats for dashboard
   */
  async getStats(platform, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return this.aggregate([
      {
        $match: {
          platform,
          createdAt: { $gte: startDate },
        },
      },
      {
        $group: {
          _id: {
            status: "$status",
            date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { "_id.date": 1 },
      },
    ]);
  },

  /**
   * Get failed updates for debugging
   */
  async getFailedUpdates(platform, limit = 50) {
    return this.find({
      platform,
      status: "failed",
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  },
};

export const OTABundle = mongoose.model("OTABundle", otaBundleSchema);
export const OTAUpdateLog = mongoose.model("OTAUpdateLog", otaUpdateLogSchema);
export const OTARollback = mongoose.model("OTARollback", otaRollbackSchema);

export default { OTABundle, OTAUpdateLog, OTARollback };
