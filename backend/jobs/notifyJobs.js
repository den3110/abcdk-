// src/jobs/notifyJobs.js
import { agenda } from "./agenda.js";
import {
  publishNotification,
  EVENTS,
  CATEGORY,
} from "../services/notifications/notificationHub.js";
import Match from "../models/matchModel.js";
import Tournament from "../models/tournamentModel.js";

/** D-3/D-2/D-1/D0 */
agenda.define("notify.tournament.countdown", async (job, done) => {
  try {
    const { tournamentId, phase } = job.attrs.data || {};
    if (!tournamentId || !phase) return done();

    const t = await Tournament.findById(tournamentId)
      .select("_id startAt")
      .lean();
    if (!t || !t.startAt) return done();

    await publishNotification(EVENTS.TOURNAMENT_COUNTDOWN, {
      tournamentId,
      topicType: "tournament",
      topicId: tournamentId,
      category: CATEGORY.COUNTDOWN,
      phase, // "D-3"|"D-2"|"D-1"|"D0"
    });

    done();
  } catch (e) {
    done(e);
  }
});

/** Match sắp bắt đầu (ví dụ trước 30’, 15’, 5’) */
agenda.define("notify.match.startSoon", async (job, done) => {
  try {
    const { matchId, etaLabel } = job.attrs.data || {};
    if (!matchId) return done();

    const m = await Match.findById(matchId)
      .select("_id status scheduledAt court label")
      .lean();
    if (!m) return done();
    if (["finished", "canceled"].includes(m.status)) return done();

    const label = m.label || ""; // ví dụ "R1#3 • Sân 2 • 10:30"
    await publishNotification(EVENTS.MATCH_START_SOON, {
      matchId,
      topicType: "match",
      topicId: matchId,
      category: CATEGORY.SCHEDULE,
      label,
      eta: etaLabel, // "30′" | "15′" | "5′"
    });

    done();
  } catch (e) {
    done(e);
  }
});
