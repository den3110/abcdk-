// services/caroEngine.js — Cờ Caro / Gomoku engine.
// Rules: 15x15 (default), 2 người X vs O, 5 lá liên tiếp (ngang/dọc/chéo) win.

export function activeSeats(room) {
  return (room.seats || []).filter((s) => s?.user && !s.sittingOut);
}

function idx(r, c, size) {
  return r * size + c;
}

// Kiểm tra 5 liên tiếp bắt đầu từ (r,c) theo hướng (dr,dc). Trả về list ô nếu win.
function checkLine(board, size, r, c, dr, dc, mark) {
  const line = [];
  for (let k = 0; k < 5; k++) {
    const rr = r + dr * k;
    const cc = c + dc * k;
    if (rr < 0 || rr >= size || cc < 0 || cc >= size) return null;
    if (board[idx(rr, cc, size)] !== mark) return null;
    line.push([rr, cc]);
  }
  return line;
}

// Kiểm tra sau khi đánh (r,c) mark có win không. Trả về array line thắng hoặc null.
export function checkWin(board, size, r, c, mark) {
  const dirs = [
    [0, 1], // ngang
    [1, 0], // dọc
    [1, 1], // chéo \
    [1, -1], // chéo /
  ];
  for (const [dr, dc] of dirs) {
    // Với mỗi hướng, tìm chuỗi dài nhất chứa (r,c)
    // Đếm về trước
    let back = 0;
    while (
      back < 4 &&
      board[
        idx(r - dr * (back + 1), c - dc * (back + 1), size)
      ] === mark &&
      r - dr * (back + 1) >= 0 &&
      r - dr * (back + 1) < size &&
      c - dc * (back + 1) >= 0 &&
      c - dc * (back + 1) < size
    ) {
      back += 1;
    }
    const startR = r - dr * back;
    const startC = c - dc * back;
    const line = checkLine(board, size, startR, startC, dr, dc, mark);
    if (line) return line;
    // Thử với chuỗi 5 dài hơn (chuỗi 6+ vẫn thắng)
    for (let k = 1; k <= 4; k++) {
      const l = checkLine(
        board,
        size,
        startR + dr * k,
        startC + dc * k,
        dr,
        dc,
        mark,
      );
      if (l) return l;
    }
  }
  return null;
}

// Ván mới. Ai đi trước (X = seatIndex 0) có thể luân phiên theo handNumber.
export function startHand(room) {
  const seats = activeSeats(room);
  if (seats.length < 2) throw new Error("Cần đủ 2 người để bắt đầu");
  const size = room.boardSize || 15;
  room.board = new Array(size * size).fill("");
  room.moves = [];
  room.winnerSeatIndex = -1;
  room.winningLine = [];
  room.handNumber += 1;
  room.stage = "playing";
  // Luân phiên: ván 1 seat 0 đi trước, ván 2 seat 1 đi trước
  room.activeSeatIndex = (room.handNumber - 1) % 2;
  room.handStartedAt = new Date();
  room.handEndedAt = null;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 30) * 1000,
  );
  return room;
}

// User đánh 1 ô (r, c).
export function applyMove(room, seatIndex, row, col) {
  if (room.stage !== "playing") {
    throw new Error("Ván chưa bắt đầu hoặc đã kết thúc");
  }
  if (seatIndex !== room.activeSeatIndex) {
    throw new Error("Chưa tới lượt bạn");
  }
  const size = room.boardSize || 15;
  if (
    !Number.isInteger(row) ||
    !Number.isInteger(col) ||
    row < 0 ||
    row >= size ||
    col < 0 ||
    col >= size
  ) {
    throw new Error("Toạ độ không hợp lệ");
  }
  const i = idx(row, col, size);
  if (room.board[i]) {
    throw new Error("Ô này đã có quân");
  }
  const mark = seatIndex === 0 ? "X" : "O";
  room.board[i] = mark;
  room.moves.push({ seatIndex, row, col, at: new Date() });

  // Kiểm tra thắng
  const winLine = checkWin(room.board, size, row, col, mark);
  if (winLine) {
    room.winnerSeatIndex = seatIndex;
    room.winningLine = winLine;
    endHand(room);
    return room;
  }

  // Kiểm tra hoà (board đầy)
  if (room.board.every((c) => c)) {
    endHand(room, true);
    return room;
  }

  // Chuyển lượt
  room.activeSeatIndex = 1 - seatIndex;
  const now = Date.now();
  room.turnDeadlineAt = new Date(
    now + (room.turnDurationSec || 30) * 1000,
  );
  return room;
}

// Kết thúc ván. Chip settlement: loser trả stake cho winner.
function endHand(room, draw = false) {
  const stake = room.stake || 100;
  room.stage = "showdown";
  room.turnDeadlineAt = null;
  room.handEndedAt = new Date();
  if (draw) {
    return room;
  }
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
  return room;
}

// Serialize cho client.
export function serializeRoom(room) {
  const size = room.boardSize || 15;
  return {
    _id: room._id,
    name: room.name,
    createdBy: room.createdBy,
    stake: room.stake,
    buyIn: room.buyIn,
    boardSize: size,
    maxSeats: room.maxSeats,
    seats: (room.seats || []).map((s) => ({
      user: s.user,
      seatIndex: s.seatIndex,
      chips: s.chips,
      sittingOut: s.sittingOut,
    })),
    handNumber: room.handNumber,
    stage: room.stage,
    activeSeatIndex: room.activeSeatIndex,
    board: room.board || [],
    moves: room.moves || [],
    winnerSeatIndex: room.winnerSeatIndex,
    winningLine: room.winningLine || [],
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
