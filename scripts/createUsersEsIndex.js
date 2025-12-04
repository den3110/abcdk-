// scripts/createUsersEsIndex.js
import dotenv from "dotenv";
dotenv.config();

import { es, ES_USER_INDEX } from "../backend/services/esClient.js";

async function main() {
  const indexName = ES_USER_INDEX || "users";

  console.log("[ES] Using users index:", indexName);

  const exists = await es.indices.exists({ index: indexName });
  if (exists) {
    console.log(`[ES] Index "${indexName}" đã tồn tại, bỏ qua tạo mới.`);
    return;
  }

  await es.indices.create({
    index: indexName,
    settings: {
      analysis: {
        normalizer: {
          lower_normalizer: {
            type: "custom",
            filter: ["lowercase", "asciifolding"],
          },
        },
      },
    },
    mappings: {
      properties: {
        // ❌ KHÔNG ĐỤNG TỚI _id, KHÔNG CẦN userId
        name: {
          type: "text",
          fields: {
            keyword: {
              type: "keyword",
              ignore_above: 256,
            },
          },
        },
        nickname: {
          type: "text",
          fields: {
            raw: {
              type: "keyword",
              normalizer: "lower_normalizer",
            },
          },
        },
        province: {
          type: "keyword",
          normalizer: "lower_normalizer",
        },
        avatar: { type: "keyword" },
        email: { type: "keyword" },
        phone: { type: "keyword" },
        isDeleted: { type: "boolean" },
        createdAt: { type: "date" },
      },
    },
  });

  console.log(`[ES] Đã tạo index "${indexName}" thành công.`);
}

main().catch((err) => {
  console.error("[ES] createUsersEsIndex error:", err);
  process.exit(1);
});
