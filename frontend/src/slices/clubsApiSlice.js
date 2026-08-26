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

    banMember: builder.mutation({
      query: ({ id, userId }) => ({
        url: `/api/clubs/${id}/members/${userId}/ban`,
        method: "POST",
      }),
      invalidatesTags: (res, err, { id }) => [
        { type: "ClubMember", id },
        { type: "Club", id },
      ],
    }),
    unbanMember: builder.mutation({
      query: ({ id, userId }) => ({
        url: `/api/clubs/${id}/members/${userId}/unban`,
        method: "POST",
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
      providesTags: (res, err, { id }) => [{ type: "ClubEvent", id }],
    }),
    createEvent: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/events`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubEvent", id }],
    }),
    updateEvent: builder.mutation({
      query: ({ id, eventId, ...body }) => ({
        url: `/api/clubs/${id}/events/${eventId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubEvent", id }],
    }),
    deleteEvent: builder.mutation({
      query: ({ id, eventId }) => ({
        url: `/api/clubs/${id}/events/${eventId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubEvent", id }],
    }),
    rsvpEvent: builder.mutation({
      query: ({ id, eventId, status }) => ({
        url: `/api/clubs/${id}/events/${eventId}/rsvp`,
        method: "POST",
        body: { status }, // "going" | "not_going" | "none"
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubEvent", id }],
    }),
    listEventAttendees: builder.query({
      query: ({ id, eventId }) => ({
        url: `/api/clubs/${id}/events/${eventId}/attendees`,
      }),
      providesTags: (res, err, { id }) => [{ type: "ClubEvent", id }],
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
      providesTags: (res, err, { id }) => [{ type: "ClubAnnouncement", id }],
    }),
    createAnnouncement: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/announcements`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubAnnouncement", id }],
    }),
    updateAnnouncement: builder.mutation({
      query: ({ id, postId, ...body }) => ({
        url: `/api/clubs/${id}/announcements/${postId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubAnnouncement", id }],
    }),
    deleteAnnouncement: builder.mutation({
      query: ({ id, postId }) => ({
        url: `/api/clubs/${id}/announcements/${postId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubAnnouncement", id }],
    }),

    // POLLS
    listPolls: builder.query({
      query: ({ id, page = 1, limit = 10 }) => ({
        url: `/api/clubs/${id}/polls?page=${page}&limit=${limit}`,
      }),
      providesTags: (res, err, { id }) => [{ type: "ClubPoll", id }],
    }),
    createPoll: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/polls`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPoll", id }],
    }),
    votePoll: builder.mutation({
      query: ({ id, pollId, optionIds }) => ({
        url: `/api/clubs/${id}/polls/${pollId}/vote`,
        method: "POST",
        body: { optionIds },
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPoll", id }],
    }),
    closePoll: builder.mutation({
      query: ({ id, pollId }) => ({
        url: `/api/clubs/${id}/polls/${pollId}/close`,
        method: "POST",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPoll", id }],
    }),
    deletePoll: builder.mutation({
      query: ({ id, pollId }) => ({
        url: `/api/clubs/${id}/polls/${pollId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPoll", id }],
    }),

    // DISCUSSION (tường thảo luận)
    listPosts: builder.query({
      query: ({ id, page = 1, limit = 20 }) => ({
        url: `/api/clubs/${id}/posts?page=${page}&limit=${limit}`,
      }),
      providesTags: (res, err, { id }) => [{ type: "ClubPost", id }],
    }),
    createPost: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/posts`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPost", id }],
    }),
    updatePost: builder.mutation({
      query: ({ id, postId, ...body }) => ({
        url: `/api/clubs/${id}/posts/${postId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPost", id }],
    }),
    deletePost: builder.mutation({
      query: ({ id, postId }) => ({
        url: `/api/clubs/${id}/posts/${postId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPost", id }],
    }),
    reactPost: builder.mutation({
      query: ({ id, postId }) => ({
        url: `/api/clubs/${id}/posts/${postId}/react`,
        method: "POST",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPost", id }],
    }),
    listPostComments: builder.query({
      query: ({ id, postId, page = 1, limit = 50 }) => ({
        url: `/api/clubs/${id}/posts/${postId}/comments?page=${page}&limit=${limit}`,
      }),
      providesTags: (res, err, { postId }) => [
        { type: "ClubPostComment", id: postId },
      ],
    }),
    createPostComment: builder.mutation({
      query: ({ id, postId, content }) => ({
        url: `/api/clubs/${id}/posts/${postId}/comments`,
        method: "POST",
        body: { content },
      }),
      invalidatesTags: (res, err, { id, postId }) => [
        { type: "ClubPostComment", id: postId },
        { type: "ClubPost", id },
      ],
    }),
    deletePostComment: builder.mutation({
      query: ({ id, postId, commentId }) => ({
        url: `/api/clubs/${id}/posts/${postId}/comments/${commentId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id, postId }) => [
        { type: "ClubPostComment", id: postId },
        { type: "ClubPost", id },
      ],
    }),

    // GALLERY (thư viện ảnh)
    listPhotos: builder.query({
      query: ({ id, page = 1, limit = 40 }) => ({
        url: `/api/clubs/${id}/photos?page=${page}&limit=${limit}`,
      }),
      providesTags: (res, err, { id }) => [{ type: "ClubPhoto", id }],
    }),
    addPhotos: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/photos`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPhoto", id }],
    }),
    deletePhoto: builder.mutation({
      query: ({ id, photoId }) => ({
        url: `/api/clubs/${id}/photos/${photoId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubPhoto", id }],
    }),

    // FINANCE (quỹ thu/chi)
    listTransactions: builder.query({
      query: ({ id, page = 1, limit = 30, type, category, from, to, member }) => {
        const p = new URLSearchParams({ page, limit });
        if (type) p.set("type", type);
        if (category) p.set("category", category);
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        if (member) p.set("member", member);
        return { url: `/api/clubs/${id}/finance/transactions?${p.toString()}` };
      },
      providesTags: (res, err, { id }) => [{ type: "ClubFinance", id }],
    }),
    financeSummary: builder.query({
      query: ({ id, from, to }) => {
        const p = new URLSearchParams();
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        const qs = p.toString();
        return { url: `/api/clubs/${id}/finance/summary${qs ? `?${qs}` : ""}` };
      },
      providesTags: (res, err, { id }) => [{ type: "ClubFinance", id }],
    }),
    createTransaction: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/finance/transactions`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubFinance", id }],
    }),
    updateTransaction: builder.mutation({
      query: ({ id, txId, ...body }) => ({
        url: `/api/clubs/${id}/finance/transactions/${txId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubFinance", id }],
    }),
    deleteTransaction: builder.mutation({
      query: ({ id, txId }) => ({
        url: `/api/clubs/${id}/finance/transactions/${txId}`,
        method: "DELETE",
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubFinance", id }],
    }),
    exportFinanceCsv: builder.query({
      query: ({ id, type, from, to }) => {
        const p = new URLSearchParams();
        if (type) p.set("type", type);
        if (from) p.set("from", from);
        if (to) p.set("to", to);
        const qs = p.toString();
        return {
          url: `/api/clubs/${id}/finance/export.csv${qs ? `?${qs}` : ""}`,
          responseHandler: (r) => r.blob(),
        };
      },
    }),

    // DUES (phí hội viên)
    getDuesConfig: builder.query({
      query: ({ id }) => ({ url: `/api/clubs/${id}/dues/config` }),
      providesTags: (res, err, { id }) => [{ type: "ClubDues", id }],
    }),
    setDuesConfig: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/dues/config`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [{ type: "ClubDues", id }],
    }),
    getDuesPeriod: builder.query({
      query: ({ id, key }) => ({ url: `/api/clubs/${id}/dues/period?key=${encodeURIComponent(key)}` }),
      providesTags: (res, err, { id }) => [{ type: "ClubDues", id }],
    }),
    getMyDues: builder.query({
      query: ({ id }) => ({ url: `/api/clubs/${id}/dues/my` }),
      providesTags: (res, err, { id }) => [{ type: "ClubDues", id }],
    }),
    payDues: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/dues/pay`,
        method: "POST",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [
        { type: "ClubDues", id },
        { type: "ClubFinance", id },
      ],
    }),
    unpayDues: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/clubs/${id}/dues/pay`,
        method: "DELETE",
        body,
      }),
      invalidatesTags: (res, err, { id }) => [
        { type: "ClubDues", id },
        { type: "ClubFinance", id },
      ],
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
  useBanMemberMutation,
  useUnbanMemberMutation,
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
  useListEventAttendeesQuery,
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
  useDeletePollMutation,

  // discussion
  useListPostsQuery,
  useCreatePostMutation,
  useUpdatePostMutation,
  useDeletePostMutation,
  useReactPostMutation,
  useListPostCommentsQuery,
  useCreatePostCommentMutation,
  useDeletePostCommentMutation,

  // gallery
  useListPhotosQuery,
  useAddPhotosMutation,
  useDeletePhotoMutation,

  // finance
  useListTransactionsQuery,
  useFinanceSummaryQuery,
  useCreateTransactionMutation,
  useUpdateTransactionMutation,
  useDeleteTransactionMutation,
  useLazyExportFinanceCsvQuery,

  // dues
  useGetDuesConfigQuery,
  useSetDuesConfigMutation,
  useGetDuesPeriodQuery,
  useGetMyDuesQuery,
  usePayDuesMutation,
  useUnpayDuesMutation,
} = clubsApiSlice;
