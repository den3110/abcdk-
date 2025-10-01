// controllers/adminStatsController.js
import asyncHandler from "express-async-handler";
import User from "../../models/userModel.js"; // đảm bảo path đúng
import {
  listOnlineUserIds,
  getUserPresence,
  getSummary,
} from "../../services/presenceService.js";

const pickUser = (u) => ({
  _id: String(u._id),
  name: u.name || u.fullName || "",
  fullName: u.fullName || u.name || "",
  nickname: u.nickname || u.nickName || "",
  email: u.email || "",
  phone: u.phone || "",
  avatar: u.avatar || u.image || "",
  role: u.role || "",
});

export const getPresenceSummary = asyncHandler(async (req, res) => {
  try {
    // (nếu bạn có middleware protect + admin thì đã chặn trước)
    const data = await getSummary();
    res.json(data);
  } catch (e) {
    console.error("[adminStats] getPresenceSummary error:", e);
    res.status(500).json({
      total: 0,
      byClient: { web: 0, app: 0, admin: 0, referee: 0 },
      ts: Date.now(),
      error: "presence_summary_failed",
    });
  }
});


export const listPresenceUsers = asyncHandler(async (req, res) => {
  try {
    const ids = await listOnlineUserIds();
    if (!ids.length) return res.json({ items: [], total: 0, ts: Date.now() });

    const users = await User.find({ _id: { $in: ids } })
      .select("name fullName nickname nickName email phone avatar image role")
      .lean();

    // presence per user
    const presenceList = await Promise.all(
      users.map((u) => getUserPresence(u._id))
    );
    const mapPresence = new Map(presenceList.map((p) => [String(p.userId), p]));

    const items = users
      .map((u) => {
        const p = mapPresence.get(String(u._id)) || {};
        return {
          ...pickUser(u),
          online: !!p.online,
          byClient: p.byClient || {},
          lastSeen: p.lastSeen || null,
        };
      })
      .sort((a, b) =>
        (a.nickname || a.name).localeCompare(b.nickname || b.name)
      );

    res.json({ items, total: items.length, ts: Date.now() });
  } catch (e) {
    console.error("[adminStats] listPresenceUsers error:", e);
    res.json({ items: [], total: 0, ts: Date.now() });
  }
});

export const searchPresenceUsers = asyncHandler(async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (q.length < 2) return res.json({ items: [], total: 0, ts: Date.now() });

    const esc = (s) => s.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&");
    const rx = new RegExp(esc(q), "i");

    const users = await User.find({
      $or: [
        { name: rx },
        { fullName: rx },
        { nickname: rx },
        { nickName: rx },
        { email: rx },
        { phone: rx },
      ],
    })
      .limit(20)
      .select("name fullName nickname nickName email phone avatar image role")
      .lean();

    const presenceList = await Promise.all(
      users.map((u) => getUserPresence(u._id))
    );
    const mapPresence = new Map(presenceList.map((p) => [String(p.userId), p]));

    const items = users.map((u) => {
      const p = mapPresence.get(String(u._id)) || {};
      return {
        ...pickUser(u),
        online: !!p.online,
        byClient: p.byClient || {},
        lastSeen: p.lastSeen || null,
      };
    });

    res.json({ items, total: items.length, ts: Date.now() });
  } catch (e) {
    console.error("[adminStats] searchPresenceUsers error:", e);
    res.json({ items: [], total: 0, ts: Date.now() });
  }
});

export const getPresenceOfUser = asyncHandler(async (req, res) => {
  try {
    const id = String(req.params.id);
    const [u, p] = await Promise.all([
      User.findById(id)
        .select("name fullName nickname nickName email phone avatar image role")
        .lean(),
      getUserPresence(id),
    ]);
    if (!u) return res.status(404).json({ error: "not_found" });
    res.json({
      ...pickUser(u),
      ...p,
      _id: String(id),
    });
  } catch (e) {
    console.error("[adminStats] getPresenceOfUser error:", e);
    res.status(500).json({ error: "internal" });
  }
});
