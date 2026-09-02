// models/eventLiveNotifyStateModel.js
// Trạng thái cho auto-push "giải đang LIVE" — 1 doc singleton (_id="state").
import mongoose from "mongoose";

const eventLiveNotifyStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "state" },
    liveIds: { type: [String], default: [] }, // videoId đang LIVE ở lần chạy trước
    lastAutoPushAt: { type: Date, default: null },
    lastPushedIds: { type: [String], default: [] },
  },
  { timestamps: true, minimize: false },
);

const EventLiveNotifyState =
  mongoose.models.EventLiveNotifyState ||
  mongoose.model("EventLiveNotifyState", eventLiveNotifyStateSchema);

export default EventLiveNotifyState;
