import asyncHandler from "express-async-handler";
import Match from "../models/matchModel.js";

// controllers/matchController.js
 const getMatchesByTournament = asyncHandler(async (req, res) => {
  const raw = await Match.find({ tournament: req.params.id })
    .populate([
      { path: 'reg1', select: 'player1.fullName player2.fullName player1.avatar player2.avatar' },
      { path: 'reg2', select: 'player1.fullName player2.fullName player1.avatar player2.avatar' },
    ])
    .sort({ date: 1, time: 1 });

  // 👉  chỉ giữ trận đủ 2 registration
  const result = raw
    .filter((m) => m.reg1 && m.reg2)        // bỏ trận thiếu đội
    .map((m) => ({
      _id:     m._id,
      code:    m.code,
      date:    m.date,
      time:    m.time,
      team1:   `${m.reg1.player1.fullName} / ${m.reg1.player2.fullName}`,
      team2:   `${m.reg2.player1.fullName} / ${m.reg2.player2.fullName}`,
      avatar1: m.reg1.player1.avatar || '',
      avatar2: m.reg2.player1.avatar || '',
      score1:  m.score1,
      score2:  m.score2,
      field:   m.field,
      referee: m.referee,
      status:  m.status,
    }));

  res.json(result);
});


export { getMatchesByTournament };
