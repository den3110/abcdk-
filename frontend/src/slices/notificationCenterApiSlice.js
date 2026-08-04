// src/slices/notificationCenterApiSlice.js — Notification center (web)
import { apiSlice } from "./apiSlice";

export const notificationCenterApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listNotifs: builder.query({
      query: ({ cursor, unread, limit = 20 } = {}) => {
        const p = new URLSearchParams();
        if (cursor) p.set("cursor", String(cursor));
        if (unread) p.set("unread", "1");
        if (limit) p.set("limit", String(limit));
        const qs = p.toString();
        return { url: `/api/notifications${qs ? `?${qs}` : ""}`, method: "GET" };
      },
      providesTags: [{ type: "Notif", id: "LIST" }],
    }),
    notifUnreadCount: builder.query({
      query: () => ({ url: `/api/notifications/unread-count`, method: "GET" }),
      providesTags: [{ type: "NotifCount", id: "ME" }],
    }),
    markNotifRead: builder.mutation({
      query: (id) => ({
        url: `/api/notifications/${id}/read`,
        method: "POST",
      }),
      invalidatesTags: [
        { type: "Notif", id: "LIST" },
        { type: "NotifCount", id: "ME" },
      ],
    }),
    markAllNotifRead: builder.mutation({
      query: () => ({ url: `/api/notifications/read-all`, method: "POST" }),
      invalidatesTags: [
        { type: "Notif", id: "LIST" },
        { type: "NotifCount", id: "ME" },
      ],
    }),
    deleteNotif: builder.mutation({
      query: (id) => ({ url: `/api/notifications/${id}`, method: "DELETE" }),
      invalidatesTags: [
        { type: "Notif", id: "LIST" },
        { type: "NotifCount", id: "ME" },
      ],
    }),
  }),
});

export const {
  useListNotifsQuery,
  useNotifUnreadCountQuery,
  useMarkNotifReadMutation,
  useMarkAllNotifReadMutation,
  useDeleteNotifMutation,
} = notificationCenterApiSlice;
