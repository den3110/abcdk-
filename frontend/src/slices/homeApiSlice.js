// src/slices/homeApiSlice.js
import { apiSlice } from "./apiSlice";

export const homeApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getHomeSummary: builder.query({
      query: (params = {}) => ({
        url: "/api/public/home",
        params,
      }),
    }),
    getHomePulse: builder.query({
      query: () => ({
        url: "/api/public/home/pulse",
      }),
      keepUnusedDataFor: 30,
    }),
  }),
  overrideExisting: false,
});

export const { useGetHomeSummaryQuery, useGetHomePulseQuery } = homeApiSlice;
