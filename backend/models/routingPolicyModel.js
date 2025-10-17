// models/routingPolicyModel.js
import mongoose from "mongoose";

const RoutingPolicySchema = new mongoose.Schema({
  name: String,
  providerPriority: [String], // ví dụ ["facebook","youtube","tiktok"]
  constraints: {
    maxConcurrentPerOwner: { type: Number, default: 1 },
    busyWindowMs: { type: Number, default: 6 * 3600 * 1000 },
    crossProviderExclusive: { type: Boolean, default: true },
  },
}, { timestamps: true });

export default mongoose.model("RoutingPolicy", RoutingPolicySchema);
