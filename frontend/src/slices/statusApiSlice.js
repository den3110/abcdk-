import { apiSlice } from "./apiSlice";

export const statusApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPublicStatus: builder.query({
      query: () => ({
        url: "/api/health/status",
        method: "GET",
      }),
      extraOptions: {
        skip404Redirect: true,
        skip503Redirect: true,
        skipSentryCapture: true,
      },
    }),
  }),
});

export const { useGetPublicStatusQuery } = statusApiSlice;
