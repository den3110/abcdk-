// src/slices/clubsApiSlice.js
import { apiSlice } from "./apiSlice";

export const clubsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listClubs: builder.query({
      query: (params = {}) => ({
        url: "/api/clubs",
        params,
      }),
      providesTags: (res) =>
        res?.items
          ? [
              ...res.items.map((c) => ({ type: "Club", id: c._id })),
              { type: "Club", id: "LIST" },
            ]
          : [{ type: "Club", id: "LIST" }],
    }),

    getClub: builder.query({
      query: (id) => `/api/clubs/${id}`,
      providesTags: (res, err, id) => [{ type: "Club", id }],
    }),

    createClub: builder.mutation({
      query: (body) => ({ url: "/api/clubs", method: "POST", body }),
      invalidatesTags: [{ type: "Club", id: "LIST" }],
    }),

    updateClub: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "Club", id }],
    }),

    listMembers: builder.query({
      query: ({ id, params = {} }) => ({
        url: `/api/clubs/${id}/members`,
        params,
      }),
      providesTags: (res, err, { id }) => [{ type: "ClubMember", id }],
    }),

    addMember: builder.mutation({
      query: ({ id, userId, nickname, role = "member" }) => ({
        url: `/api/clubs/${id}/members`,
        method: "POST",
        body: userId ? { userId, role } : { nickname, role }, // 👈 hỗ trợ nickname
      }),
    }),

    setRole: builder.mutation({
      query: ({ id, userId, role }) => ({
        url: `/api/clubs/${id}/members/${userId}/role`,
        method: "PATCH",
        body: { role },
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubMember", id }],
    }),

    kickMember: builder.mutation({
      query: ({ id, userId }) => ({
        url: `/api/clubs/${id}/members/${userId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [
        { type: "ClubMember", id },
        { type: "Club", id },
      ],
    }),

    leaveClub: builder.mutation({
      query: ({ id }) => ({
        url: `/api/clubs/${id}/members/me`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [
        { type: "ClubMember", id },
        { type: "Club", id },
      ],
    }),

    // Join flow
    requestJoin: builder.mutation({
      query: ({ id, message }) => ({
        url: `/api/clubs/${id}/join`,
        method: "POST",
        body: { message },
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "Club", id }],
    }),

    cancelJoin: builder.mutation({
      query: ({ id }) => ({ url: `/api/clubs/${id}/join`, method: "DELETE" }),
      invalidatesTags: (res, err, { id }) => [{ type: "Club", id }],
    }),

    listJoinRequests: builder.query({
      query: ({ id, params = {} }) => ({
        url: `/api/clubs/${id}/join-requests`,
        params,
      }),
      providesTags: (res, err, { id }) => [{ type: "JoinRequest", id }],
    }),

    acceptJoin: builder.mutation({
      query: ({ id, reqId }) => ({
        url: `/api/clubs/${id}/join-requests/${reqId}/accept`,
        method: "POST",
      }),
      invalidatesTags: (res, err, { id }) => [
        { type: "JoinRequest", id },
        { type: "ClubMember", id },
        { type: "Club", id },
      ],
    }),

    rejectJoin: builder.mutation({
      query: ({ id, reqId }) => ({
        url: `/api/clubs/${id}/join-requests/${reqId}/reject`,
        method: "POST",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "JoinRequest", id }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useListClubsQuery,
  useGetClubQuery,
  useCreateClubMutation,
  useUpdateClubMutation,
  useListMembersQuery,
  useAddMemberMutation,
  useSetRoleMutation,
  useKickMemberMutation,
  useLeaveClubMutation,
  useRequestJoinMutation,
  useCancelJoinMutation,
  useListJoinRequestsQuery,
  useAcceptJoinMutation,
  useRejectJoinMutation,
} = clubsApiSlice;
