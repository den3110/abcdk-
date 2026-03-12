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
  }),
  overrideExisting: false,
});

export const { useGetHomeSummaryQuery } = homeApiSlice;
