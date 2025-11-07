// controllers/admin/adminCourtController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Court from "../../models/courtModel.js";
import Match from "../../models/matchModel.js";
import Bracket from "../../models/bracketModel.js";
import User from "../../models/userModel.js";
import {
  buildGroupsRotationQueue,
  assignNextToCourt,
  freeCourtAndAssignNext,
  fillIdleCourtsForCluster,
} from "../../services/courtQueueService.js";
import { canManageTournament } from "../../utils/tournamentAuth.js";
const { Types } = mongoose;
/**
 * Upsert danh sách sân cho 1 giải + bracket
 * Sau khi lưu: build queue (tạm reuse 'cluster' = bracketId) + fill ngay các sân idle
 */
/** Helper: lấy số thứ tự bảng từ code/name (B1, B2, ...) */
function groupIndexFrom(any) {
  const s = (any?.code ?? any?.name ?? any ?? "").toString();
  const m = s.match(/B(\d+)/i);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Helper: fallback từ mã trận kiểu V1-B3#6 */
function parseFromCode(code) {
  const s = (code || "").toString();
  const g = s.match(/-B(\d+)/i);
  const idx = g ? parseInt(g[1], 10) : Number.MAX_SAFE_INTEGER;
  const n = s.match(/#(\d+)/);
  const num = n ? parseInt(n[1], 10) : Number.MAX_SAFE_INTEGER;
  return { gidx: idx, num };
}

/** Comparator: nhóm theo bảng rồi tới thứ tự trận trong bảng */
function groupFirstComparator(a, b) {
  // 1) group index
  const ga =
    a.groupOrder ??
    groupIndexFrom(a.group) ??
    groupIndexFrom(a.pool) ??
    parseFromCode(a.code).gidx;
  const gb =
    b.groupOrder ??
    groupIndexFrom(b.group) ??
    groupIndexFrom(b.pool) ??
    parseFromCode(b.code).gidx;

  if (ga !== gb) return ga - gb;

  // 2) order trong bảng
  const na =
    a.order ??
    a.sequence ??
    a.roundOrder ??
    parseFromCode(a.code).num ??
    999999;
  const nb =
    b.order ??
    b.sequence ??
    b.roundOrder ??
    parseFromCode(b.code).num ??
    999999;

  if (na !== nb) return na - nb;

  // 3) phụ (round rồi _id để ổn định sort)
  const ra = a.round ?? 0;
  const rb = b.round ?? 0;
  if (ra !== rb) return ra - rb;

  return String(a._id).localeCompare(String(b._id));
}

/**
 * Upsert courts theo BRACKET
 * - Params:   :tournamentId
 * - Body:     { bracket: ObjectId, names?: string[], count?: number }
 * - Không nhận cluster/courtId gì hết
 */
export const upsertCourts = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { names, count, cluster } = req.body || {};

  const toBool = (v) => {
    if (typeof v === "boolean") return v;
    const s = String(v ?? "")
      .trim()
      .toLowerCase();
    if (["1", "true", "yes", "on"].includes(s)) return true;
    if (["0", "false", "no", "off"].includes(s)) return false;
    return false;
  };
  const toInt = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : NaN;
  };

  const rawAutoAssign =
    req.body?.autoAssign ??
    req.body?.assignOnCreate ??
    req.body?.enableAutoAssign ??
    false;
  const autoAssign = toBool(rawAutoAssign);

  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Invalid tournament id" });
  }
  const tid = new mongoose.Types.ObjectId(tournamentId);
  const clusterKey = String(cluster ?? "Main").trim() || "Main";

  // Chuẩn hoá danh sách tên sân
  let desired = [];
  if (Array.isArray(names) && names.length) {
    const seen = new Set();
    for (const raw of names) {
      const s = String(raw ?? "").trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        desired.push(s);
      }
    }
  } else {
    const n = toInt(count);
    if (!Number.isFinite(n) || n <= 0) {
      return res
        .status(400)
        .json({ message: "Thiếu 'names' hoặc 'count' > 0" });
    }
    desired = Array.from({ length: n }, (_, i) => `Sân ${i + 1}`);
  }

  // Lấy toàn bộ courts của GIẢI này (theo cluster hiện tại)
  const existing = await Court.find({
    tournament: tid,
    cluster: clusterKey,
  }).lean();
  const byName = new Map(existing.map((c) => [c.name, c]));

  const bulk = [];

  // Upsert theo thứ tự desired
  desired.forEach((name, idx) => {
    const found = byName.get(name);
    if (found) {
      bulk.push({
        updateOne: {
          filter: { _id: found._id },
          update: {
            $set: {
              order: idx,
              isActive: true,
              status: found.status === "maintenance" ? "idle" : found.status,
              cluster: clusterKey,
              bracket: null, // chuẩn hoá: không gắn bracket nữa
              updatedAt: new Date(),
            },
          },
        },
      });
    } else {
      bulk.push({
        insertOne: {
          document: {
            tournament: tid,
            name,
            order: idx,
            isActive: true,
            status: "idle",
            currentMatch: null,
            cluster: clusterKey,
            bracket: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        },
      });
    }
  });

  // Deactivate các sân trong cluster này nhưng không còn trong desired
  for (const c of existing) {
    if (!desired.includes(c.name)) {
      bulk.push({
        updateOne: {
          filter: { _id: c._id },
          update: {
            $set: {
              isActive: false,
              status: "maintenance",
              currentMatch: null,
              updatedAt: new Date(),
            },
          },
        },
      });
    }
  }

  if (bulk.length) {
    await Court.bulkWrite(bulk, { ordered: false });
  }

  // Auto assign (nếu bật)
  if (autoAssign) {
    try {
      await buildGroupsRotationQueue({ tournamentId, cluster: clusterKey });
      await fillIdleCourtsForCluster({ tournamentId, cluster: clusterKey });
    } catch (e) {
      console.error("[queue] rebuild/fill error:", e?.message || e);
    }
  }

  const items = await Court.find({ tournament: tid, cluster: clusterKey })
    .sort({ order: 1 })
    .lean();

  return res.json({
    items,
    meta: {
      scope: "tournament",
      cluster: clusterKey,
      autoAssignApplied: autoAssign,
    },
  });
});

export const buildGroupsQueueHttp = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket } = req.body || {};
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }
  const clusterKey = String(bracket);
  const out = await buildGroupsRotationQueue({
    tournamentId,
    cluster: clusterKey,
  });
  res.json(out);
});

export const assignNextHttp = asyncHandler(async (req, res) => {
  const { tournamentId, courtId } = req.params;
  const { bracket } = req.body || {};
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }
  const clusterKey = String(bracket);
  const match = await assignNextToCourt({
    tournamentId,
    courtId,
    cluster: clusterKey,
  });
  res.json({ match });
});

export const freeCourtHttp = asyncHandler(async (req, res) => {
  const { courtId } = req.params;
  const match = await freeCourtAndAssignNext({ courtId });
  res.json({ match });
});

export const getSchedulerState = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket } = req.query || {};
  if (!mongoose.isValidObjectId(bracket)) {
    return res
      .status(400)
      .json({ message: "Thiếu hoặc sai 'bracket' (ObjectId)" });
  }
  const clusterKey = String(bracket);

  const [courts, matches] = await Promise.all([
    Court.find({ tournament: tournamentId, bracket, isActive: true })
      .sort({ order: 1 })
      .lean(),
    // ⚠️ Hiện tại service/match đang dùng 'courtCluster' → tạm reuse clusterKey = bracketId
    Match.find({
      tournament: tournamentId,
      courtCluster: clusterKey,
      status: { $in: ["queued", "assigned", "live"] },
    })
      .select(
        "_id status queueOrder court courtLabel participants pool rrRound round order"
      )
      .sort({ status: 1, queueOrder: 1 })
      .lean(),
  ]);

  res.json({ courts, matches });
});

/* ======================== ⭐ NEW: helpers ======================== */
function courtLabelOf(court) {
  return (
    court?.name ||
    court?.label ||
    court?.title ||
    court?.code ||
    (court?._id ? `Court-${String(court._id).slice(-4)}` : "")
  );
}

/* ======================== ⭐ NEW: gán 1 trận cụ thể vào 1 sân ========================
 * POST /api/tournaments/:tournamentId/courts/:courtId/assign-specific
 * body: { bracket, matchId, replace = true }
 */
export const assignSpecificHttp = asyncHandler(async (req, res) => {
  const { tournamentId, courtId } = req.params;
  const { bracket, matchId, replace = true } = req.body || {};

  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Sai 'tournamentId'." });
  }
  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({ message: "Sai 'courtId'." });
  }
  if (!mongoose.isValidObjectId(bracket)) {
    return res.status(400).json({ message: "Sai 'bracket'." });
  }
  if (!mongoose.isValidObjectId(matchId)) {
    return res.status(400).json({ message: "Sai 'matchId'." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1) Tìm court + match
    const [court, match] = await Promise.all([
      Court.findOne({
        _id: courtId,
        tournament: tournamentId,
        bracket,
        isActive: true,
      }).session(session),
      Match.findOne({ _id: matchId, tournament: tournamentId }).session(
        session
      ),
    ]);

    if (!court) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Không tìm thấy sân hợp lệ." });
    }
    if (!match) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Không tìm thấy trận cần gán." });
    }
    if (String(match.bracket || "") !== String(bracket)) {
      await session.abortTransaction();
      return res.status(400).json({ message: "Trận và bracket không khớp." });
    }
    if (String(match.status || "") === "finished") {
      await session.abortTransaction();
      return res
        .status(400)
        .json({ message: "Trận đã kết thúc; không thể gán." });
    }

    // 2) Nếu trận đã đang ở đúng sân -> idempotent
    if (String(match.court || "") === String(courtId)) {
      await session.commitTransaction();
      session.endSession();
      return res.json({
        message: "Trận đã được gán ở sân này.",
        court,
        match,
      });
    }

    // 3) Nếu sân đang có trận "assigned" hoặc "live"
    const currentOnCourt = await Match.findOne({
      tournament: tournamentId,
      court: courtId,
      status: { $in: ["assigned", "live"] },
    })
      .select("_id status")
      .session(session);

    if (currentOnCourt && !replace) {
      await session.abortTransaction();
      return res.status(409).json({
        message: "Sân đang có trận. Thiếu quyền thay thế (replace=false).",
      });
    }

    // 3a) Gỡ trận đang chiếm sân (nếu có)
    if (currentOnCourt) {
      await Match.updateOne(
        { _id: currentOnCourt._id },
        {
          $unset: { court: "", courtLabel: "" },
          $set: { status: "queued" }, // đưa lại hàng đợi
        },
        { session }
      );
    }

    // 3b) Nếu trận mục tiêu đang ở sân khác -> gỡ khỏi sân cũ
    if (match.court && String(match.court) !== String(courtId)) {
      await Match.updateOne(
        { _id: match._id },
        { $unset: { court: "", courtLabel: "" } },
        { session }
      );

      // Set sân cũ (nếu còn) về idle nếu không còn trận assigned/live
      const oldCourtId = match.court;
      const stillBusy = await Match.exists({
        tournament: tournamentId,
        court: oldCourtId,
        status: { $in: ["assigned", "live"] },
      }).session(session);
      if (!stillBusy) {
        await Court.updateOne(
          { _id: oldCourtId },
          { $set: { status: "idle", currentMatch: null } },
          { session }
        );
      }
    }

    // 4) Gán trận mục tiêu vào sân
    const label = courtLabelOf(court);
    await Match.updateOne(
      { _id: match._id },
      {
        $set: {
          court: courtId,
          courtLabel: label,
          status: "assigned",
          courtCluster: String(bracket), // giữ cluster theo bracket để UI/state đọc được
        },
      },
      { session }
    );

    await Court.updateOne(
      { _id: courtId },
      { $set: { status: "assigned", currentMatch: match._id } },
      { session }
    );

    const [updatedMatch, updatedCourt] = await Promise.all([
      Match.findById(match._id).session(session),
      Court.findById(courtId).session(session),
    ]);

    await session.commitTransaction();
    session.endSession();

    return res.json({
      message: "Đã gán trận vào sân thành công.",
      court: updatedCourt,
      match: updatedMatch,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
});

/* ======================== ⭐ NEW: reset toàn bộ sân & gỡ gán ========================
 * POST /api/tournaments/:tournamentId/courts/reset
 * body: { bracket }
 * - Xoá tất cả Court trong bracket
 * - Gỡ 'court' & 'courtLabel' khỏi các trận đang gán (assigned/live) của bracket
 * - Đưa trạng thái các trận đang gán về 'queued' (finished giữ nguyên)
 */
export const resetCourtsHttp = asyncHandler(async (req, res) => {
  const { tournamentId } = req.params;
  const { bracket } = req.body || {};

  if (!mongoose.isValidObjectId(tournamentId)) {
    return res.status(400).json({ message: "Sai 'tournamentId'." });
  }
  if (!mongoose.isValidObjectId(bracket)) {
    return res.status(400).json({ message: "Sai 'bracket'." });
  }

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // 1) Gỡ gán khỏi các trận thuộc cluster/bracket này
    const unassignFilter = {
      tournament: tournamentId,
      // dùng cluster = bracket như các API khác trong file
      $or: [{ bracket }, { courtCluster: String(bracket) }],
      court: { $exists: true, $ne: null },
      status: { $in: ["assigned", "live"] },
    };

    const unassignRes = await Match.updateMany(
      unassignFilter,
      {
        $unset: { court: "", courtLabel: "" },
        $set: { status: "queued" },
      },
      { session }
    );

    // 2) Xoá hết Court của bracket này
    const deleteRes = await Court.deleteMany(
      { tournament: tournamentId, bracket },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      message: "Đã reset toàn bộ sân & gỡ gán các trận.",
      matchesUnassigned: unassignRes?.modifiedCount || 0,
      courtsDeleted: deleteRes?.deletedCount || 0,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    throw err;
  }
});

export const MATCH_BASE_SELECT =
  "_id tournament bracket format type status queueOrder " +
  "court courtLabel pool rrRound round order code labelKey " +
  "scheduledAt startedAt finishedAt";

const PAIR_SELECT =
  "displayName name nickname nickName shortName code " +
  "player1.fullName player1.nickName player2.fullName player2.nickName participants";

export const displayLabelKey = (m) => {
  if (!m?.labelKey) return "";
  const isGroup = m.format === "group" || m.type === "group" || !!m.pool?.name;
  return isGroup ? m.labelKey.replace(/#R(\d+)/, "#B$1") : m.labelKey;
};

const nameOfPerson = (p) =>
  (
    p?.nickName ||
    p?.nickname ||
    p?.fullName ||
    p?.displayName ||
    p?.name ||
    ""
  ).trim();

export const nameOfPair = (pair) => {
  if (!pair) return "";
  if (pair.displayName || pair.name)
    return String(pair.displayName || pair.name).trim();
  const n1 = nameOfPerson(pair.player1);
  const n2 = nameOfPerson(pair.player2);
  return [n1, n2].filter(Boolean).join(" & ");
};

export async function fetchSchedulerMatches({
  tournamentId,
  bracket,
  clusterKey,
  includeIds = [],
  statuses = ["queued", "assigned", "live", "scheduled"],
}) {
  const baseFilter = {
    tournament: tournamentId,
    status: { $in: statuses },
    ...(bracket ? { bracket } : { courtCluster: clusterKey }),
  };

  let matches = await Match.find(baseFilter)
    .select(MATCH_BASE_SELECT)
    .populate({ path: "pairA", select: PAIR_SELECT })
    .populate({ path: "pairB", select: PAIR_SELECT })
    .sort({ status: 1, queueOrder: 1 })
    .lean();

  const missingIds = (includeIds || []).filter(
    (id) => !matches.some((m) => String(m._id) === String(id))
  );
  if (missingIds.length) {
    const extra = await Match.find({ _id: { $in: missingIds } })
      .select(MATCH_BASE_SELECT)
      .populate({ path: "pairA", select: PAIR_SELECT })
      .populate({ path: "pairB", select: PAIR_SELECT })
      .lean();
    matches = matches.concat(extra);
  }

  return matches.map((m) => ({
    _id: m._id,
    status: m.status,
    queueOrder: m.queueOrder,
    court: m.court,
    courtLabel: m.courtLabel,
    pool: m.pool,
    rrRound: m.rrRound,
    round: m.round,
    order: m.order,
    code: m.code,
    labelKey: m.labelKey,
    labelKeyDisplay: displayLabelKey(m),
    type: m.type,
    format: m.format,
    scheduledAt: m.scheduledAt,
    startedAt: m.startedAt,
    finishedAt: m.finishedAt,
    pairA: m.pairA || null,
    pairB: m.pairB || null,
    pairAName: m.pairA ? nameOfPair(m.pairA) : "",
    pairBName: m.pairB ? nameOfPair(m.pairB) : "",
  }));
}

/**
 * GET /api/admin/tournaments/:tid/courts?bracket=<bid>&q=&cluster=&limit=&page=
 * Trả về: Array<Court> (populate currentMatch: _id, code, round, order, globalRound)
 */

/** Chuẩn hóa mã trận cho FE hiển thị */
function poolIndexFromName(poolName, bracket) {
  const name = String(poolName || "")
    .trim()
    .toUpperCase();
  if (!name) return undefined;

  // map theo groups trong bracket
  if (Array.isArray(bracket?.groups) && bracket.groups.length > 0) {
    const idx = bracket.groups.findIndex((g) => {
      const gn = String(g?.name ?? g?.key ?? "")
        .trim()
        .toUpperCase();
      return gn === name;
    });
    if (idx >= 0) return idx + 1; // 1-based
  }

  // A..Z -> 1..26
  if (/^[A-Z]$/.test(name)) return name.charCodeAt(0) - 64;

  // "1", "2", ... -> số
  if (/^\d+$/.test(name)) return parseInt(name, 10);

  return undefined;
}

/** Tạo mã hiển thị cho trận theo thể thức:
 *  - Group/RR/GSL: V{v}-B{poolIndex}-T{order+1}
 *  - Swiss:        V{v}-T{order+1}
 *  - Khác (KO...): V{v}-T{order+1}
 * Trả { displayCode, code } (code = displayCode để FE dùng thống nhất)
 */
function makeCodes(match, bracket) {
  if (!match) return { displayCode: "", code: "" };

  const fmt = String(match.format || "").toLowerCase();
  const ord1 = Number.isFinite(match?.order) ? match.order + 1 : undefined;
  const firstFinite = (...xs) => xs.find((n) => Number.isFinite(n));
  const segs = [];

  if (["group", "round_robin", "gsl"].includes(fmt)) {
    const v = firstFinite(match?.rrRound, match?.round, match?.globalRound);
    const poolName = match?.pool?.name ?? match?.pool?.key ?? "";
    const pIndex = poolIndexFromName(poolName, bracket);

    if (Number.isFinite(v)) segs.push(`V${v}`);
    if (Number.isFinite(pIndex)) segs.push(`B${pIndex}`); // KHÔNG dùng A/B, mà dùng số thứ tự
    if (Number.isFinite(ord1)) segs.push(`T${ord1}`);

    const out = segs.join("-");
    return {
      displayCode: out || String(match.code || ""),
      code: out || String(match.code || ""),
    };
  }

  if (fmt === "swiss") {
    const v = firstFinite(match?.swissRound, match?.round, match?.globalRound);
    if (Number.isFinite(v)) segs.push(`V${v}`);
    if (Number.isFinite(ord1)) segs.push(`T${ord1}`);
    const out = segs.join("-");
    return {
      displayCode: out || String(match.code || ""),
      code: out || String(match.code || ""),
    };
  }

  // KO / default
  const v = firstFinite(match?.globalRound, match?.round);
  if (Number.isFinite(v)) segs.push(`V${v}`);
  if (Number.isFinite(ord1)) segs.push(`T${ord1}`);
  const out = segs.join("-");
  return {
    displayCode: out || String(match.code || ""),
    code: out || String(match.code || ""),
  };
}

// ✅ Courts theo GIẢI, bỏ phụ thuộc bracket
export async function listCourtsByTournament(req, res) {
  try {
    const { tid } = req.params;
    // Giữ tham số 'bracket' để tương thích ngược nhưng ❌ KHÔNG dùng
    const {
      /* bracket: _bid, */ q = "",
      cluster = "",
      limit,
      page,
      heal,
    } = req.query || {};

    if (!mongoose.Types.ObjectId.isValid(tid)) {
      return res.status(400).json({ message: "Invalid tournament id" });
    }

    // Quyền
    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tid);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    // ----- Truy vấn COURTS theo GIẢI (không theo bracket) -----
    const where = { tournament: tid };

    const qTrim = String(q || "").trim();
    if (qTrim) {
      where.name = { $regex: qTrim.replace(/\s+/g, ".*"), $options: "i" };
    }

    const clusterTrim = String(cluster || "").trim();
    if (clusterTrim) {
      // cluster là string; giữ nhánh ObjectId để tương thích dữ liệu cũ nếu có
      if (mongoose.Types.ObjectId.isValid(clusterTrim)) {
        where.$or = [
          { cluster: new mongoose.Types.ObjectId(clusterTrim) },
          { cluster: clusterTrim },
        ];
      } else {
        where.cluster = clusterTrim;
      }
    }

    const lim = Number.isFinite(Number(limit))
      ? Math.max(1, Number(limit))
      : 200;
    const pg = Number.isFinite(Number(page)) ? Math.max(1, Number(page)) : 1;

    let docs = await Court.find(where)
      .select("+currentMatch")
      .sort({ order: 1, createdAt: 1 })
      .skip((pg - 1) * lim)
      .limit(lim)
      .populate({
        path: "currentMatch",
        model: "Match",
        select:
          "_id code labelKey status format type pool key rrRound swissRound round order globalRound",
      })
      .lean();

    // ----- Optional self-heal -----
    if (String(heal) === "1") {
      const staleIds = docs
        .filter(
          (c) =>
            c?.isActive !== false &&
            (!c.currentMatch || !c.currentMatch?._id) &&
            ["assigned", "live"].includes(String(c?.status || ""))
        )
        .map((c) => c._id);

      if (staleIds.length) {
        await Court.updateMany(
          { _id: { $in: staleIds } },
          { $set: { status: "idle" }, $unset: { currentMatch: 1 } }
        );

        docs = docs.map((c) =>
          staleIds.some((id) => String(id) === String(c._id))
            ? { ...c, status: "idle", currentMatch: null }
            : c
        );
      }
    }

    // ----- Build code/displayCode KHÔNG phụ thuộc bracket -----
    const GROUP_LIKE = new Set(["group", "round_robin", "gsl", "swiss"]);
    const isGroupLike = (m) => {
      const t1 = String(m?.type || "").toLowerCase();
      const f1 = String(m?.format || "").toLowerCase();
      if (GROUP_LIKE.has(t1) || GROUP_LIKE.has(f1)) return true;
      // có pool thì mặc định coi là group-like
      if (m?.pool) return true;
      return false;
    };

    const letterToIndex = (s) => {
      const ch = String(s || "")
        .trim()
        .toUpperCase();
      if (/^[A-Z]$/.test(ch)) return ch.charCodeAt(0) - 64; // A=1
      return null;
    };

    const getPoolIndex = (pool) => {
      if (!pool) return null;
      const cand = String(
        pool.index ?? pool.idx ?? pool.code ?? pool.key ?? pool.name ?? ""
      ).trim();
      if (!cand) return null;

      if (/^\d+$/.test(cand)) {
        const n = parseInt(cand, 10);
        return n > 0 ? n : null;
      }
      const mB = /^B(\d+)$/i.exec(cand);
      if (mB) return parseInt(mB[1], 10);

      const byLetter = letterToIndex(cand);
      if (byLetter) return byLetter;

      return null;
    };

    const extractT = (m) => {
      const o = Number(m?.order);
      if (Number.isFinite(o) && o >= 0) return o + 1;
      // fallback: lấy số cuối trong labelKey nếu có
      const lk = String(m?.labelKey || "");
      const mm = lk.match(/(\d+)$/);
      if (mm) return Number(mm[1]);
      return 1;
    };

    const computeDisplayCode = (m) => {
      if (!m) return { code: "", displayCode: "" };

      const T = extractT(m);
      if (isGroupLike(m)) {
        const B = getPoolIndex(m?.pool);
        // Không còn offset theo bracket => group-like mặc định V=1
        const code = `V1${B ? `-B${B}` : ""}-T${T}`;
        return { code, displayCode: code };
      } else {
        // KO/Elim: dùng globalRound nếu có, fallback round, mặc định 1
        const r =
          (Number.isFinite(Number(m?.globalRound)) && Number(m.globalRound)) ||
          (Number.isFinite(Number(m?.round)) && Number(m.round)) ||
          1;
        const code = `V${r}-T${T}`;
        return { code, displayCode: code };
      }
    };

    // Gắn code/displayCode cho currentMatch
    for (const c of docs) {
      if (c.currentMatch && c.currentMatch._id) {
        const { code, displayCode } = computeDisplayCode(c.currentMatch);
        c.currentMatch.code = code;
        c.currentMatch.displayCode = displayCode;
      }
    }

    return res.json(docs);
  } catch (err) {
    console.error("[listCourtsByTournament] error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

const isObjectIdString = (s) => mongoose.Types.ObjectId.isValid(String(s));
const resolveClusterKey = (_bracket, cluster) =>
  String(cluster || "Main").trim();

export const deleteAllCourts = async (req, res) => {
  try {
    const { tournamentId, bracket, cluster, force } = req.body || {};

    const toBool = (v) =>
      v === true ||
      v === 1 ||
      v === "1" ||
      (typeof v === "string" && v.toLowerCase() === "true");

    const forceDelete = toBool(force ?? true);

    if (!mongoose.isValidObjectId(tournamentId)) {
      return res.status(400).json({ message: "Invalid tournamentId" });
    }
    // bracket KHÔNG bắt buộc nữa, nhưng nếu có truyền thì phải hợp lệ
    if (bracket && !mongoose.isValidObjectId(bracket)) {
      return res.status(400).json({ message: "Invalid bracket id" });
    }

    // Quyền
    const me = req.user;
    const isAdmin = me?.role === "admin";
    const ownerOrMgr = await canManageTournament(me?._id, tournamentId);
    if (!isAdmin && !ownerOrMgr) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // ❗️Chỉ lọc theo giải; CHỈ áp dụng filter cluster nếu client truyền vào
      const filter = { tournament: tournamentId };
      if (typeof cluster === "string" && cluster.trim()) {
        filter.cluster = cluster.trim();
      }

      // Lấy trước danh sách court + cluster để dùng emit sau khi xoá
      const courts = await Court.find(filter)
        .select("_id cluster")
        .session(session)
        .lean();

      const courtIds = courts.map((c) => c._id);
      let clearedMatches = 0;

      if (forceDelete && courtIds.length) {
        // Gỡ liên kết court khỏi match (không đổi status), KHÔNG còn lọc theo bracket
        const upd = await Match.updateMany(
          { tournament: tournamentId, court: { $in: courtIds } },
          { $set: { court: null }, $unset: { courtCluster: "" } },
          { session }
        );
        clearedMatches = Number(upd.modifiedCount || upd.nModified || 0);
      }

      // Xoá tất cả court tìm được
      const del = await Court.deleteMany(
        { _id: { $in: courtIds } },
        { session }
      );

      await session.commitTransaction();
      session.endSession();

      // Thông báo realtime cho từng cluster bị ảnh hưởng
      try {
        const io = req.app.get("io");
        if (io) {
          const touchedClusters = [
            ...new Set(courts.map((c) => String(c.cluster || "Main"))),
          ];

          for (const cl of touchedClusters) {
            io.to(`tour:${tournamentId}:${cl}`).emit("scheduler:state:dirty", {
              at: Date.now(),
              reason: "courts:deletedAll",
              cluster: cl,
            });
          }

          // Legacy channel (giữ tương thích cũ nếu FE còn join theo bracket)
          if (bracket) {
            io.to(`scheduler:${tournamentId}:${bracket}`).emit(
              "scheduler:state:dirty",
              {
                at: Date.now(),
                reason: "courts:deletedAll (legacy)",
                bracket: String(bracket),
              }
            );
          }
        }
      } catch (_) {
        // ignore realtime errors
      }

      return res.json({
        ok: true,
        deleted: Number(del.deletedCount || 0),
        clearedMatches,
        clusters: [...new Set(courts.map((c) => String(c.cluster || "Main")))],
      });
    } catch (err) {
      await session.abortTransaction().catch(() => {});
      session.endSession();
      return res
        .status(500)
        .json({ message: err?.message || "Delete courts failed" });
    }
  } catch (e) {
    return res
      .status(500)
      .json({ message: e?.message || "Unexpected server error" });
  }
};

export const deleteOneCourt = asyncHandler(async (req, res) => {
  const { tournamentId, courtId } = req.params || {};

  if (!mongoose.isValidObjectId(courtId)) {
    return res.status(400).json({ message: "Invalid courtId" });
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Lấy court để biết cluster/bracket trước khi xoá
    const court = await Court.findOne({
      _id: courtId,
    })
      .select("_id cluster bracket")
      .session(session);

    if (!court) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: "Court not found in tournament" });
    }

    // Gỡ liên kết court khỏi các trận (giữ nguyên status)
    const upd = await Match.updateMany(
      { court: court._id },
      {
        $set: { court: null },
        $unset: {
          courtCluster: "",
          courtLabel: "",
          assignedCourt: "",
          courtAssigned: "",
        },
      },
      { session }
    );
    const clearedMatches =
      Number(upd?.modifiedCount || 0) + Number(upd?.nModified || 0);

    // Xoá court
    const del = await Court.deleteOne({ _id: court._id }, { session });

    await session.commitTransaction();
    session.endSession();

    // Emit realtime cho cluster đã bị ảnh hưởng

    return res.json({
      ok: true,
      deleted: Number(del?.deletedCount || 0),
      clearedMatches,
      courtId: String(court._id),
      cluster: String(court.cluster || "Main"),
    });
  } catch (err) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    return res
      .status(500)
      .json({ message: err?.message || "Delete court failed" });
  }
});

// PUT /api/admin/tournaments/:tournamentId/courts/:courtId/referee
// body: { refereeIds: string[] }  // có thể trống để clear
// (hỗ trợ legacy refereeId: string)
export const setCourtReferee = async (req, res) => {
  try {
    const { tournamentId, courtId } = req.params;
    const { refereeIds, refereeId } = req.body || {};

    if (!tournamentId || !courtId) {
      return res
        .status(400)
        .json({ message: "Thiếu tournamentId hoặc courtId." });
    }

    // 1. Tìm sân thuộc đúng giải
    const court = await Court.findOne({
      _id: courtId,
      tournament: tournamentId,
    });

    if (!court) {
      return res
        .status(404)
        .json({ message: "Không tìm thấy sân thuộc giải này." });
    }

    // 2. Chuẩn hoá danh sách refereeIds
    let rawIds = [];

    if (Array.isArray(refereeIds)) {
      rawIds = refereeIds;
    }

    // Hỗ trợ legacy 1 id đơn
    if (refereeId) {
      rawIds = rawIds.concat(refereeId);
    }

    const normalizedIds = [
      ...new Set(
        rawIds
          .map((id) => String(id || "").trim())
          .filter((id) => id && Types.ObjectId.isValid(id))
      ),
    ];

    // 3. Không có id hợp lệ => xoá hết trọng tài mặc định
    if (!normalizedIds.length) {
      court.defaultReferees = [];
      await court.save();

      return res.json({
        message: "Đã xoá tất cả trọng tài mặc định của sân.",
        court,
      });
    }

    // 4. Validate các user này là trọng tài của giải
    // Điều kiện:
    // - isDeleted != true
    // - role = "referee"
    // - referee.tournaments có chứa tournamentId
    const validRefs = await User.find({
      _id: { $in: normalizedIds },
      isDeleted: { $ne: true },
      role: "referee",
      "referee.tournaments": tournamentId,
    }).select("_id");

    if (validRefs.length !== normalizedIds.length) {
      return res.status(400).json({
        message:
          "Có trọng tài không tồn tại, không phải referee, hoặc không thuộc giải này.",
      });
    }

    // 5. Lưu vào court.defaultReferees
    court.defaultReferees = validRefs.map((u) => u._id);
    await court.save();

    // Nếu muốn trả kèm info chi tiết cho FE:
    // await court.populate("defaultReferees", "name nickname email phone");

    return res.json({
      message: "Đã cập nhật trọng tài mặc định cho sân.",
      court,
    });
  } catch (err) {
    console.error("setCourtReferee error:", err);
    return res
      .status(500)
      .json({ message: "Lỗi server khi gán trọng tài cho sân." });
  }
};
