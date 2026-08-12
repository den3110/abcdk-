// services/cardDeck.js — card encoding chung cho Phỏm + Sâm.
// Encoding: "As" = A♠, "Th" = 10♥, "Kd" = K♦, "2c" = 2♣.
// Ranks: 2-9, T (10), J, Q, K, A. Suits: s♠ h♥ d♦ c♣.
// Không dùng joker (Phỏm + Sâm đều không có joker).

export const SUITS = ["s", "h", "d", "c"];
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"];

// Trọng số bài trong Phỏm/Sâm (2 nhỏ nhất, A lớn nhất; Sâm không có kiểu
// "3 nhỏ nhất, 2 lớn nhất" như Tiến Lên).
export const RANK_ORDER = Object.fromEntries(
  RANKS.map((r, i) => [r, i]),
);

// Trong Sâm Lốc: giá trị 2 nhỏ nhất, A lớn nhất, không có heo (2♥ khác).
// Trong Phỏm: dùng để so bậc cho phỏm (3-lá liên tiếp cùng chất).

export function newDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

export function shuffle(deck) {
  const a = [...deck];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardRank(card) {
  return card?.[0];
}

export function cardSuit(card) {
  return card?.[1];
}

export function rankValue(card) {
  return RANK_ORDER[cardRank(card)] ?? -1;
}

// Sắp xếp tăng dần theo bậc; cùng bậc theo chất (s > h > d > c).
const SUIT_ORDER = { s: 3, h: 2, d: 1, c: 0 };
export function sortHand(cards) {
  return [...cards].sort((a, b) => {
    const dr = rankValue(a) - rankValue(b);
    if (dr !== 0) return dr;
    return (SUIT_ORDER[cardSuit(a)] || 0) - (SUIT_ORDER[cardSuit(b)] || 0);
  });
}
