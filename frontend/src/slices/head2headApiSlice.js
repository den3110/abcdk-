// src/slices/head2headApiSlice.js — vị trí sở trường (ô 1/ô 2) của VĐV
import { apiSlice } from "./apiSlice";

export const head2headApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Vị trí sở trường của 1 VĐV
    getPlayerPosition: builder.query({
      query: (playerId) => ({
        url: `/api/head2head/${playerId}/position`,
        method: "GET",
      }),
      transformResponse: (res) => res?.data || res,
      keepUnusedDataFor: 300,
    }),
    // Vị trí sở trường của nhiều VĐV (bảng xếp hạng) → map { userId: {...} }
    getPlayerPositions: builder.query({
      query: (userIds) => ({
        url: `/api/head2head/positions`,
        method: "POST",
        body: { userIds: Array.isArray(userIds) ? userIds : [] },
      }),
      transformResponse: (res) => res?.data || {},
      keepUnusedDataFor: 300,
    }),
  }),
  overrideExisting: false,
});

export const { useGetPlayerPositionQuery, useGetPlayerPositionsQuery } =
  head2headApiSlice;
