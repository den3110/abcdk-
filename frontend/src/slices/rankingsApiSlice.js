// src/slices/rankingsApiSlice.js
import { apiSlice } from "./apiSlice";
import { buildRankingToken } from "../utils/rankingSec";

const LIMIT = 12;
const RANKING_PATH = "/api/v1/rankings/list";

export const rankingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getRankings: builder.query({
      query: ({ keyword = "", page = 0 } = {}) => {
        const qs = `?keyword=${encodeURIComponent(
          keyword
        )}&page=${page}&limit=${LIMIT}`;

        const url = `${RANKING_PATH}${qs}`;

        return {
          url,
          method: "GET",
          headers: {
            // Token ký theo URL (helper sẽ tự bỏ query + normalize path)
            "x-rank-sec": buildRankingToken(url, "GET"),
          },
        };
      },
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useGetRankingsQuery } = rankingsApiSlice;
