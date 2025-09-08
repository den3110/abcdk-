// src/controllers/subscriptionsController.js
import Subscription from "../models/subscriptionsModel.js";
import { asId } from "../utils/ids.js";

/** POST /api/subscriptions  { topicType, topicId? } */
export async function subscribe(req, res) {
  try {
    const userId = req.user?._id;
    const { topicType, topicId = null } = req.body || {};
    if (!userId || !topicType)
      return res.status(400).json({ message: "Bad request" });

    await Subscription.updateOne(
      { user: userId, topicType, topicId: topicId ? asId(topicId) : null },
      { $set: { muted: false } },
      { upsert: true }
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** DELETE /api/subscriptions  { topicType, topicId? } */
export async function unsubscribe(req, res) {
  try {
    const userId = req.user?._id;
    const { topicType, topicId = null } = req.body || {};
    if (!userId || !topicType)
      return res.status(400).json({ message: "Bad request" });

    await Subscription.deleteOne({
      user: userId,
      topicType,
      topicId: topicId ? asId(topicId) : null,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}

/** GET /api/me/subscriptions */
export async function listMySubscriptions(req, res) {
  try {
    const userId = req.user?._id;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });
    const items = await Subscription.find({
      user: userId,
      muted: { $ne: true },
    })
      .select("topicType topicId createdAt")
      .lean();
    res.json({ items });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
}
