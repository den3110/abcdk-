// src/slices/friendsApiSlice.js — Kết bạn (web)
import { apiSlice } from "./apiSlice";

export const friendsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listFriends: builder.query({
      query: ({ cursor } = {}) => ({
        url: `/api/friends${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        method: "GET",
      }),
      providesTags: [{ type: "Friend", id: "LIST" }],
    }),
    listFriendRequests: builder.query({
      query: (direction = "incoming") => ({
        url: `/api/friends/requests?direction=${direction}`,
        method: "GET",
      }),
      providesTags: [{ type: "FriendRequests", id: "LIST" }],
    }),
    friendCounts: builder.query({
      query: () => ({ url: `/api/friends/counts`, method: "GET" }),
      providesTags: [{ type: "FriendCounts", id: "ME" }],
    }),
    friendStatus: builder.query({
      query: (userId) => ({
        url: `/api/friends/status/${userId}`,
        method: "GET",
      }),
      // Cung cấp CẢ tag riêng theo userId lẫn tag LIST — để mọi mutation
      // invalidate "Friend:LIST" đều làm status refetch.
      providesTags: (r, e, userId) => [
        { type: "Friend", id: userId },
        { type: "Friend", id: "LIST" },
      ],
    }),
    sendFriendRequest: builder.mutation({
      query: (userId) => ({
        url: `/api/friends/request`,
        method: "POST",
        body: { userId },
      }),
      invalidatesTags: (r, e, userId) => [
        { type: "Friend", id: userId },
        { type: "FriendRequests", id: "LIST" },
        { type: "FriendCounts", id: "ME" },
      ],
    }),
    acceptFriend: builder.mutation({
      query: (edgeId) => ({
        url: `/api/friends/${edgeId}/accept`,
        method: "POST",
      }),
      invalidatesTags: [
        { type: "Friend", id: "LIST" },
        { type: "FriendRequests", id: "LIST" },
        { type: "FriendCounts", id: "ME" },
      ],
    }),
    declineFriend: builder.mutation({
      query: (edgeId) => ({
        url: `/api/friends/${edgeId}/decline`,
        method: "POST",
      }),
      invalidatesTags: [
        { type: "Friend", id: "LIST" },
        { type: "FriendRequests", id: "LIST" },
        { type: "FriendCounts", id: "ME" },
      ],
    }),
    removeFriend: builder.mutation({
      query: (edgeId) => ({
        url: `/api/friends/edge/${edgeId}`,
        method: "DELETE",
      }),
      invalidatesTags: [
        { type: "Friend", id: "LIST" },
        { type: "FriendRequests", id: "LIST" },
        { type: "FriendCounts", id: "ME" },
      ],
    }),
  }),
});

export const {
  useListFriendsQuery,
  useListFriendRequestsQuery,
  useFriendCountsQuery,
  useFriendStatusQuery,
  useSendFriendRequestMutation,
  useAcceptFriendMutation,
  useDeclineFriendMutation,
  useRemoveFriendMutation,
} = friendsApiSlice;
