// src/slices/eventLiveApiSlice.js — Xem live giải đấu qua YouTube
import { apiSlice } from "./apiSlice";

export const eventLiveApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getEventLive: builder.query({
      query: () => ({ url: `/api/event-live`, method: "GET" }),
      keepUnusedDataFor: 30,
    }),
    getEventLiveConfig: builder.query({
      query: () => ({ url: `/api/event-live/config`, method: "GET" }),
      keepUnusedDataFor: 120,
    }),
  }),
  overrideExisting: false,
});

export const { useGetEventLiveQuery, useGetEventLiveConfigQuery } =
  eventLiveApiSlice;
