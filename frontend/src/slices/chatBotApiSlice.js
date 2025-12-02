// src/slices/chatBotApiSlice.js
import { apiSlice } from "./apiSlice";

export const chatBotApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    chatBot: builder.query({
      query: () => ({ url: "/api/bot/chat", method: "POST" }),
    }),
  }),
});

export const { useChatBotQuery } = chatBotApiSlice;
