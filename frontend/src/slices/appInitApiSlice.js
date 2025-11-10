// src/slices/appInitApiSlice.js
import { apiSlice } from "./apiSlice";

export const appInitApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getAppInit: builder.query({
      query: () => ({
        url: "/api/app/init",
        method: "GET",
      }),
    }),
  }),
});

export const { useGetAppInitQuery } = appInitApiSlice;
