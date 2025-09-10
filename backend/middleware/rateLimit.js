// middlewares/rateLimit.js
let last = new Map(); // đơn giản theo IP
export function simpleRateLimit(windowMs = 60_000, max = 5) {
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const arr = (last.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max)
      return res.status(429).json({ message: "Thử lại sau ít phút" });
    arr.push(now);
    last.set(key, arr);
    next();
  };
}
