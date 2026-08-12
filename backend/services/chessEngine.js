// services/chessEngine.js — Cờ vua wrapper quanh chess.js.
import { Chess } from "chess.js";

export function activeSeats(room) {
  return (room.seats || []).filter((s) => s?.user && !s.sittingOut);
}

// Bắt đầu ván mới — reset board về starting position.
export function startHand(room) {
  const seats = activeSeats(room);
  if (seats.length < 2) throw new Error("Cần đủ 2 người để bắt đầu");
  const chess = new Chess();
  room.fen = chess.fen();
  room.moves = [];
  room.winnerSeatIndex = -1;
  room.resultReason = null;
  room.handNumber += 1;
  room.stage = "playing";
  // Trắng đi trước (seat 0 = trắng)
  room.activeSeatIndex = 0;
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 60) * 1000,
  );
  return room;
}

// Đi 1 nước. move: { from, to, promotion? }
export function applyMove(room, seatIndex, move) {
  if (room.stage !== "playing") {
    throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  }
  if (seatIndex !== room.activeSeatIndex) {
    throw new Error("Chưa tới lượt bạn");
  }
  const chess = new Chess(room.fen);
  const expectedColor = seatIndex === 0 ? "w" : "b";
  if (chess.turn() !== expectedColor) {
    throw new Error("Lượt không khớp trạng thái bàn");
  }
  let result;
  try {
    result = chess.move({
      from: String(move.from),
      to: String(move.to),
      promotion: move.promotion || "q",
    });
  } catch (err) {
    throw new Error("Nước đi không hợp lệ");
  }
  if (!result) throw new Error("Nước đi không hợp lệ");

  room.fen = chess.fen();
  room.moves.push({
    seatIndex,
    from: result.from,
    to: result.to,
    promotion: result.promotion || null,
    san: result.san,
    fenAfter: chess.fen(),
    at: new Date(),
  });

  // Kiểm tra kết thúc
  if (chess.isCheckmate()) {
    room.winnerSeatIndex = seatIndex;
    room.resultReason = "checkmate";
    endHand(room);
    return room;
  }
  if (chess.isStalemate()) {
    room.winnerSeatIndex = -1;
    room.resultReason = "stalemate";
    endHand(room);
    return room;
  }
  if (chess.isDraw() || chess.isThreefoldRepetition() || chess.isInsufficientMaterial()) {
    room.winnerSeatIndex = -1;
    room.resultReason = "draw";
    endHand(room);
    return room;
  }

  // Chuyển lượt
  room.activeSeatIndex = 1 - seatIndex;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 60) * 1000,
  );
  return room;
}

// User đầu hàng
export function applyResign(room, seatIndex) {
  if (room.stage !== "playing") {
    throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  }
  room.winnerSeatIndex = 1 - seatIndex;
  room.resultReason = "resign";
  endHand(room);
  return room;
}

function endHand(room) {
  const stake = room.stake || 100;
  room.stage = "showdown";
  room.turnDeadlineAt = null;
  room.handEndedAt = new Date();
  if (room.winnerSeatIndex >= 0) {
    const winner = room.seats.find(
      (s) => s.seatIndex === room.winnerSeatIndex,
    );
    const loser = room.seats.find(
      (s) => s.seatIndex !== room.winnerSeatIndex && s?.user,
    );
    if (winner && loser) {
      const pay = Math.min(loser.chips, stake);
      loser.chips -= pay;
      winner.chips += pay;
    }
  }
  return room;
}

function enrichWinners(_room) {
  // No-op for chess (single winner tracked via seatIndex).
}

// Trả về list nước đi hợp pháp từ ô `from` (dùng highlight).
export function legalMovesFrom(fen, from) {
  const chess = new Chess(fen);
  try {
    return chess.moves({ square: from, verbose: true }).map((m) => m.to);
  } catch {
    return [];
  }
}

export function serializeRoom(room) {
  return {
    _id: room._id,
    name: room.name,
    createdBy: room.createdBy,
    stake: room.stake,
    buyIn: room.buyIn,
    maxSeats: room.maxSeats,
    seats: (room.seats || []).map((s) => ({
      user: s.user,
      seatIndex: s.seatIndex,
      chips: s.chips,
      sittingOut: s.sittingOut,
    })),
    handNumber: room.handNumber,
    stage: room.stage,
    fen: room.fen,
    activeSeatIndex: room.activeSeatIndex,
    moves: room.moves || [],
    winnerSeatIndex: room.winnerSeatIndex,
    resultReason: room.resultReason,
    turnDeadlineAt: room.turnDeadlineAt,
    turnDurationSec: room.turnDurationSec,
    handStartedAt: room.handStartedAt,
    handEndedAt: room.handEndedAt,
    messages: room.messages || [],
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
  };
}
