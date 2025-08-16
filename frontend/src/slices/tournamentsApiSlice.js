import { apiSlice } from "./apiSlice";

export const tournamentsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTournaments: builder.query({
      query: ({ sportType, groupId }) =>
        `/api/tournaments?sportType=${sportType}&groupId=${groupId}`,
      providesTags: ["Tournaments"],
    }),
    /* ---------------------------------- REG LIST ---------------------------------- */
    getRegistrations: builder.query({
      query: (tourId) => `/api/tournaments/${tourId}/registrations`,
      providesTags: (r, e, id) => [{ type: "Registrations", id }],
    }),

    /* ---------------------------- CREATE REGISTRATION ----------------------------- */
    createRegistration: builder.mutation({
      query: ({ tourId, ...payload }) => ({
        url: `/api/tournaments/${tourId}/registrations`,
        method: "POST",
        body: payload,
        headers: {
          "Content-Type": "application/json",
        },
      }),
      invalidatesTags: (result, error, { tourId }) => [
        { type: "Registrations", id: tourId },
        { type: "Tournaments", id: tourId },
      ],
    }),
    /* --------------------------- UPDATE PAYMENT STATUS --------------------------- */
    updatePayment: builder.mutation({
      query: ({ regId, status }) => ({
        url: `/api/registrations/${regId}/payment`,
        method: "PATCH",
        body: { status },
      }),
      invalidatesTags: (r, e, arg) => [
        { type: "Registrations", id: arg.regId },
      ],
    }),

    /* ----------------------------- CHECK‑IN REGISTRATION ----------------------------- */
    checkin: builder.mutation({
      query: ({ regId }) => ({
        url: `/api/registrations/${regId}/checkin`,
        method: "PATCH",
      }),
      invalidatesTags: (r, e, arg) => [
        { type: "Registrations", id: arg.regId },
      ],
    }),
    getTournament: builder.query({
      query: (id) => `/api/tournaments/${id}`,
      providesTags: (r, e, id) => [{ type: "Tournaments", id }],
    }),
    // ✨ LẤY DANH SÁCH TRẬN ĐẤU (bracket + check‑in page)
    getMatches: builder.query({
      query: (tourId) => `/api/tournaments/${tourId}/matches`,
      providesTags: (r, e, id) => [{ type: "Matches", id }],
    }),
    getTournamentMatchesForCheckin: builder.query({
      query: (tournamentId) =>
        `/api/tournaments/${tournamentId}/checkin-matches`,
    }),
    searchUserMatches: builder.query({
      query: ({ tournamentId, q }) => ({
        url: `/api/tournaments/checkin/search`,
        params: { tournamentId, q },
      }),
    }),
    userCheckinRegistration: builder.mutation({
      query: (body) => ({
        url: `/api/tournaments/checkin`,
        method: "POST",
        body, // { tournamentId, q, regId }
      }),
    }),
    // GET /api/tournaments/:id/brackets  (user route)
    listTournamentBrackets: builder.query({
      query: (tournamentId) => ({
        url: `/api/tournaments/${tournamentId}/brackets`,
        method: "GET",
      }),
      transformResponse: (res) => {
        if (Array.isArray(res)) return res;
        if (res?.list && Array.isArray(res.list)) return res.list;
        return [];
      },
      // tránh cache đè giữa các giải
      serializeQueryArgs: ({ endpointName, queryArgs }) =>
        `${endpointName}:${queryArgs}`,
    }),

    // GET /api/tournaments/:id/matches  (user route)
    // Bạn có thể hỗ trợ ?stage=&type=&page=&limit=&sort= ở BE nếu muốn
    listTournamentMatches: builder.query({
      query: ({ tournamentId, ...params }) => ({
        url: `/api/tournaments/${tournamentId}/matches`,
        method: "GET",
        params,
      }),
      transformResponse: (res) => {
        if (Array.isArray(res)) return res; // mảng thuần
        if (res?.list && Array.isArray(res.list)) return res.list; // phân trang
        return [];
      },
      
      keepUnusedDataFor: 0
    }),
    getMatchPublic: builder.query({
      query: (matchId) => `/api/tournaments/matches/${matchId}`, // GET /api/matches/:id
      providesTags: (res, err, id) => [{ type: "Match", id }],

    }),
    cancelRegistration: builder.mutation({
      query: (regId) => ({
        url: `/api/registrations/${regId}/cancel`,
        method: "POST",
      }),
      invalidatesTags: () => [{ type: "Registrations", id: "LIST" }],
    }),
    //
    // NEW: tạo lời mời đăng ký
    createRegInvite: builder.mutation({
      query: ({ tourId, message, player1Id, player2Id }) => ({
        url: `/api/tournaments/${tourId}/registration-invites`,
        method: "POST",
        body: { message, player1Id, player2Id },
      }),
      invalidatesTags: (res) =>
        res?.invite?.status === "finalized" ? ["Registrations"] : [],
    }),

    // NEW: list lời mời mình còn pending (theo từng giải)
    listMyRegInvites: builder.query({
      query: () => `/api/tournaments/get/registration-invites`,
      providesTags: ["RegInvites"],
    }),

    // NEW: phản hồi lời mời
    respondRegInvite: builder.mutation({
      query: ({ inviteId, action }) => ({
        url: `/api/tournaments/registration-invites/${inviteId}/respond`,
        method: "POST",
        body: { action },
      }),
      invalidatesTags: ["RegInvites"],
    }),
    // ✅ Manager toggle trạng thái thanh toán
    managerSetRegPaymentStatus: builder.mutation({
      query: ({ regId, status }) => ({
        url: `/api/registrations/${regId}/payment`,
        method: "PATCH",
        body: { status }, // "Paid" | "Unpaid"
      }),
      // tùy hệ thống tags của bạn, có thể là ["Registrations"] hoặc ["Registration"]
      invalidatesTags: ["Registrations"],
    }),

    // ✅ Manager huỷ (xoá) đăng ký
    managerDeleteRegistration: builder.mutation({
      query: (regId) => ({
        url: `/api/registrations/${regId}/admin`,
        method: "DELETE",
      }),
      invalidatesTags: ["Registrations"],
    }),
    getOverlaySnapshot: builder.query({
      // dùng API snapshot mình đã gợi ý ở BE: GET /api/overlay/match/:id
      // nếu bạn chưa có route này thì tạm thay bằng /api/matches/:id cũng được
      query: (matchId) => `/api/overlay/match/${matchId}`,
      providesTags: (res, err, id) => [{ type: "Match", id }],
    }),
    // ✅ DRAW API (ADD)
    getDrawStatus: builder.query({
      query: (bracketId) => ({
        url: `/api/draw/brackets/${bracketId}/draw/status`,
        method: "GET",
      }),
      serializeQueryArgs: ({ endpointName, queryArgs }) =>
        `${endpointName}:${String(queryArgs || "")}`,
      providesTags: (_res, _err, bracketId) => [
        { type: "Draw", id: bracketId },
      ],
    }),

    initDraw: builder.mutation({
      query: ({ bracketId, mode, config }) => ({
        url: `/api/brackets/${bracketId}/draw/init`,
        method: "POST",
        body: { mode, config },
      }),
      invalidatesTags: (_res, _err, { bracketId }) => [
        { type: "Draw", id: bracketId },
      ],
    }),

    revealDraw: builder.mutation({
      query: (bracketId) => ({
        url: `/api/brackets/${bracketId}/draw/reveal`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, bracketId) => [
        { type: "Draw", id: bracketId },
      ],
    }),

    undoDraw: builder.mutation({
      query: (bracketId) => ({
        url: `/api/brackets/${bracketId}/draw/undo`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, bracketId) => [
        { type: "Draw", id: bracketId },
      ],
    }),

    finalizeKo: builder.mutation({
      query: (bracketId) => ({
        url: `/api/brackets/${bracketId}/draw/finalize-ko`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, bracketId) => [
        { type: "Draw", id: bracketId },
      ],
    }),
    startDraw: builder.mutation({
      // body: { mode: "group" } | { mode: "knockout", round: "R16"|... }
      query: ({ bracketId, body }) => ({
        url: `/api/draw/${bracketId}/start`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: "Draw", id: arg.bracketId },
      ],
    }),

    drawNext: builder.mutation({
      // body optional
      query: ({ drawId, body }) => ({
        url: `/api/draw/${drawId}/next`,
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: "Draw", id: arg.drawId }],
    }),

    drawCommit: builder.mutation({
      query: ({ drawId }) => ({
        url: `/api/draw/${drawId}/commit`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: "Draw", id: arg.drawId }],
    }),
    cancelDraw: builder.mutation({
      query: (bracketId) => ({
        url: `/api/brackets/${bracketId}/draw/cancel`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, bracketId) => [
        { type: "Draw", id: bracketId },
      ],
    }),

    drawCancel: builder.mutation({
      query: ({ drawId }) => ({
        url: `/api/draw/${drawId}/cancel`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, arg) => [{ type: "Draw", id: arg.drawId }],
    }),
    getBracket: builder.query({
      query: (bracketId) => `/api/brackets/${bracketId}`,
    }),

    generateGroupMatches: builder.mutation({
      query: ({ bracketId, mode, matches, rules }) => ({
        url: `/api/draw/brackets/${bracketId}/group/generate-matches`,
        method: "POST",
        body: { mode, matches, rules },
      }),
      invalidatesTags: (r, e, arg) => [{ type: "Matches", id: arg.bracketId }],
    }),
    managerReplaceRegPlayer: builder.mutation({
      query: ({ regId, slot, userId }) => ({
        url: `/api/registrations/${regId}/manager/replace-player`,
        method: "PATCH",
        body: { slot, userId },
      }),
      invalidatesTags: (r, e, { regId }) => [
        { type: "Registration", id: regId },
        { type: "Registrations", id: "LIST" },
      ],
    }),
  }),
});

export const {
  useGetTournamentsQuery,
  useGetRegistrationsQuery,
  useCreateRegistrationMutation,
  useUpdatePaymentMutation,
  useCheckinMutation,
  useGetTournamentQuery,
  useGetMatchesQuery,
  useGetTournamentMatchesForCheckinQuery,
  useSearchUserMatchesQuery,
  useUserCheckinRegistrationMutation,
  useListTournamentBracketsQuery,
  useListTournamentMatchesQuery,
  useGetMatchPublicQuery,
  useCancelRegistrationMutation,
  useCreateRegInviteMutation,
  useListMyRegInvitesQuery,
  useRespondRegInviteMutation,
  useManagerSetRegPaymentStatusMutation,
  useManagerDeleteRegistrationMutation,
  useGetOverlaySnapshotQuery,
  useGetDrawStatusQuery,
  useInitDrawMutation,
  useRevealDrawMutation,
  useUndoDrawMutation,
  useCancelDrawMutation,
  useFinalizeKoMutation,
  useDrawCancelMutation,
  useDrawCommitMutation,
  useDrawNextMutation,
  useStartDrawMutation,
  useGetBracketQuery,
  useGenerateGroupMatchesMutation,
  useManagerReplaceRegPlayerMutation,
} = tournamentsApiSlice;
