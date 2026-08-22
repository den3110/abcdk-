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
      // Cache theo (tag, author, tournament, pinned, limit) — bỏ cursor
      serializeQueryArgs: ({ queryArgs }) => {
        const { cursor: _c, ...rest } = queryArgs || {};
        return rest;
      },
      merge: (currentCache, newResponse, { arg }) => {
        if (!arg?.cursor) return newResponse;
        const existingIds = new Set(
          (currentCache?.items || []).map((i) => String(i._id))
        );
        const appended = (newResponse?.items || []).filter(
          (i) => !existingIds.has(String(i._id))
        );
        return {
          ...newResponse,
          items: [...(currentCache?.items || []), ...appended],
        };
      },
      forceRefetch({ currentArg, previousArg }) {
        return currentArg?.cursor !== previousArg?.cursor;
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
      invalidatesTags: (r, e, { id }) => [
        { type: "Feed", id: "LIST" },
        { type: "Feed", id },
      ],
      async onQueryStarted({ id, type }, { dispatch, queryFulfilled, getState }) {
        const patches = [];
        for (const { endpointName, originalArgs } of feedApiSlice.util.selectInvalidatedBy(
          getState(),
          [{ type: "Feed", id: "LIST" }]
        )) {
          if (endpointName !== "listFeed") continue;
          patches.push(
            dispatch(
              feedApiSlice.util.updateQueryData("listFeed", originalArgs, (draft) => {
                const item = (draft?.items || []).find(
                  (p) => String(p._id) === String(id)
                );
                if (!item) return;
                const prev = item.myReaction;
                if (prev === type) {
                  item.myReaction = null;
                  item.reactionCount = Math.max(0, (item.reactionCount || 0) - 1);
                } else {
                  item.myReaction = type;
                  if (!prev) item.reactionCount = (item.reactionCount || 0) + 1;
                }
              })
            )
          );
        }
        patches.push(
          dispatch(
            feedApiSlice.util.updateQueryData("getFeedPost", id, (draft) => {
              if (!draft) return;
              const prev = draft.myReaction;
              if (prev === type) {
                draft.myReaction = null;
                draft.reactionCount = Math.max(0, (draft.reactionCount || 0) - 1);
              } else {
                draft.myReaction = type;
                if (!prev) draft.reactionCount = (draft.reactionCount || 0) + 1;
              }
            })
          )
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
    }),
    saveFeedPost: builder.mutation({
      query: ({ id, save = true }) => ({
        url: `/api/feed/${id}/save`,
        method: "POST",
        body: { save },
      }),
    }),
    listSavedFeed: builder.query({
      query: (arg = {}) => {
        const p = new URLSearchParams();
        if (arg.cursor) p.set("cursor", arg.cursor);
        if (arg.limit) p.set("limit", String(arg.limit));
        const qs = p.toString();
        return { url: `/api/feed/saved${qs ? `?${qs}` : ""}`, method: "GET" };
      },
      providesTags: [{ type: "Feed", id: "SAVED" }],
    }),
    voteFeedPoll: builder.mutation({
      query: ({ id, optionIds }) => ({
        url: `/api/feed/${id}/vote`,
        method: "POST",
        body: { optionIds },
      }),
    }),
    shareFeedPost: builder.mutation({
      query: (id) => ({ url: `/api/feed/${id}/share`, method: "POST" }),
      async onQueryStarted(id, { dispatch, queryFulfilled, getState }) {
        const patches = [];
        for (const { endpointName, originalArgs } of feedApiSlice.util.selectInvalidatedBy(
          getState(),
          [{ type: "Feed", id: "LIST" }]
        )) {
          if (endpointName !== "listFeed") continue;
          patches.push(
            dispatch(
              feedApiSlice.util.updateQueryData("listFeed", originalArgs, (draft) => {
                const item = (draft?.items || []).find(
                  (p) => String(p._id) === String(id)
                );
                if (item) item.shareCount = (item.shareCount || 0) + 1;
              })
            )
          );
        }
        patches.push(
          dispatch(
            feedApiSlice.util.updateQueryData("getFeedPost", id, (draft) => {
              if (draft) draft.shareCount = (draft.shareCount || 0) + 1;
            })
          )
        );
        try {
          await queryFulfilled;
        } catch {
          patches.forEach((p) => p.undo());
        }
      },
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
      query: ({ postId, content, parent, media }) => ({
        url: `/api/feed/${postId}/comments`,
        method: "POST",
        body: { content, parent, media },
      }),
      invalidatesTags: (r, e, { postId, parent }) => [
        { type: "FeedComments", id: `${postId}:${parent || "root"}` },
        { type: "Feed", id: postId },
      ],
    }),
    listPostReactors: builder.query({
      query: ({ postId, type }) => {
        const p = new URLSearchParams();
        if (type) p.set("type", String(type));
        const qs = p.toString();
        return {
          url: `/api/feed/${postId}/reactions${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
    }),
    listCommentReactors: builder.query({
      query: ({ cid, type }) => {
        const p = new URLSearchParams();
        if (type) p.set("type", String(type));
        const qs = p.toString();
        return {
          url: `/api/feed/comments/${cid}/reactions${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
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
  useShareFeedPostMutation,
  useSaveFeedPostMutation,
  useListSavedFeedQuery,
  useVoteFeedPollMutation,
  useReactFeedCommentMutation,
  useListFeedCommentsQuery,
  useCreateFeedCommentMutation,
  useDeleteFeedCommentMutation,
  useReportFeedPostMutation,
  useReportFeedCommentMutation,
  useUploadFeedMediaMutation,
  useListPostReactorsQuery,
  useLazyListPostReactorsQuery,
  useListCommentReactorsQuery,
  useLazyListCommentReactorsQuery,
  useAdminListFeedPostsQuery,
  useAdminPatchFeedPostMutation,
  useAdminDeleteFeedPostMutation,
  useAdminListFeedReportsQuery,
  useAdminResolveFeedReportMutation,
} = feedApiSlice;
