// src/utils/scheduleNotifications.js
import { agenda } from "../jobs/agenda.js";
import { DateTime } from "luxon";

const MS_MIN = 60 * 1000;
const MS_DAY = 24 * 60 * MS_MIN;

/* ───────── helpers (Luxon DateTime) ───────── */
const TZ_DEFAULT = process.env.DEFAULT_TZ || "Asia/Ho_Chi_Minh";
const FORCE_MINUTES_TODAY = 1; // D0 "pass" trong hôm nay: now + 1 phút

function isValidTZ(tz) {
  try { return !!tz && DateTime.now().setZone(tz).isValid; } catch { return false; }
}
function toLocalDT(raw, tz) {
  // chấp nhận Date | string ISO
  if (!raw) return null;
  const dt = raw instanceof Date
    ? DateTime.fromJSDate(raw, { zone: "utc" }).setZone(tz)
    : DateTime.fromJSDate(new Date(raw), { zone: "utc" }).setZone(tz);
  return dt.isValid ? dt : null;
}
function minusDays(dt, d) { return dt.minus({ days: d }); }
function minusMinutes(dt, m) { return dt.minus({ minutes: m }); }

/* ──────────────────────────────────────────────────────────────────────────
 * Lập lịch D-3/D-2/D-1/D0 cho 1 giải
 * YÊU CẦU: Nếu startDate là "hôm nay" (theo TZ) → bỏ qua giờ, luôn tạo D0 = now+1'
 * ────────────────────────────────────────────────────────────────────────── */
export async function scheduleTournamentCountdown(tournamentDoc) {
  try {
    const tournamentId = String(tournamentDoc._id);
    const tz = isValidTZ(tournamentDoc.timezone) ? tournamentDoc.timezone : TZ_DEFAULT;

    // Ưu tiên field bạn đang dùng: startDate (có thể là Date hoặc ISO string)
    const startRaw =
      tournamentDoc.startDate ??
      tournamentDoc.startAt ??
      tournamentDoc.start ??
      tournamentDoc.beginAt;

    const startLocal = toLocalDT(startRaw, tz);
    if (!startLocal) {
      console.warn("[agenda] skip countdown: no/invalid start date", { tournamentId, startRaw });
      return;
    }

    const nowLocal = DateTime.now().setZone(tz);
    const isSameDay = startLocal.hasSame(nowLocal, "day");

    // Idempotent: xóa job cũ của giải này
    await agenda.cancel({
      name: "notify.tournament.countdown",
      "data.tournamentId": tournamentId,
    });

    // Nếu là HÔM NAY → cho "pass": tạo D0 ở now + 1'
    let d0 = startLocal;
    if (isSameDay) {
      d0 = nowLocal.plus({ minutes: FORCE_MINUTES_TODAY });
      console.warn("[agenda] today pass → force D0 at now+1m", {
        tournamentId,
        tz,
        now: nowLocal.toISO(),
        D0: d0.toISO(),
      });
    }

    // Các mốc; chỉ giữ mốc > hiện tại
    const points = [
      { phase: "D-3", at: minusDays(d0, 3) },
      { phase: "D-2", at: minusDays(d0, 2) },
      { phase: "D-1", at: minusDays(d0, 1) },
      { phase: "D0",  at: d0 },
    ].filter(p => p.at > nowLocal);

    if (!points.length) {
      console.warn("[agenda] skip: all countdown points are in the past", {
        tournamentId, tz, startLocal: startLocal.toISO(), nowLocal: nowLocal.toISO()
      });
      return;
    }

    for (const p of points) {
      const job = await agenda.schedule(p.at.toJSDate(), "notify.tournament.countdown", {
        tournamentId,
        phase: p.phase,
      });
      console.log("[agenda] scheduled", {
        name: job.attrs.name,
        tournamentId,
        phase: p.phase,
        tz,
        runAt: p.at.toISO(),
        nextRunAt: job.attrs.nextRunAt,
      });
    }
  } catch (e) {
    console.error("[agenda] scheduleTournamentCountdown error:", e?.message);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Lập lịch “sắp bắt đầu” cho 1 trận; offsets mặc định [30,15,5] phút
 * ────────────────────────────────────────────────────────────────────────── */
export async function scheduleMatchStartSoon(matchDoc, offsets = [30, 15, 5]) {
  const matchId = String(matchDoc._id);

  // Ưu tiên scheduledAt; fallback startAt
  const startRaw = matchDoc.scheduledAt ?? matchDoc.startAt;
  const start = startRaw instanceof Date ? startRaw : new Date(startRaw);
  if (!start || isNaN(start.getTime())) return;

  await agenda.cancel({
    name: "notify.match.startSoon",
    "data.matchId": matchId,
  });

  for (const m of offsets) {
    const at = new Date(start.getTime() - m * MS_MIN);
    if (at.getTime() <= Date.now()) continue;
    await agenda.schedule(at, "notify.match.startSoon", {
      matchId,
      etaLabel: `${m}′`,
    });
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * (Tuỳ chọn) job tự-heal: mỗi giờ quét các giải/trận sắp diễn ra mà chưa có job
 * ────────────────────────────────────────────────────────────────────────── */
export function registerAutoHealJobs(Models) {
  const { Tournament, Match } = Models;

  // Định nghĩa job quét
  agenda.define("heal.schedules", async (_job, done) => {
    try {
      const now = Date.now();
      const horizon = new Date(now + 4 * MS_DAY); // 4 ngày tới

      // Tournaments trong 4 ngày tới (hỗ trợ cả startDate và startAt)
      const tours = await Tournament.find({
        $or: [
          { startDate: { $gte: new Date(now - MS_DAY), $lte: horizon } },
          { startAt:   { $gte: new Date(now - MS_DAY), $lte: horizon } },
        ],
      })
        .select("_id startDate startAt timezone")
        .lean();

      for (const t of tours) {
        await scheduleTournamentCountdown(t);
      }

      // Matches trong 1 ngày tới
      const matches = await Match.find({
        scheduledAt: { $gte: new Date(now - MS_MIN), $lte: new Date(now + MS_DAY) },
        status: { $nin: ["finished", "canceled"] },
      })
        .select("_id scheduledAt startAt status")
        .lean();

      for (const m of matches) {
        await scheduleMatchStartSoon(m);
      }

      done();
    } catch (e) {
      done(e);
    }
  });

  // Kick off lịch heal nếu chưa có
  (async () => {
    const exists = await agenda.jobs({ name: "heal.schedules" });
    if (!exists.length) {
      await agenda.every("60 minutes", "heal.schedules");
    }
  })();
}
