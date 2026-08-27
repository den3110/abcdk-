// src/slices/nameStyleApiSlice.js — Bản đồ hiệu ứng tên VĐV (public)
import { apiSlice } from "./apiSlice";

export const nameStyleApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getNameStyles: builder.query({
      query: () => ({ url: `/api/name-styles`, method: "GET" }),
      keepUnusedDataFor: 300, // giữ cache 5 phút
      providesTags: ["NameStyle"],
      transformResponse: (resp) => {
        const byId = {};
        const byNick = {};
        for (const s of resp?.styles || []) {
          if (!s?.nameStyle) continue;
          if (s.user) byId[String(s.user)] = s.nameStyle;
          if (s.nickname)
            byNick[String(s.nickname).trim().toLowerCase()] = s.nameStyle;
        }
        return { byId, byNick, count: resp?.count || 0 };
      },
    }),
  }),
  overrideExisting: false,
});

export const { useGetNameStylesQuery } = nameStyleApiSlice;
