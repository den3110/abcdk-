// src/slices/chatBotApiSlice.js
import { apiSlice } from "./apiSlice";

export const chatBotApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    sendMessage: builder.mutation({
      query: (data) => ({
        url: "/api/chat",
        method: "POST",
        body: data,
      }),
    }),
    getChatHistory: builder.query({
      query: ({ before } = {}) => ({
        url: `/api/chat/history${before ? `?before=${before}` : ""}`,
        method: "GET",
      }),
    }),
    clearChatHistory: builder.mutation({
      query: () => ({
        url: "/api/chat/history",
        method: "DELETE",
      }),
    }),
    clearLearningMemory: builder.mutation({
      query: () => ({
        url: "/api/chat/learning",
        method: "DELETE",
      }),
    }),
  }),
});

export const {
  useSendMessageMutation,
  useGetChatHistoryQuery,
  useClearChatHistoryMutation,
  useClearLearningMemoryMutation,
} = chatBotApiSlice;
