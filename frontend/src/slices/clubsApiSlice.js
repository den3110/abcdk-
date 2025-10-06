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
    // EVENTS
    listEvents: builder.query({
      query: ({ id, page = 1, limit = 20, from, to }) => {
        const p = new URLSearchParams({ page, limit });
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        return { url: `/api/clubs/${id}/events?${p.toString()}` };
      },
    }),
    createEvent: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/events`,
        method: "POST",
        body,
      }),
    }),
    updateEvent: builder.mutation({
      query: ({ id, eventId, ...body }) => ({
        url: `/api/clubs/${id}/events/${eventId}`,
        method: "PATCH",
        body,
      }),
    }),
    deleteEvent: builder.mutation({
      query: ({ id, eventId }) => ({
        url: `/api/clubs/${id}/events/${eventId}`,
        method: "DELETE",
      }),
    }),
    rsvpEvent: builder.mutation({
      query: ({ id, eventId, status }) => ({
        url: `/api/clubs/${id}/events/${eventId}/rsvp`,
        method: "POST",
        body: { status }, // "going" | "not_going" | "none"
      }),
    }),
    // .ics chỉ cần dùng <a href>, không cần mutation. Nhưng nếu muốn tải blob:
    downloadEventIcs: builder.query({
      query: ({ id, eventId }) => ({
        url: `/api/clubs/${id}/events/${eventId}/ics`,
        responseHandler: (res) => res.blob(),
      }),
    }),

    // ANNOUNCEMENTS
    listAnnouncements: builder.query({
      query: ({ id, page = 1, limit = 10 }) => ({
        url: `/api/clubs/${id}/announcements?page=${page}&limit=${limit}`,
      }),
    }),
    createAnnouncement: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/announcements`,
        method: "POST",
        body,
      }),
    }),
    updateAnnouncement: builder.mutation({
      query: ({ id, postId, ...body }) => ({
        url: `/api/clubs/${id}/announcements/${postId}`,
        method: "PATCH",
        body,
      }),
    }),
    deleteAnnouncement: builder.mutation({
      query: ({ id, postId }) => ({
        url: `/api/clubs/${id}/announcements/${postId}`,
        method: "DELETE",
      }),
    }),

    // POLLS
    listPolls: builder.query({
      query: ({ id, page = 1, limit = 10 }) => ({
        url: `/api/clubs/${id}/polls?page=${page}&limit=${limit}`,
      }),
    }),
    createPoll: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/polls`,
        method: "POST",
        body,
      }),
    }),
    votePoll: builder.mutation({
      query: ({ id, pollId, optionIds }) => ({
        url: `/api/clubs/${id}/polls/${pollId}/vote`,
        method: "POST",
        body: { optionIds },
      }),
    }),
    closePoll: builder.mutation({
      query: ({ id, pollId }) => ({
        url: `/api/clubs/${id}/polls/${pollId}/close`,
        method: "POST",
      }),
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
  // events
  useListEventsQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useRsvpEventMutation,
  useDownloadEventIcsQuery,

  // announcements
  useListAnnouncementsQuery,
  useCreateAnnouncementMutation,
  useUpdateAnnouncementMutation,
  useDeleteAnnouncementMutation,

  // polls
  useListPollsQuery,
  useCreatePollMutation,
  useVotePollMutation,
  useClosePollMutation,
} = clubsApiSlice;
