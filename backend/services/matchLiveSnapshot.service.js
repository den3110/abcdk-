import Match from "../models/matchModel.js";

const pickTrim = (value) => (value && String(value).trim()) || "";

function fillPlayerNick(player) {
  if (!player) return player;
  const nickname =
    pickTrim(player.nickname) ||
    pickTrim(player.nickName) ||
    pickTrim(player.user?.nickname) ||
    pickTrim(player.user?.nickName);
  if (nickname) {
    player.nickname = nickname;
    player.nickName = nickname;
  }
  return player;
}

export async function loadMatchLiveSnapshot(matchId) {
  const match = await Match.findById(matchId)
    .populate({
      path: "pairA",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "name fullName nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "name fullName nickname nickName" },
        },
      ],
    })
    .populate({
      path: "pairB",
      select: "player1 player2 seed label teamName",
      populate: [
        {
          path: "player1",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "name fullName nickname nickName" },
        },
        {
          path: "player2",
          select: "fullName name shortName nickname nickName user",
          populate: { path: "user", select: "name fullName nickname nickName" },
        },
      ],
    })
    .populate({
      path: "referee",
      select: "name fullName nickname nickName",
    })
    .populate({ path: "liveBy", select: "name fullName nickname nickName" })
    .populate({ path: "previousA", select: "round order" })
    .populate({ path: "previousB", select: "round order" })
    .populate({ path: "nextMatch", select: "_id" })
    .populate({
      path: "tournament",
      select: "name image eventType overlay nameDisplayMode",
    })
    .populate({
      path: "bracket",
      select: [
        "noRankDelta",
        "name",
        "type",
        "stage",
        "order",
        "drawRounds",
        "drawStatus",
        "scheduler",
        "drawSettings",
        "meta.drawSize",
        "meta.maxRounds",
        "meta.expectedFirstRoundMatches",
        "groups._id",
        "groups.name",
        "groups.code",
        "groups.regIds",
        "groups.expectedSize",
        "config.rules",
        "config.doubleElim",
        "config.roundRobin",
        "config.swiss",
        "config.gsl",
        "config.roundElim",
        "overlay",
      ].join(" "),
    })
    .populate({
      path: "court",
      select: "name number code label zone area venue building floor order",
    })
    .lean();

  if (!match) return null;

  if (match.pairA) {
    match.pairA.player1 = fillPlayerNick(match.pairA.player1);
    match.pairA.player2 = fillPlayerNick(match.pairA.player2);
  }
  if (match.pairB) {
    match.pairB.player1 = fillPlayerNick(match.pairB.player1);
    match.pairB.player2 = fillPlayerNick(match.pairB.player2);
  }
  if (!match.streams && match.meta?.streams) {
    match.streams = match.meta.streams;
  }

  return match;
}
