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
    trackEventLiveView: builder.mutation({
      query: (body) => ({
        url: `/api/event-live/track`,
        method: "POST",
        body: { platform: "web", ...body },
      }),
    }),
    getEventLiveStats: builder.query({
      query: (days = 30) => ({
        url: `/api/event-live/stats?days=${days}`,
        method: "GET",
      }),
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetEventLiveQuery,
  useGetEventLiveConfigQuery,
  useTrackEventLiveViewMutation,
  useGetEventLiveStatsQuery,
} = eventLiveApiSlice;
