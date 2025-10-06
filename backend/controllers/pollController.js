// controllers/pollController.js
import ClubPoll from "../models/clubPollModel.js";
import ClubPollVote from "../models/clubPollVoteModel.js";
import { canReadClubContent } from "../utils/clubVisibility.js";

export const listPolls = async (req, res) => {
  try {
    const { page = 1, limit = 20, withResults = "true" } = req.query;

    const meId = req.user?._id ? String(req.user._id) : null;

    // Tính isMember robust: owner | membership middleware | fallback exists()
    let isMember = false;
    if (meId) {
      if (String(req.club.owner) === meId) {
        isMember = true;
      } else if (req.clubMembership?.status === "active") {
        isMember = true;
      } else {
        const exists = await ClubMember.exists({
          club: req.club._id,
          user: meId,
          status: "active",
        });
        if (exists) isMember = true;
      }
    }

    // Quyền đọc nội dung theo chế độ club
    if (!canReadClubContent(req.club, meId, isMember)) {
      return res.status(403).json({ message: "Không có quyền xem bình chọn." });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    // Non-member chỉ thấy poll public
    const filter = { club: req.club._id };
    if (!isMember) filter.visibility = "public";

    const [items, total] = await Promise.all([
      ClubPoll.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ClubPoll.countDocuments(filter),
    ]);

    const wantResults = String(withResults).toLowerCase() === "true";

    if (wantResults && items.length) {
      const pollIds = items.map((p) => p._id);
      const votes = await ClubPollVote.aggregate([
        { $match: { poll: { $in: pollIds } } },
        { $unwind: "$optionIds" },
        {
          $group: {
            _id: { poll: "$poll", opt: "$optionIds" },
            count: { $sum: 1 },
          },
        },
      ]);

      const resultMap = {};
      for (const v of votes) {
        const pid = String(v._id.poll);
        (resultMap[pid] ||= {})[v._id.opt] = v.count;
      }
      for (const p of items) {
        p.results = resultMap[String(p._id)] || {};
      }
    }

    return res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    console.error("listPolls error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

export const createPoll = async (req, res) => {
  try {
    let {
      title,
      question,
      options,
      multiple = false,
      closesAt,
      visibility = "members",
    } = req.body || {};

    // Chấp nhận title/question
    const q = String(title || question || "").trim();
    if (!q) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập tiêu đề/câu hỏi." });
    }

    // Chuẩn hoá options: chấp nhận array<string> | array<{text}> | string "A,B,C"
    let raw = [];
    if (Array.isArray(options)) raw = options;
    else if (typeof options === "string") raw = options.split(/\r?\n|,/);

    let norm = raw
      .map((o) => (typeof o === "string" ? o : o?.text ?? ""))
      .map((s) => String(s).trim())
      .filter(Boolean);

    // Khử trùng lặp (case-insensitive)
    const seen = new Set();
    norm = norm.filter((t) => {
      const k = t.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    if (norm.length < 2) {
      return res.status(400).json({ message: "Cần ít nhất 2 lựa chọn." });
    }

    // Giới hạn 10, gán id ổn định
    const normOpts = norm.slice(0, 10).map((text, idx) => ({
      id: `opt_${idx + 1}`,
      text,
    }));

    // Validate visibility
    const ALLOWED_VIS = ["public", "members", "admins"];
    const vis = ALLOWED_VIS.includes(visibility) ? visibility : "members";

    // Validate closesAt (tuỳ chọn)
    let closes = undefined;
    if (closesAt) {
      const d = new Date(closesAt);
      if (Number.isNaN(d.getTime())) {
        return res
          .status(400)
          .json({ message: "Thời gian đóng không hợp lệ." });
      }
      closes = d;
    }

    const doc = await ClubPoll.create({
      club: req.club._id,
      createdBy: req.user._id,
      question: q,
      options: normOpts,
      multiple: !!multiple,
      closesAt: closes,
      visibility: vis,
    });

    return res.status(201).json(doc);
  } catch (err) {
    console.error("createPoll error:", err);
    return res.status(500).json({ message: err.message || "Server error" });
  }
};

export const votePoll = async (req, res) => {
  const { pollId } = req.params;

  // ---- normalize optionIds từ body
  const body = req.body || {};
  let optionIds = body.optionIds;

  if (!Array.isArray(optionIds)) {
    if (typeof body.optionId === "string" && body.optionId.trim()) {
      optionIds = [body.optionId.trim()];
    } else if (typeof body.optionIds === "string") {
      optionIds = body.optionIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      optionIds = [];
    }
  }

  const poll = await ClubPoll.findOne({ _id: pollId, club: req.club._id });
  if (!poll) return res.status(404).json({ message: "Poll không tồn tại" });

  if (poll.closesAt && poll.closesAt < new Date()) {
    return res.status(409).json({ message: "Poll đã đóng." });
  }

  const isMember =
    !!req.clubMembership || String(req.club.owner) === String(req.user?._id);
  if (poll.visibility === "members" && !isMember) {
    return res.status(403).json({ message: "Chỉ thành viên được bình chọn." });
  }

  // validate optionIds (hỗ trợ cả {id} và {_id})
  const validIds = new Set(
    (poll.options || []).map((o) => o.id || String(o._id))
  );
  const picked = [...new Set(optionIds.filter((id) => validIds.has(id)))];

  if (!picked.length)
    return res.status(400).json({ message: "Lựa chọn không hợp lệ." });

  if (!poll.multiple && picked.length > 1) picked.splice(1);

  await ClubPollVote.findOneAndUpdate(
    { poll: poll._id, user: req.user._id },
    { $set: { optionIds: picked } },
    { upsert: true, new: true }
  );

  res.json({ ok: true, optionIds: picked });
};

export const deletePoll = async (req, res) => {
  const del = await ClubPoll.deleteOne({
    _id: req.params.pollId,
    club: req.club._id,
  });
  if (!del.deletedCount)
    return res.status(404).json({ message: "Không tìm thấy poll" });
  await ClubPollVote.deleteMany({ poll: req.params.pollId });
  res.json({ ok: true });
};
