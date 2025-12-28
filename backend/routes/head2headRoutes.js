// routes/head2headRoutes.js
import express from "express";
import {
  getHead2Head,
  getHead2HeadMatches,
  getFrequentOpponents,
  getPlayerStats,
  searchPlayers,
} from "../controllers/head2headController.js";

const router = express.Router();

/**
 * @route   GET /api/head2head/search
 * @desc    Tìm kiếm người chơi
 * @access  Public
 * @query   keyword (string, min 2 chars), limit (number, default 20)
 */
router.get("/search", searchPlayers);

/**
 * @route   GET /api/head2head/:playerId/stats
 * @desc    Lấy stats tổng hợp của 1 người chơi
 * @access  Public
 * @params  playerId - ObjectId của user
 */
router.get("/:playerId/stats", getPlayerStats);

/**
 * @route   GET /api/head2head/:playerId/opponents
 * @desc    Lấy danh sách đối thủ thường xuyên
 * @access  Public
 * @params  playerId - ObjectId của user
 * @query   limit (number, default 10, max 30)
 */
router.get("/:playerId/opponents", getFrequentOpponents);

/**
 * @route   GET /api/head2head/:player1Id/:player2Id
 * @desc    Lấy thống kê đối đầu giữa 2 người chơi
 * @access  Public
 * @params  player1Id, player2Id - ObjectId của 2 users
 */
router.get("/:player1Id/:player2Id", getHead2Head);

/**
 * @route   GET /api/head2head/:player1Id/:player2Id/matches
 * @desc    Lấy lịch sử các trận đấu (pagination)
 * @access  Public
 * @params  player1Id, player2Id - ObjectId của 2 users
 * @query   page (default 1), limit (default 10, max 50)
 */
router.get("/:player1Id/:player2Id/matches", getHead2HeadMatches);

export default router;