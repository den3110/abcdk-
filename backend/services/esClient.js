// src/services/esClient.js
import { Client } from "@elastic/elasticsearch";

const ES_NODE = process.env.ES_NODE || "http://localhost:9200";
const ES_TOURNAMENT_INDEX = process.env.ES_TOURNAMENT_INDEX || "tournaments";
const ES_USER_INDEX = process.env.ES_USER_INDEX || "users";
const ES_ENABLED = String(process.env.ES_ENABLED || "false").toLowerCase() === "true";

const createNoopEsClient = () => ({
  async search() {
    return { hits: { hits: [] } };
  },
  async index() {
    return {};
  },
  async delete() {
    return {};
  },
  indices: {
    async refresh() {
      return {};
    },
  },
});

export const es = ES_ENABLED
  ? new Client({
      node: ES_NODE,
      // Nếu sau này bật auth:
      // auth: {
      //   username: process.env.ES_USERNAME,
      //   password: process.env.ES_PASSWORD,
      // },
    })
  : createNoopEsClient();

export { ES_ENABLED, ES_TOURNAMENT_INDEX, ES_USER_INDEX };
