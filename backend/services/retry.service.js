// services/retry.service.js
export async function withRetry(fn, { retries = 3, baseMs = 300, factor = 2 } = {}) {
  let last;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); } catch (e) { last = e; }
    const ms = Math.round((baseMs * Math.pow(factor, i)) * (0.7 + Math.random() * 0.6));
    await new Promise(r => setTimeout(r, ms));
  }
  throw last;
}
