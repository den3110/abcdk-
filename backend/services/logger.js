// src/services/logger.js
import { es } from "./esClient.js";

const SERVICE_NAME = process.env.SERVICE_NAME || "pickletour-api";
const ENV = process.env.NODE_ENV || "development";

// tạo index theo ngày: pkt-logs-2025-11-30
function getLogIndex() {
  const d = new Date();
  const day = d.toISOString().slice(0, 10); // yyyy-mm-dd
  return `pkt-logs-${day}`;
}

async function logToES(doc) {
  try {
    await es.index({
      index: getLogIndex(),
      document: {
        "@timestamp": new Date().toISOString(),
        service: SERVICE_NAME,
        env: ENV,
        ...doc,
      },
    });
  } catch (err) {
    // không để việc log làm crash app
    console.error("[logger] ES log error:", err?.message || err);
  }
}

export const logger = {
  // log generic
  async log(level, message, extra = {}) {
    await logToES({
      level,
      message,
      ...extra,
    });
  },

  info(message, extra) {
    return logger.log("info", message, extra);
  },

  warn(message, extra) {
    return logger.log("warn", message, extra);
  },

  error(message, extra) {
    return logger.log("error", message, extra);
  },

  debug(message, extra) {
    // tuỳ env mà bạn cho log hay không
    if (ENV === "production") return;
    return logger.log("debug", message, extra);
  },
};
