// src/slices/messagesApiSlice.js — Nhắn tin (web)
import { apiSlice } from "./apiSlice";

export const messagesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listConversations: builder.query({
      query: ({ cursor, limit = 30 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (limit) p.set("limit", String(limit));
        const qs = p.toString();
        return {
          url: `/api/chat/conversations${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      providesTags: [{ type: "Chat", id: "LIST" }],
    }),
    openDm: builder.mutation({
      query: (peerUserId) => ({
        url: `/api/chat/conversations/dm`,
        method: "POST",
        body: { peerUserId },
      }),
      invalidatesTags: [{ type: "Chat", id: "LIST" }],
    }),
    openTournamentChat: builder.mutation({
      query: (tid) => ({
        url: `/api/chat/conversations/tournament/${tid}`,
        method: "POST",
      }),
      invalidatesTags: [{ type: "Chat", id: "LIST" }],
    }),
    getConversation: builder.query({
      query: (cid) => ({ url: `/api/chat/conversations/${cid}`, method: "GET" }),
      providesTags: (r, e, cid) => [{ type: "Chat", id: cid }],
    }),
    listMessages: builder.query({
      query: ({ cid, cursor, limit = 50 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (limit) p.set("limit", String(limit));
        const qs = p.toString();
        return {
          url: `/api/chat/conversations/${cid}/messages${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      providesTags: (r, e, { cid }) => [{ type: "ChatMessages", id: cid }],
    }),
    sendMessage: builder.mutation({
      query: ({ cid, content, attachments, replyTo, mentions, linkedTournament }) => ({
        url: `/api/chat/conversations/${cid}/messages`,
        method: "POST",
        body: { content, attachments, replyTo, mentions, linkedTournament },
      }),
      invalidatesTags: (r, e, { cid }) => [
        { type: "ChatMessages", id: cid },
        { type: "Chat", id: "LIST" },
      ],
    }),
    markRead: builder.mutation({
      query: (cid) => ({
        url: `/api/chat/conversations/${cid}/read`,
        method: "POST",
      }),
      invalidatesTags: [{ type: "Chat", id: "LIST" }],
    }),
    deleteMessage: builder.mutation({
      query: (mid) => ({ url: `/api/chat/messages/${mid}`, method: "DELETE" }),
    }),
    uploadChatMedia: builder.mutation({
      query: (formData) => ({
        url: `/api/chat/upload`,
        method: "POST",
        body: formData,
      }),
    }),
    // Admin
    adminListConversations: builder.query({
      query: ({ cursor, type, limit = 30 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (type) p.set("type", type);
        if (limit) p.set("limit", String(limit));
        return {
          url: `/api/admin/chat/conversations?${p.toString()}`,
          method: "GET",
        };
      },
      providesTags: [{ type: "AdminChat", id: "LIST" }],
    }),
    adminListMessages: builder.query({
      query: ({ cid, cursor, limit = 50 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (limit) p.set("limit", String(limit));
        return {
          url: `/api/admin/chat/conversations/${cid}/messages?${p.toString()}`,
          method: "GET",
        };
      },
    }),
    adminPatchConversation: builder.mutation({
      query: ({ cid, ...body }) => ({
        url: `/api/admin/chat/conversations/${cid}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: [{ type: "AdminChat", id: "LIST" }],
    }),
    adminDeleteMessage: builder.mutation({
      query: (mid) => ({
        url: `/api/admin/chat/messages/${mid}`,
        method: "DELETE",
      }),
    }),
  }),
});

export const {
  useListConversationsQuery,
  useOpenDmMutation,
  useOpenTournamentChatMutation,
  useGetConversationQuery,
  useListMessagesQuery,
  useSendMessageMutation,
  useMarkReadMutation,
  useDeleteMessageMutation,
  useUploadChatMediaMutation,
  useAdminListConversationsQuery,
  useAdminListMessagesQuery,
  useAdminPatchConversationMutation,
  useAdminDeleteMessageMutation,
} = messagesApiSlice;
