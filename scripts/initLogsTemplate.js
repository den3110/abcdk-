// scripts/initLogsTemplate.js
import dotenv from "dotenv";
dotenv.config();

import { es } from "../backend/services/esClient.js"; // chỉnh path đúng với project của bạn

async function initLogsTemplate() {
  const templateName = "pkt-logs-template";

  const res = await es.indices.putIndexTemplate({
    name: templateName,
    body: {
      index_patterns: ["pkt-logs-*"],
      template: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
        mappings: {
          properties: {
            "@timestamp": { type: "date" },

            level: { type: "keyword" },        // info / warn / error / debug
            service: { type: "keyword" },      // ví dụ "api-gateway", "tournament-service"
            env: { type: "keyword" },          // dev / staging / prod

            message: { type: "text" },

            // HTTP log fields
            type: { type: "keyword" },         // ví dụ: "http_access", "app_error"
            requestId: { type: "keyword" },
            userId: { type: "keyword" },
            method: { type: "keyword" },
            url: {
              type: "text",
              fields: { keyword: { type: "keyword" } },
            },
            status: { type: "integer" },
            durationMs: { type: "integer" },
            ip: { type: "ip" },

            // error info
            errorName: { type: "keyword" },
            errorMessage: { type: "text" },
            errorStack: { type: "text" },

            // optional extra meta
            meta: { type: "object", enabled: true },
          },
        },
      },
    },
  });

  console.log("✅ initLogsTemplate done:", res);
}

initLogsTemplate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("initLogsTemplate error:", err);
    process.exit(1);
  });
