import { apiSlice } from "./apiSlice"; // file gốc của bạn
const LIMIT = 10;

export const rankingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getRankings: builder.query({
      query: ({ keyword = "", page = 0 }) =>
        `/api/rankings?keyword=${encodeURIComponent(
          keyword
        )}&page=${page}&limit=${LIMIT}`,
      keepUnusedDataFor: 30,
      
    }),
  }),
});

export const { useGetRankingsQuery } = rankingsApiSlice;
