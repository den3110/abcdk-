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
    sendChatFeedback: builder.mutation({
      query: (data) => ({
        url: "/api/chat/feedback",
        method: "POST",
        body: data,
      }),
    }),
    sendChatTelemetryEvent: builder.mutation({
      query: (data) => ({
        url: "/api/chat/telemetry/event",
        method: "POST",
        body: data,
      }),
    }),
    commitChatMutation: builder.mutation({
      query: (data) => ({
        url: "/api/chat/mutation/commit",
        method: "POST",
        body: data,
      }),
    }),
    getChatTelemetrySummary: builder.query({
      query: ({ days = 7 } = {}) => ({
        url: `/api/chat/telemetry/summary?days=${days}`,
        method: "GET",
      }),
    }),
    getChatTelemetryTurns: builder.query({
      query: ({ days = 7, page = 1, limit = 20, outcome = "", intent = "", routeKind = "" } = {}) => ({
        url:
          `/api/chat/telemetry/turns?days=${days}&page=${page}&limit=${limit}` +
          `${outcome ? `&outcome=${encodeURIComponent(outcome)}` : ""}` +
          `${intent ? `&intent=${encodeURIComponent(intent)}` : ""}` +
          `${routeKind ? `&routeKind=${encodeURIComponent(routeKind)}` : ""}`,
        method: "GET",
      }),
    }),
    getChatRolloutConfig: builder.query({
      query: () => ({
        url: "/api/chat/rollout",
        method: "GET",
      }),
    }),
    updateChatRolloutConfig: builder.mutation({
      query: (data) => ({
        url: "/api/chat/rollout",
        method: "PUT",
        body: data,
      }),
    }),
  }),
});

export const {
  useSendMessageMutation,
  useGetChatHistoryQuery,
  useClearChatHistoryMutation,
  useClearLearningMemoryMutation,
  useSendChatFeedbackMutation,
  useSendChatTelemetryEventMutation,
  useCommitChatMutationMutation,
  useGetChatTelemetrySummaryQuery,
  useGetChatTelemetryTurnsQuery,
  useGetChatRolloutConfigQuery,
  useUpdateChatRolloutConfigMutation,
} = chatBotApiSlice;
