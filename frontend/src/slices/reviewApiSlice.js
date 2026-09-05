// src/slices/reviewApiSlice.js — Đánh giá giải đấu / sân chơi
import { apiSlice } from "./apiSlice";

export const reviewApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getReviews: builder.query({
      query: ({ targetType, targetId, page = 1, limit = 20 }) => ({
        url: `/api/reviews/${targetType}/${targetId}`,
        params: { page, limit },
      }),
      providesTags: (r, e, { targetType, targetId }) => [
        { type: "Reviews", id: `${targetType}:${targetId}` },
      ],
    }),
    getReviewSummary: builder.query({
      query: ({ targetType, targetId }) => ({
        url: `/api/reviews/${targetType}/${targetId}/summary`,
      }),
      providesTags: (r, e, { targetType, targetId }) => [
        { type: "Reviews", id: `sum:${targetType}:${targetId}` },
      ],
    }),
    upsertReview: builder.mutation({
      query: ({ targetType, targetId, rating, comment, aspects }) => ({
        url: `/api/reviews/${targetType}/${targetId}`,
        method: "POST",
        body: { rating, comment, aspects },
      }),
      invalidatesTags: (r, e, { targetType, targetId }) => [
        { type: "Reviews", id: `${targetType}:${targetId}` },
        { type: "Reviews", id: `sum:${targetType}:${targetId}` },
      ],
    }),
    deleteMyReview: builder.mutation({
      query: ({ targetType, targetId }) => ({
        url: `/api/reviews/${targetType}/${targetId}`,
        method: "DELETE",
      }),
      invalidatesTags: (r, e, { targetType, targetId }) => [
        { type: "Reviews", id: `${targetType}:${targetId}` },
        { type: "Reviews", id: `sum:${targetType}:${targetId}` },
      ],
    }),
    // Admin moderation
    adminListReviews: builder.query({
      query: ({ targetType, hidden, page = 1, limit = 30 } = {}) => ({
        url: `/api/reviews/admin/list`,
        params: { targetType, hidden, page, limit },
      }),
      providesTags: ["AdminReviews"],
    }),
    adminSetReviewHidden: builder.mutation({
      query: ({ id, hidden }) => ({
        url: `/api/reviews/admin/${id}/hidden`,
        method: "PATCH",
        body: { hidden },
      }),
      invalidatesTags: ["AdminReviews"],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetReviewsQuery,
  useGetReviewSummaryQuery,
  useUpsertReviewMutation,
  useDeleteMyReviewMutation,
  useAdminListReviewsQuery,
  useAdminSetReviewHiddenMutation,
} = reviewApiSlice;
