import Ranking from '../models/rankingModel.js';
import asyncHandler from 'express-async-handler';

export const getRankings = asyncHandler(async (req, res) => {
  const keyword = req.query.keyword
    ? { nickname: { $regex: req.query.keyword, $options: 'i' } }
    : {};

  const list = await Ranking.find(keyword)
    .populate('user', 'nickname gender province avatar verified createdAt')
    .sort({ double: -1 });

  res.json(list);
});
