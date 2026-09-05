// src/slices/subscriptionApiSlice.js — Theo dõi giải/CLB (push subscriptions)
import { apiSlice } from "./apiSlice";

export const subscriptionApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listMySubscriptions: builder.query({
      query: () => ({ url: `/api/subscriptions/me/subscriptions` }),
      transformResponse: (r) => r?.items || [],
      providesTags: ["Subscriptions"],
    }),
    subscribeTopic: builder.mutation({
      query: ({ topicType, topicId = null }) => ({
        url: `/api/subscriptions`,
        method: "POST",
        body: { topicType, topicId },
      }),
      invalidatesTags: ["Subscriptions"],
    }),
    unsubscribeTopic: builder.mutation({
      query: ({ topicType, topicId = null }) => ({
        url: `/api/subscriptions`,
        method: "DELETE",
        body: { topicType, topicId },
      }),
      invalidatesTags: ["Subscriptions"],
    }),
  }),
  overrideExisting: false,
});

export const {
  useListMySubscriptionsQuery,
  useSubscribeTopicMutation,
  useUnsubscribeTopicMutation,
} = subscriptionApiSlice;
