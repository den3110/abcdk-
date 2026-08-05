// src/slices/coachesApiSlice.js — Danh sách Huấn luyện viên (public).
import { apiSlice } from "./apiSlice";

export const coachesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listCoaches: builder.query({
      query: ({ q, province, sort = "rating", cursor, limit = 20 } = {}) => {
        const p = new URLSearchParams();
        if (q) p.set("q", q);
        if (province) p.set("province", province);
        if (sort) p.set("sort", sort);
        if (cursor) p.set("cursor", cursor);
        if (limit) p.set("limit", String(limit));
        const qs = p.toString();
        return { url: `/api/coaches${qs ? `?${qs}` : ""}`, method: "GET" };
      },
      serializeQueryArgs: ({ queryArgs }) => {
        const { cursor: _c, ...rest } = queryArgs || {};
        return rest;
      },
      merge: (currentCache, newResponse, { arg }) => {
        if (!arg?.cursor) return newResponse;
        const existing = new Set(
          (currentCache?.items || []).map((i) => String(i._id)),
        );
        const appended = (newResponse?.items || []).filter(
          (i) => !existing.has(String(i._id)),
        );
        return {
          ...newResponse,
          items: [...(currentCache?.items || []), ...appended],
        };
      },
      forceRefetch({ currentArg, previousArg }) {
        return currentArg?.cursor !== previousArg?.cursor;
      },
      providesTags: [{ type: "Coaches", id: "LIST" }],
    }),
    listCoachProvinces: builder.query({
      query: () => ({ url: `/api/coaches/provinces`, method: "GET" }),
    }),
  }),
});

export const { useListCoachesQuery, useListCoachProvincesQuery } =
  coachesApiSlice;
