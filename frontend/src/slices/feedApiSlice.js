// src/slices/feedApiSlice.js — Bảng tin
import { apiSlice } from "./apiSlice";

const LIMIT = 20;

export const feedApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listFeed: builder.query({
      query: ({ cursor, tag, author, tournament, pinned, limit = LIMIT } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (tag) p.set("tag", String(tag).toLowerCase());
        if (author) p.set("author", String(author));
        if (tournament) p.set("tournament", String(tournament));
        if (pinned) p.set("pinned", "1");
        if (limit) p.set("limit", String(limit));
        const qs = p.toString();
        return { url: `/api/feed${qs ? `?${qs}` : ""}`, method: "GET" };
      },
      providesTags: [{ type: "Feed", id: "LIST" }],
    }),
    getFeedPost: builder.query({
      query: (id) => ({ url: `/api/feed/${id}`, method: "GET" }),
      providesTags: (r, e, id) => [{ type: "Feed", id }],
    }),
    createFeedPost: builder.mutation({
      query: (body) => ({ url: `/api/feed`, method: "POST", body }),
      invalidatesTags: [{ type: "Feed", id: "LIST" }],
    }),
    updateFeedPost: builder.mutation({
      query: ({ id, ...body }) => ({ url: `/api/feed/${id}`, method: "PATCH", body }),
      invalidatesTags: (r, e, { id }) => [
        { type: "Feed", id },
        { type: "Feed", id: "LIST" },
      ],
    }),
    deleteFeedPost: builder.mutation({
      query: (id) => ({ url: `/api/feed/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "Feed", id: "LIST" }],
    }),
    reactFeedPost: builder.mutation({
      query: ({ id, type }) => ({
        url: `/api/feed/${id}/reactions`,
        method: "POST",
        body: { type },
      }),
    }),
    reactFeedComment: builder.mutation({
      query: ({ cid, type }) => ({
        url: `/api/feed/comments/${cid}/reactions`,
        method: "POST",
        body: { type },
      }),
    }),
    listFeedComments: builder.query({
      query: ({ postId, parent = null, cursor, limit = 20 } = {}) => {
        const p = new URLSearchParams();
        if (parent) p.set("parent", String(parent));
        if (cursor) p.set("cursor", String(cursor));
        if (limit) p.set("limit", String(limit));
        const qs = p.toString();
        return {
          url: `/api/feed/${postId}/comments${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      providesTags: (r, e, { postId, parent }) => [
        { type: "FeedComments", id: `${postId}:${parent || "root"}` },
      ],
    }),
    createFeedComment: builder.mutation({
      query: ({ postId, content, parent }) => ({
        url: `/api/feed/${postId}/comments`,
        method: "POST",
        body: { content, parent },
      }),
      invalidatesTags: (r, e, { postId, parent }) => [
        { type: "FeedComments", id: `${postId}:${parent || "root"}` },
        { type: "Feed", id: postId },
      ],
    }),
    deleteFeedComment: builder.mutation({
      query: (cid) => ({ url: `/api/feed/comments/${cid}`, method: "DELETE" }),
      invalidatesTags: (r, e, cid, api) => {
        // Cannot know postId without cache args; invalidate LIST-level
        return [{ type: "FeedComments", id: "ALL" }];
      },
    }),
    reportFeedPost: builder.mutation({
      query: ({ id, reason, note }) => ({
        url: `/api/feed/${id}/reports`,
        method: "POST",
        body: { reason, note },
      }),
    }),
    reportFeedComment: builder.mutation({
      query: ({ cid, reason, note }) => ({
        url: `/api/feed/comments/${cid}/reports`,
        method: "POST",
        body: { reason, note },
      }),
    }),
    uploadFeedMedia: builder.mutation({
      query: (formData) => ({
        url: `/api/feed/upload/media`,
        method: "POST",
        body: formData,
      }),
    }),
    // Admin
    adminListFeedPosts: builder.query({
      query: ({ cursor, filter = "all", limit = 20 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (filter) p.set("filter", filter);
        if (limit) p.set("limit", String(limit));
        return {
          url: `/api/admin/feed/posts?${p.toString()}`,
          method: "GET",
        };
      },
      providesTags: [{ type: "AdminFeed", id: "LIST" }],
    }),
    adminPatchFeedPost: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/admin/feed/posts/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: [{ type: "AdminFeed", id: "LIST" }],
    }),
    adminDeleteFeedPost: builder.mutation({
      query: (id) => ({
        url: `/api/admin/feed/posts/${id}`,
        method: "DELETE",
      }),
      invalidatesTags: [{ type: "AdminFeed", id: "LIST" }],
    }),
    adminListFeedReports: builder.query({
      query: ({ cursor, status = "pending", limit = 20 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (status) p.set("status", status);
        if (limit) p.set("limit", String(limit));
        return {
          url: `/api/admin/feed/reports?${p.toString()}`,
          method: "GET",
        };
      },
      providesTags: [{ type: "AdminFeedReports", id: "LIST" }],
    }),
    adminResolveFeedReport: builder.mutation({
      query: ({ rid, action, note }) => ({
        url: `/api/admin/feed/reports/${rid}`,
        method: "PATCH",
        body: { action, note },
      }),
      invalidatesTags: [
        { type: "AdminFeedReports", id: "LIST" },
        { type: "AdminFeed", id: "LIST" },
      ],
    }),
  }),
});

export const {
  useListFeedQuery,
  useGetFeedPostQuery,
  useCreateFeedPostMutation,
  useUpdateFeedPostMutation,
  useDeleteFeedPostMutation,
  useReactFeedPostMutation,
  useReactFeedCommentMutation,
  useListFeedCommentsQuery,
  useCreateFeedCommentMutation,
  useDeleteFeedCommentMutation,
  useReportFeedPostMutation,
  useReportFeedCommentMutation,
  useUploadFeedMediaMutation,
  useAdminListFeedPostsQuery,
  useAdminPatchFeedPostMutation,
  useAdminDeleteFeedPostMutation,
  useAdminListFeedReportsQuery,
  useAdminResolveFeedReportMutation,
} = feedApiSlice;
