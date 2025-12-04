// src/services/esClient.js
import { Client } from "@elastic/elasticsearch";

const ES_NODE = process.env.ES_NODE || "http://localhost:9200";
const ES_TOURNAMENT_INDEX = process.env.ES_TOURNAMENT_INDEX || "tournaments";

// 👇 thêm index cho users
const ES_USER_INDEX = process.env.ES_USER_INDEX || "users";

export const es = new Client({
  node: ES_NODE,
  // Nếu sau này bật auth:
  // auth: {
  //   username: process.env.ES_USERNAME,
  //   password: process.env.ES_PASSWORD,
  // },
});

// export tất cả constant
export { ES_TOURNAMENT_INDEX, ES_USER_INDEX };
