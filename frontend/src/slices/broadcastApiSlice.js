// src/slices/broadcastApiSlice.js
import { apiSlice } from "./apiSlice";

export const broadcastApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Gửi push broadcast tới toàn bộ user (admin).
    // Backend: POST /api/events/global/broadcast
    // body: { scope, title, body, url?, platform?, minVersion?, maxVersion?, badge?, ttl? }
    sendGlobalBroadcast: builder.mutation({
      query: (body) => ({
        url: `/api/events/global/broadcast`,
        method: "POST",
        body,
      }),
    }),
  }),
});

export const { useSendGlobalBroadcastMutation } = broadcastApiSlice;
