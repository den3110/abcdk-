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
    // ✅ List rankings (không kèm podiums30d)
    getRankingsList: builder.query({
      query: ({ cursor, page, limit = 12, keyword } = {}) => {
        const params = new URLSearchParams();
        if (cursor) params.set("cursor", String(cursor));
        if (page !== undefined && page !== null)
          params.set("page", String(page));
        if (limit) params.set("limit", String(limit));
        if (keyword) params.set("keyword", String(keyword).trim());
        const qs = params.toString();
        return {
          url: `/api/rankings/rankings${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      // nếu bạn có tags cho rankings thì thêm vào đây
      // providesTags: (result) => [{ type: "Rankings", id: "LIST" }],
      keepUnusedDataFor: 10,
    }),

    // ✅ Podiums 30d only
    getRankingsPodiums30d: builder.query({
      query: () => ({
        url: `/api/rankings/podium30d`,
        method: "GET",
      }),
      keepUnusedDataFor: 30,
    }),
  }),
});

export const {
  useGetRankingsQuery,
  useGetRankingsListQuery,
  useGetRankingsPodiums30dQuery,
} = rankingsApiSlice;
