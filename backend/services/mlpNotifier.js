// services/mlpNotifier.js — Push + in-app notification cho MLP.
import { sendToUserIds } from "./notifications/expoPush.js";
import { createInAppNotifications } from "./inAppNotify.js";
import MlpTeam from "../models/mlpTeamModel.js";

/**
 * Notify khi team được duyệt hoặc bị từ chối. Recipients = captain + roster.
 */
export async function notifyMlpTeamStatus({ team, tournamentId, status }) {
  try {
    if (!team) return;
    const targets = Array.from(
      new Set(
        [
          team.captain?._id || team.captain,
          ...(team.players || []).map((p) => p?._id || p),
        ]
          .filter(Boolean)
          .map(String),
      ),
    );
    if (!targets.length) return;
    const isApproved = status === "approved";
    const title = isApproved ? "Team đã được duyệt" : "Team bị từ chối";
    const body = isApproved
      ? `Team "${team.name}" đã được BTC duyệt tham gia giải MLP.`
      : `Team "${team.name}" đã bị BTC từ chối tham gia giải MLP.`;
    const url = `/tournament/${tournamentId}/mlp/teams`;
    const kind = isApproved ? "MLP_TEAM_APPROVED" : "MLP_TEAM_REJECTED";
    await sendToUserIds(
      targets,
      { title, body, data: { url, kind, tournamentId: String(tournamentId) } },
      { ttl: 3600 },
    );
    await createInAppNotifications({
      recipients: targets,
      type: kind,
      title,
      body,
      url,
      data: { tournamentId: String(tournamentId), teamId: String(team._id) },
    });
  } catch (err) {
    console.error("[mlpNotifier] team status error:", err?.message || err);
  }
}

/**
 * Notify khi dual sắp diễn ra hoặc vừa kết thúc. Recipients = captain +
 * roster của cả 2 team.
 */
export async function notifyMlpDualEvent({
  dual,
  event, // "scheduled" | "starting-soon" | "finished"
}) {
  try {
    if (!dual) return;
    const teams = await MlpTeam.find({
      _id: { $in: [dual.teamA, dual.teamB].filter(Boolean) },
    })
      .select("name captain players")
      .lean();
    if (!teams.length) return;
    const targets = Array.from(
      new Set(
        teams
          .flatMap((t) => [t.captain, ...(t.players || [])])
          .filter(Boolean)
          .map(String),
      ),
    );
    if (!targets.length) return;
    const [teamA, teamB] = [
      teams.find((t) => String(t._id) === String(dual.teamA)),
      teams.find((t) => String(t._id) === String(dual.teamB)),
    ];
    const label = `${teamA?.name || "Team A"} vs ${teamB?.name || "Team B"}`;
    const url = `/tournament/${dual.tournament}/mlp/duals/${dual._id}`;
    let title, body, kind;
    if (event === "finished") {
      const winnerName =
        dual.winner === "A" ? teamA?.name : dual.winner === "B" ? teamB?.name : null;
      title = "Dual đã kết thúc";
      body = winnerName
        ? `${label}: ${winnerName} thắng (${dual.slotWinsA}-${dual.slotWinsB}).`
        : `${label}: kết thúc (${dual.slotWinsA}-${dual.slotWinsB}).`;
      kind = "MLP_DUAL_FINISHED";
    } else if (event === "starting-soon") {
      title = "Dual sắp bắt đầu";
      body = `${label} sắp thi đấu. Vào ứng dụng để chuẩn bị.`;
      kind = "MLP_DUAL_STARTING";
    } else {
      title = "Lịch dual đã cập nhật";
      body = `${label}${dual.scheduledAt ? ` — ${new Date(dual.scheduledAt).toLocaleString("vi-VN")}` : ""}.`;
      kind = "MLP_DUAL_SCHEDULED";
    }
    await sendToUserIds(
      targets,
      {
        title,
        body,
        data: { url, kind, dualId: String(dual._id) },
      },
      { ttl: 3600 },
    );
    await createInAppNotifications({
      recipients: targets,
      type: kind,
      title,
      body,
      url,
      data: { dualId: String(dual._id) },
    });
  } catch (err) {
    console.error("[mlpNotifier] dual event error:", err?.message || err);
  }
}
