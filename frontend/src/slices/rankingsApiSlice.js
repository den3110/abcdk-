// src/slices/rankingsApiSlice.js
import { apiSlice } from "./apiSlice";
import { buildRankingToken } from "../utils/rankingSec";

const LIMIT = 12;
const RANKING_PATH = "/api/v1/rankings/list";

export const rankingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getRankings: builder.query({
      // hỗ trợ cả cursor mới lẫn page cũ
      query: ({ keyword = "", cursor = null, page = 0 } = {}) => {
        const params = new URLSearchParams();

        if (keyword) {
          params.set("keyword", keyword);
        }

        params.set("limit", String(LIMIT));

        if (cursor) {
          // flow mới: dùng cursor
          params.set("cursor", cursor);
        } else {
          // fallback: vẫn set page cho các đoạn code cũ
          params.set("page", String(page));
        }

        const qs = `?${params.toString()}`;
        const url = `${RANKING_PATH}${qs}`;

        return {
          url,
          method: "GET",
          headers: {
            // helper đã tự bỏ query, nên đổi cursor/page không ảnh hưởng
            "x-rank-sec": buildRankingToken(url, "GET"),
          },
        };
      },
      keepUnusedDataFor: 30,
    }),
  }),
});

export const { useGetRankingsQuery } = rankingsApiSlice;
