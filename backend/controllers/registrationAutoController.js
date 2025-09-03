// controllers/registrationAutoController.js
import asyncHandler from "express-async-handler";
import mongoose from "mongoose";
import Tournament from "../models/tournamentModel.js";
import User from "../models/userModel.js";
import Registration from "../models/registrationModel.js";

/* -------------------- Utils -------------------- */
function rng(seed) {
  // xorshift-like, deterministic
  let x = (Number(seed) || Date.now()) >>> 0;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 1_000_000) / 1_000_000; // [0,1)
  };
}
function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor((rnd ? rnd() : Math.random()) * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickPaid(mode, ratio, rnd) {
  if (mode === "allPaid") return true;
  if (mode === "allUnpaid") return false;
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  return (rnd ? rnd() : Math.random()) < r;
}
function playerDoc(u, score) {
  return {
    user: u._id,
    phone: u.phone || "",
    fullName: u.name || u.nickname || u.email,
    nickName: u.nickname || "",
    avatar: u.avatar || "",
    score: Number(score || 0),
  };
}
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ============================================================
 *  POST /api/admin/tournaments/:tourId/auto-registrations
 * ============================================================ */
export const autoGenerateRegistrations = asyncHandler(async (req, res) => {
  const { tourId } = req.params;
  const body = req.body || {};

  // ---------- Input ----------
  const isNum = (v, def = 0) => (Number.isFinite(Number(v)) ? Number(v) : def);
  const isBool = (v, def = false) => (typeof v === "boolean" ? v : def);

  const count = Math.max(1, isNum(body.count, 16)); // singles: VĐV, doubles: cặp
  const requireVerified = isBool(body.requireVerified, false);
  const province = (body.province || "").trim();
  const ratingMin = isNum(body.ratingMin, 0);
  const ratingMax = isNum(body.ratingMax, 10);
  const paymentMode = body.paymentMode || "allUnpaid"; // allPaid|allUnpaid|ratio
  const paidRatio = Math.max(0, Math.min(1, Number(body.paidRatio ?? 0)));
  const dedupeByUser = isBool(body.dedupeByUser, true);
  const dedupeByPhone = isBool(body.dedupeByPhone, true);
  const pairMethod = body.pairMethod || "balance"; // random|balance|adjacent
  const enforceCaps = isBool(body.enforceCaps, true);
  const randomSeed = isNum(body.randomSeed, Date.now());
  const dryRun = isBool(body.dryRun, false);
  const diagnose = isBool(body.diagnose, true); // luôn trả diag hữu ích

  // ---------- Tournament ----------
  const tour = await Tournament.findById(tourId).lean();
  if (!tour) {
    res.status(404);
    throw new Error("Tournament not found");
  }
  const isSingles = tour.eventType === "single";
  const capSingle = Number(tour.singleCap || 0);
  const capTotal = Number(tour.scoreCap || 0);
  const capGap = Number(tour.scoreGap || 0);

  // ---------- Capacity (maxPairs) ----------
  const existCount = await Registration.countDocuments({
    tournament: tour._id,
  });
  const capacityLeft =
    tour.maxPairs > 0 ? Math.max(0, tour.maxPairs - existCount) : Infinity;
  const needRequested = count;
  const need = Math.min(
    needRequested,
    Number.isFinite(capacityLeft) ? capacityLeft : needRequested
  );
  if (need <= 0) {
    return res.json({
      ok: true,
      created: 0,
      pairsPlanned: 0,
      singlesPlanned: 0,
      preview: [],
      reason: "FULL",
      diag: diagnose
        ? { existCount, maxPairs: tour.maxPairs, capacityLeft }
        : undefined,
    });
  }

  // ---------- Dedupe (users/phones đã đăng ký) ----------
  const regs = await Registration.find({ tournament: tour._id })
    .select("player1.user player1.phone player2.user player2.phone")
    .lean();

  const usedUsers = new Set();
  const usedPhones = new Set();
  for (const r of regs) {
    if (r?.player1?.user) usedUsers.add(String(r.player1.user));
    if (r?.player1?.phone) usedPhones.add(String(r.player1.phone));
    if (r?.player2?.user) usedUsers.add(String(r.player2.user));
    if (r?.player2?.phone) usedPhones.add(String(r.player2.phone));
  }

  // ---------- Seeded RNG ----------
  const rnd = rng(randomSeed);

  // ---------- Query candidate users (aggregate để fallback rating) ----------
  const ratingPath = isSingles
    ? "$localRatings.singles"
    : "$localRatings.doubles";
  const baseMatch = { role: "user" };
  if (requireVerified) baseMatch.verified = "verified";
  if (province)
    baseMatch.province = { $regex: new RegExp(escapeRegExp(province), "i") };

  const pipeline = [
    { $match: baseMatch },
    {
      $project: {
        name: 1,
        nickname: 1, // ✅ lấy biệt danh từ DB
        email: 1,
        phone: 1,
        avatar: 1,
        localRatings: 1,
        ratingR: { $ifNull: [ratingPath, 3.5] }, // ✅ thiếu rating => 3.5
      },
    },
    {
      $match: {
        $expr: {
          $and: [
            { $gte: ["$ratingR", ratingMin] },
            { $lte: ["$ratingR", ratingMax] },
          ],
        },
      },
    },
  ];

  const agg = await User.aggregate(pipeline).exec();
  const candidatesTotal = agg.length;

  // ---------- Dedupe pool ----------
  let candidates = agg.filter((u) => {
    if (dedupeByUser && usedUsers.has(String(u._id))) return false;
    if (dedupeByPhone && u.phone && usedPhones.has(String(u.phone)))
      return false;
    if (enforceCaps && capSingle > 0 && Number(u.ratingR) > capSingle)
      return false;
    return true;
  });
  const afterDedupe = candidates.length;

  // ---------- Không còn ai ----------
  if (afterDedupe === 0) {
    return res.json({
      ok: true,
      created: 0,
      pairsPlanned: 0,
      singlesPlanned: 0,
      preview: [],
      diag: diagnose
        ? {
            candidatesTotal,
            afterDedupe,
            notes: "Pool rỗng sau khi dedupe/capSingle",
          }
        : undefined,
    });
  }

  /* ============================================================
   *  SINGLES
   * ============================================================ */
  if (isSingles) {
    candidates = shuffle(candidates, rnd);
    const selected = candidates.slice(0, need);

    const preview = selected.map((u) => ({
      userId: u._id,
      phone: u.phone || "",
      name: u.name || u.nickname || u.email, // tên hiển thị (giữ logic cũ)
      nickname: u.nickname || null, // ✅ trả kèm biệt danh
      score: Number(u.ratingR),
    }));

    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        created: 0,
        singlesPlanned: preview.length,
        preview,
        diag: diagnose
          ? {
              candidatesTotal,
              afterDedupe,
              picked: preview.length,
              capacityLeft,
            }
          : undefined,
      });
    }

    // bulk insert — dùng selected (giữ đủ field nickname)
    const ops = [];
    for (const u of selected) {
      const paid = pickPaid(paymentMode, paidRatio, rnd);
      const score = Number(u.ratingR);
      ops.push({
        insertOne: {
          document: {
            tournament: new mongoose.Types.ObjectId(tour._id),
            player1: playerDoc(
              {
                _id: u._id,
                name: u.name, // tên thật (có thể rỗng)
                nickname: u.nickname, // ✅ BIỆT DANH
                phone: u.phone,
                email: u.email,
                avatar: u.avatar,
              },
              score
            ),
            player2: null,
            payment: {
              status: paid ? "Paid" : "Unpaid",
              paidAt: paid ? new Date() : undefined,
            },
            createdBy: req.user?._id || undefined,
          },
        },
      });
    }

    const bulk = ops.length ? await Registration.bulkWrite(ops) : null;
    const created = bulk?.insertedCount || 0;

    return res.json({
      ok: true,
      created,
      singlesPlanned: preview.length,
      diag: diagnose
        ? { candidatesTotal, afterDedupe, capacityLeft, created }
        : undefined,
    });
  }

  /* ============================================================
   *  DOUBLES
   * ============================================================ */
  // Chuẩn bị pool { user, score }
  let pool = candidates.map((u) => ({ user: u, score: Number(u.ratingR) }));

  // Sắp xếp theo phương pháp
  if (pairMethod === "random") {
    pool = shuffle(pool, rnd);
  } else {
    // balance/adjacent cùng sort asc
    pool.sort((a, b) => a.score - b.score);
  }

  const applies = {
    singleCap: enforceCaps && capSingle > 0,
    scoreCap: enforceCaps && capTotal > 0,
    scoreGap: enforceCaps && capGap > 0,
  };

  let rejectedByCaps = 0;
  const passCaps = (a, b) => {
    const s1 = a.score,
      s2 = b.score;
    if (applies.singleCap && (s1 > capSingle || s2 > capSingle)) return false;
    if (applies.scoreCap && s1 + s2 > capTotal) return false;
    if (applies.scoreGap && Math.abs(s1 - s2) > capGap) return false;
    return true;
  };

  // Pairing
  const used = new Set();
  const resultPairs = [];

  const tryPush = (A, B) => {
    if (used.has(String(A.user._id)) || used.has(String(B.user._id)))
      return false;
    if (!passCaps(A, B)) {
      rejectedByCaps++;
      return false;
    }
    used.add(String(A.user._id));
    used.add(String(B.user._id));
    resultPairs.push([A, B]);
    return true;
  };

  if (pairMethod === "balance") {
    let i = 0,
      j = pool.length - 1;
    while (i < j && resultPairs.length < need) {
      const A = pool[j],
        B = pool[i];
      if (!tryPush(A, B)) {
        if (A.score + B.score > capTotal && j - 1 > i) j--;
        else i++;
        continue;
      }
      i++;
      j--;
    }
  } else if (pairMethod === "adjacent") {
    for (let i = 0; i + 1 < pool.length && resultPairs.length < need; i += 2) {
      const A = pool[i],
        B = pool[i + 1];
      if (tryPush(A, B)) continue;
      if (i + 2 < pool.length) {
        const C = pool[i + 2];
        if (tryPush(A, C)) continue;
      }
    }
  } else {
    for (let i = 0; i + 1 < pool.length && resultPairs.length < need; i += 2) {
      const A = pool[i],
        B = pool[i + 1];
      if (tryPush(A, B)) continue;
      let paired = false;
      for (let j = i + 2; j < pool.length; j++) {
        const C = pool[j];
        if (tryPush(A, C)) {
          paired = true;
          break;
        }
      }
      if (!paired) continue;
    }
  }

  const pairsPlanned = Math.min(need, resultPairs.length);
  const preview = resultPairs.slice(0, pairsPlanned).map(([A, B]) => ({
    a: {
      id: A.user._id,
      name: A.user.name || A.user.nickname || A.user.email,
      nickname: A.user.nickname || null, // ✅ preview có biệt danh
      score: A.score,
    },
    b: {
      id: B.user._id,
      name: B.user.name || B.user.nickname || B.user.email,
      nickname: B.user.nickname || null, // ✅ preview có biệt danh
      score: B.score,
    },
    sum: A.score + B.score,
    gap: Math.abs(A.score - B.score),
  }));

  if (pairsPlanned === 0) {
    return res.json({
      ok: true,
      created: 0,
      pairsPlanned: 0,
      preview: [],
      diag: diagnose
        ? {
            candidatesTotal,
            afterDedupe,
            rejectedByCaps,
            notes: "Không tạo được cặp hợp lệ",
          }
        : undefined,
    });
  }

  if (dryRun) {
    return res.json({
      ok: true,
      dryRun: true,
      created: 0,
      pairsPlanned,
      preview,
      diag: diagnose
        ? {
            candidatesTotal,
            afterDedupe,
            rejectedByCaps,
            capacityLeft,
            pairsPlanned,
          }
        : undefined,
    });
  }

  // ---------- Bulk insert ----------
  const ops = [];
  for (const [A, B] of resultPairs.slice(0, pairsPlanned)) {
    const paid = pickPaid(paymentMode, paidRatio, rnd);
    ops.push({
      insertOne: {
        document: {
          tournament: new mongoose.Types.ObjectId(tour._id),
          // ✅ Truyền kèm nickname vào playerDoc
          player1: playerDoc(
            {
              _id: A.user._id,
              name: A.user.name,
              nickname: A.user.nickname, // ✅
              phone: A.user.phone,
              email: A.user.email,
              avatar: A.user.avatar,
            },
            A.score
          ),
          player2: playerDoc(
            {
              _id: B.user._id,
              name: B.user.name,
              nickname: B.user.nickname, // ✅
              phone: B.user.phone,
              email: B.user.email,
              avatar: B.user.avatar,
            },
            B.score
          ),
          payment: {
            status: paid ? "Paid" : "Unpaid",
            paidAt: paid ? new Date() : undefined,
          },
          createdBy: req.user?._id || undefined,
        },
      },
    });
  }
  const bulk = ops.length ? await Registration.bulkWrite(ops) : null;
  const created = bulk?.insertedCount || 0;

  return res.json({
    ok: true,
    created,
    pairsPlanned,
    diag: diagnose
      ? { candidatesTotal, afterDedupe, rejectedByCaps, capacityLeft, created }
      : undefined,
  });
});
