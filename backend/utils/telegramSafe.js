// utils/telegramSafe.js
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isTg429(err) {
  return (
    err?.response?.error_code === 429 &&
    Number(err?.response?.parameters?.retry_after) > 0
  );
}

/**
 * Gửi tin an toàn cho Telegram, tự xử lý 429 (retry_after).
 * - fn: hàm async thực hiện việc gọi Telegram API (ví dụ: () => ctx.reply(...))
 * - label: để log
 * - maxRetry: số lần thử lại khi dính 429
 */
export async function tgSendSafe(fn, { label = "send", maxRetry = 2 } = {}) {
  let attempt = 0;
  while (attempt <= maxRetry) {
    try {
      return await fn();
    } catch (e) {
      if (isTg429(e)) {
        const ra = Number(e.response.parameters.retry_after);
        console.warn(`[tgSafe] 429 on ${label}, retry after ${ra}s`);
        await sleep((ra + 1) * 1000);
        attempt++;
        continue;
      }
      // các lỗi khác: log & bỏ qua để không crash
      console.warn(`[tgSafe] ${label} error:`, e?.response || e?.message || e);
      return null;
    }
  }
  return null;
}

// ====== Các wrapper tiện dụng ======

export async function replySafe(ctx, text, extra = {}, opts = {}) {
  return tgSendSafe(() => ctx.reply(text, extra), {
    label: "sendMessage",
    ...opts,
  });
}

export async function editMessageTextSafe(ctx, text, extra = {}, opts = {}) {
  return tgSendSafe(() => ctx.editMessageText(text, extra), {
    label: "editMessageText",
    ...opts,
  });
}

export async function answerCbQuerySafe(ctx, text, extra = {}, opts = {}) {
  return tgSendSafe(() => ctx.answerCbQuery(text, extra), {
    label: "answerCbQuery",
    ...opts,
  });
}
