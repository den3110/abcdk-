// src/slices/adminMatchLiveApiSlice.js

import apiSlice from "./apiSlice";

export const adminMatchLiveApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    createFacebookLiveForMatch: builder.mutation({
      query: (matchId) => ({
        url: `/api/matches/${matchId}/live/facebook`,
        method: "POST",
      }),
    }),
  }),
  overrideExisting: false,
});

export const { useCreateFacebookLiveForMatchMutation } = adminMatchLiveApiSlice;
