// controllers/admin/rosterImportController.js
// Import danh sách VĐV (giải nội bộ / công đoàn) chưa có tài khoản trên app.
// - Với VĐV có SĐT: dedup theo SĐT (dùng lại tài khoản đã có, kể cả guest cũ).
// - Với VĐV không SĐT: tạo tài khoản "khách" (provisionedByImport) để chạy giải.
// - Tự bật noRankDelta cho giải (không cộng điểm vào BXH) khi markInternal.
import asyncHandler from "express-async-handler";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import Registration from "../../models/registrationModel.js";
import Tournament from "../../models/tournamentModel.js";
import User from "../../models/userModel.js";

/* ----------------------------- helpers ----------------------------- */
function isSinglesEvent(eventType) {
  const s = String(eventType || "").trim().toLowerCase();
  return s === "single" || s === "singles";
}

function normName(v) {
  return String(v || "").replace(/\s+/g, " ").trim();
}

// Chuẩn hoá SĐT VN: bỏ ký tự thừa, +84/84 -> 0. Trả "" nếu không hợp lệ.
function normPhone(v) {
  let s = String(v || "").replace(/[\s.\-()]/g, "").trim();
  if (!s) return "";
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("84")) s = "0" + s.slice(2);
  if (!/^\d{8,12}$/.test(s)) return "";
  if (!s.startsWith("0")) s = "0" + s;
  return s;
}

function parseScore(v) {
  const n = Number(String(v ?? "").toString().replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 1000) / 1000;
}

function genNickname(i) {
  const rnd = crypto.randomBytes(3).toString("hex");
  return `kh-${Date.now().toString(36)}-${i}-${rnd}`;
}

function synthPhoneFor(userId) {
  return `KH-${String(userId).slice(-6)}`;
}

/**
 * Chuẩn hoá payload pairs -> rows đã validate.
 * pair = { p1: {name, phone, score}, p2: {name, phone, score} }
 */
function normalizeRows(pairs, singles) {
  return pairs.map((p, idx) => {
    const row = { index: idx + 1, error: "" };
    const p1 = {
      name: normName(p?.p1?.name),
      phone: normPhone(p?.p1?.phone),
      score: parseScore(p?.p1?.score),
      rawPhone: String(p?.p1?.phone || "").trim(),
    };
    const p2 = {
      name: normName(p?.p2?.name),
      phone: normPhone(p?.p2?.phone),
      score: parseScore(p?.p2?.score),
      rawPhone: String(p?.p2?.phone || "").trim(),
    };
    row.p1 = p1;
    row.p2 = p2;

    if (!p1.name) row.error = "Thiếu tên VĐV 1";
    else if (!singles && !p2.name) row.error = "Giải đôi cần tên VĐV 2";
    else if (p1.rawPhone && !p1.phone) row.error = "SĐT VĐV 1 không hợp lệ";
    else if (!singles && p2.rawPhone && !p2.phone)
      row.error = "SĐT VĐV 2 không hợp lệ";
    return row;
  });
}

/* --------------------------- controller --------------------------- */
// POST /api/admin/tournaments/:id/roster-import
export const importTournamentRoster = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { pairs = [], dryRun = false, markInternal = true } = req.body || {};

  const tournament = await Tournament.findById(id).select(
    "eventType isFreeRegistration noRankDelta registered"
  );
  if (!tournament) {
    return res.status(404).json({ message: "Không tìm thấy giải đấu" });
  }
  if (!Array.isArray(pairs) || pairs.length === 0) {
    return res.status(400).json({ message: "Danh sách trống" });
  }
  if (pairs.length > 5000) {
    return res.status(400).json({ message: "Tối đa 5000 cặp mỗi lần import" });
  }

  const singles = isSinglesEvent(tournament.eventType);
  const rows = normalizeRows(pairs, singles);
  const validRows = rows.filter((r) => !r.error);
  const errorRows = rows
    .filter((r) => r.error)
    .map((r) => ({ row: r.index, reason: r.error }));

  // Gom tất cả SĐT hợp lệ -> tra tài khoản đã tồn tại (dedup)
  const phones = new Set();
  for (const r of validRows) {
    if (r.p1.phone) phones.add(r.p1.phone);
    if (!singles && r.p2.phone) phones.add(r.p2.phone);
  }
  const existingUsers = phones.size
    ? await User.find({ phone: { $in: [...phones] } })
        .select("name nickname nickName phone avatar")
        .lean()
    : [];
  const phoneToUser = new Map(existingUsers.map((u) => [u.phone, u]));

  // Đếm sơ bộ số guest cần tạo (dedup SĐT mới trùng nhau trong file)
  const newGuestPhoneSet = new Set();
  let guestNoPhone = 0;
  let reused = 0;
  const eachPlayer = (pl) => {
    if (!pl.name) return;
    if (pl.phone) {
      if (phoneToUser.has(pl.phone)) reused += 1;
      else newGuestPhoneSet.add(pl.phone);
    } else {
      guestNoPhone += 1;
    }
  };
  for (const r of validRows) {
    eachPlayer(r.p1);
    if (!singles) eachPlayer(r.p2);
  }
  const guestsToCreate = newGuestPhoneSet.size + guestNoPhone;

  const summary = {
    pairs: pairs.length,
    validPairs: validRows.length,
    invalidPairs: errorRows.length,
    reusedAccounts: reused,
    guestsToCreate,
    registrationsToCreate: validRows.length,
    markInternal: !!markInternal,
    errors: errorRows.slice(0, 100),
  };

  if (dryRun) {
    return res.json({ ok: true, dryRun: true, summary });
  }

  /* ----------------------- tạo guest hàng loạt ----------------------- */
  // 1 hash dùng chung (guest đăng nhập bằng OTP sau, không dùng mật khẩu này)
  const pwHash = await bcrypt.hash(crypto.randomBytes(16).toString("hex"), 10);
  const now = new Date();

  const guestDocs = [];
  const phoneKeyToNick = new Map(); // SĐT mới -> nickname (để map lại _id)
  const rowSlotToNick = new Map(); // "idx:slot" -> nickname (guest không SĐT)
  let gi = 0;
  const queueGuest = (pl, key, isPhoneKey) => {
    const nick = genNickname(gi++);
    const doc = {
      name: pl.name,
      nickname: nick,
      password: pwHash,
      role: "user",
      provisionedByImport: true,
      provisionedAt: now,
      provisionedBy: req.user?._id || null,
      isHiddenFromRankings: true,
      phoneVerified: false,
    };
    if (isPhoneKey) doc.phone = pl.phone;
    guestDocs.push(doc);
    if (isPhoneKey) phoneKeyToNick.set(key, nick);
    else rowSlotToNick.set(key, nick);
    return nick;
  };

  for (const r of validRows) {
    const players = singles ? [["p1", r.p1]] : [["p1", r.p1], ["p2", r.p2]];
    for (const [slot, pl] of players) {
      if (!pl.name) continue;
      if (pl.phone) {
        if (phoneToUser.has(pl.phone)) continue; // dùng lại
        if (!phoneKeyToNick.has(pl.phone)) queueGuest(pl, pl.phone, true);
      } else {
        queueGuest(pl, `${r.index}:${slot}`, false);
      }
    }
  }

  let insertedGuests = [];
  if (guestDocs.length) {
    insertedGuests = await User.insertMany(guestDocs, { ordered: false });
  }
  const nickToUser = new Map(
    insertedGuests.map((u) => [u.nickname, u])
  );

  // Resolver: player -> { user, snapshot } hoặc null nếu tạo guest thất bại
  const resolvePlayer = (pl, rowIndex, slot) => {
    if (!pl.name) return null;
    let user = null;
    if (pl.phone && phoneToUser.has(pl.phone)) {
      user = phoneToUser.get(pl.phone);
    } else if (pl.phone) {
      const nick = phoneKeyToNick.get(pl.phone);
      user = nick ? nickToUser.get(nick) : null;
    } else {
      const nick = rowSlotToNick.get(`${rowIndex}:${slot}`);
      user = nick ? nickToUser.get(nick) : null;
    }
    if (!user || !user._id) return null;
    const uid = user._id;
    const snapshot = {
      user: uid,
      phone: pl.phone || user.phone || synthPhoneFor(uid),
      fullName: pl.name || user.name || user.nickname || "",
      nickName: user.nickName || user.nickname || "",
      avatar: user.avatar || "",
      score: pl.score || 0,
    };
    return { user, snapshot };
  };

  /* ----------------------- build registrations ----------------------- */
  const effPaymentStatus =
    tournament.isFreeRegistration === true ? "Paid" : "Unpaid";
  const regDocs = [];
  const skipped = [];
  for (const r of validRows) {
    const r1 = resolvePlayer(r.p1, r.index, "p1");
    if (!r1) {
      skipped.push({ row: r.index, reason: "Không tạo được tài khoản VĐV 1" });
      continue;
    }
    let r2 = null;
    if (!singles) {
      r2 = resolvePlayer(r.p2, r.index, "p2");
      if (!r2) {
        skipped.push({ row: r.index, reason: "Không tạo được tài khoản VĐV 2" });
        continue;
      }
    }
    regDocs.push({
      tournament: id,
      player1: r1.snapshot,
      player2: r2 ? r2.snapshot : null,
      message: "",
      payment: {
        status: effPaymentStatus,
        paidAt: effPaymentStatus === "Paid" ? now : null,
      },
      createdBy: req.user?._id || null,
      status: "approved",
      approvedBy: req.user?._id || null,
      approvedAt: now,
    });
  }

  let created = [];
  if (regDocs.length) {
    created = await Registration.insertMany(regDocs);
  }

  // Cập nhật giải: tăng số đăng ký + (tuỳ chọn) đánh dấu không tính BXH
  const tourUpdate = { $inc: { registered: created.length }, $set: { updatedAt: now } };
  if (markInternal) tourUpdate.$set.noRankDelta = true;
  await Tournament.findByIdAndUpdate(id, tourUpdate);

  return res.json({
    ok: true,
    dryRun: false,
    summary: {
      ...summary,
      guestsCreated: insertedGuests.length,
      registrationsCreated: created.length,
      skipped,
    },
    tournamentNoRankDelta: markInternal ? true : tournament.noRankDelta === true,
  });
});
