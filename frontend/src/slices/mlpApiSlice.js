// slices/mlpApiSlice.js — MLP tournament (Phase 1-4).
import { apiSlice } from "./apiSlice";

export const mlpApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    /* ── Tournament config ── */
    updateMlpConfig: builder.mutation({
      query: ({ tourId, ...body }) => ({
        url: `/api/mlp/tournaments/${tourId}/mlp-config`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (r, e, { tourId }) => [
        { type: "Tournament", id: tourId },
      ],
    }),

    /* ── Teams ── */
    listMlpTeams: builder.query({
      query: ({ tourId, status } = {}) => {
        const p = new URLSearchParams();
        if (status) p.set("status", status);
        const qs = p.toString();
        return {
          url: `/api/mlp/tournaments/${tourId}/teams${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      providesTags: (r, e, { tourId }) => [{ type: "MlpTeam", id: tourId }],
    }),
    getMlpTeam: builder.query({
      query: (id) => ({ url: `/api/mlp/teams/${id}`, method: "GET" }),
      providesTags: (r, e, id) => [{ type: "MlpTeam", id }],
    }),
    createMlpTeam: builder.mutation({
      query: ({ tourId, ...body }) => ({
        url: `/api/mlp/tournaments/${tourId}/teams`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { tourId }) => [{ type: "MlpTeam", id: tourId }],
    }),
    updateMlpTeam: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/mlp/teams/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (r, e, { id }) => [
        { type: "MlpTeam", id },
        { type: "MlpTeam", id: "LIST" },
      ],
    }),
    deleteMlpTeam: builder.mutation({
      query: (id) => ({ url: `/api/mlp/teams/${id}`, method: "DELETE" }),
      invalidatesTags: [{ type: "MlpTeam", id: "LIST" }],
    }),

    /* ── Dual matches (Phase 3) ── */
    listMlpDuals: builder.query({
      query: ({ tourId, status } = {}) => {
        const p = new URLSearchParams();
        if (status) p.set("status", status);
        const qs = p.toString();
        return {
          url: `/api/mlp/tournaments/${tourId}/duals${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      providesTags: (r, e, { tourId }) => [{ type: "MlpDual", id: tourId }],
    }),
    getMlpDual: builder.query({
      query: (id) => ({ url: `/api/mlp/duals/${id}`, method: "GET" }),
      providesTags: (r, e, id) => [{ type: "MlpDual", id }],
    }),
    generateMlpDuals: builder.mutation({
      query: ({ tourId, ...body }) => ({
        url: `/api/mlp/tournaments/${tourId}/duals/generate`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { tourId }) => [{ type: "MlpDual", id: tourId }],
    }),
    assignSubMatchLineup: builder.mutation({
      query: ({ dualId, subId, playersA, playersB }) => ({
        url: `/api/mlp/duals/${dualId}/subs/${subId}/lineup`,
        method: "PATCH",
        body: { playersA, playersB },
      }),
      invalidatesTags: (r, e, { dualId }) => [
        { type: "MlpDual", id: dualId },
      ],
    }),
    deleteMlpRound: builder.mutation({
      query: ({ tourId, round }) => ({
        url: `/api/mlp/tournaments/${tourId}/duals/round/${round}`,
        method: "DELETE",
      }),
      invalidatesTags: (r, e, { tourId }) => [
        { type: "MlpDual", id: tourId },
      ],
    }),
    patchMlpSubMatch: builder.mutation({
      query: ({ dualId, subId, ...body }) => ({
        url: `/api/mlp/duals/${dualId}/subs/${subId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (r, e, { dualId }) => [
        { type: "MlpDual", id: dualId },
      ],
    }),
    syncSubMatchResult: builder.mutation({
      query: ({ dualId, subId, scoreA, scoreB, status }) => ({
        url: `/api/mlp/duals/${dualId}/subs/${subId}/score`,
        method: "POST",
        body: { scoreA, scoreB, status },
      }),
      invalidatesTags: (r, e, { dualId }) => [{ type: "MlpDual", id: dualId }],
    }),

    /* ── DreamBreaker (Phase 4) ── */
    startDreamBreaker: builder.mutation({
      query: ({ dualId, lineupA, lineupB }) => ({
        url: `/api/mlp/duals/${dualId}/dreambreaker/start`,
        method: "POST",
        body: { lineupA, lineupB },
      }),
      invalidatesTags: (r, e, { dualId }) => [{ type: "MlpDual", id: dualId }],
    }),
    scoreDreamBreakerPoint: builder.mutation({
      query: ({ dualId, side }) => ({
        url: `/api/mlp/duals/${dualId}/dreambreaker/point`,
        method: "POST",
        body: { side },
      }),
      invalidatesTags: (r, e, { dualId }) => [{ type: "MlpDual", id: dualId }],
    }),
    undoDreamBreakerPoint: builder.mutation({
      query: ({ dualId }) => ({
        url: `/api/mlp/duals/${dualId}/dreambreaker/undo`,
        method: "POST",
      }),
      invalidatesTags: (r, e, { dualId }) => [{ type: "MlpDual", id: dualId }],
    }),

    /* ── Dual metadata (referee/court/schedule) + Standings ── */
    patchMlpDual: builder.mutation({
      query: ({ dualId, ...body }) => ({
        url: `/api/mlp/duals/${dualId}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (r, e, { dualId, tourId }) => [
        { type: "MlpDual", id: dualId },
        ...(tourId ? [{ type: "MlpDual", id: tourId }] : []),
      ],
    }),
    listMlpStandings: builder.query({
      query: (tid) => ({
        url: `/api/mlp/tournaments/${tid}/standings`,
      }),
      providesTags: (r, e, tid) => [{ type: "MlpStandings", id: tid }],
    }),
    recomputeMlpStandings: builder.mutation({
      query: (tid) => ({
        url: `/api/mlp/tournaments/${tid}/standings/recompute`,
        method: "POST",
      }),
      invalidatesTags: (r, e, tid) => [{ type: "MlpStandings", id: tid }],
    }),

    /* Phase 2/5/6 */
    listMlpTournamentCourts: builder.query({
      query: (tid) => ({ url: `/api/mlp/tournaments/${tid}/courts` }),
    }),
    autoAssignMlpCourts: builder.mutation({
      query: (tid) => ({
        url: `/api/mlp/tournaments/${tid}/duals/auto-assign-courts`,
        method: "POST",
      }),
      invalidatesTags: (r, e, tid) => [{ type: "MlpDual", id: tid }],
    }),
    generateMlpKnockout: builder.mutation({
      query: ({ tid, ...body }) => ({
        url: `/api/mlp/tournaments/${tid}/duals/generate-knockout`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { tid }) => [
        { type: "MlpDual", id: tid },
        { type: "MlpStandings", id: tid },
      ],
    }),

    /* ── Pool draw (group stage) ── */
    listMlpPools: builder.query({
      query: (tid) => ({ url: `/api/mlp/tournaments/${tid}/pools` }),
      providesTags: (r, e, tid) => [{ type: "MlpPools", id: tid }],
    }),
    drawMlpPools: builder.mutation({
      query: ({ tid, ...body }) => ({
        url: `/api/mlp/tournaments/${tid}/pools/draw`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { tid }) => [
        { type: "MlpPools", id: tid },
        { type: "MlpTeam", id: tid },
        { type: "MlpDual", id: tid },
        { type: "MlpStandings", id: tid },
      ],
    }),
    resetMlpPools: builder.mutation({
      query: (tid) => ({
        url: `/api/mlp/tournaments/${tid}/pools/reset`,
        method: "POST",
      }),
      invalidatesTags: (r, e, tid) => [
        { type: "MlpPools", id: tid },
        { type: "MlpTeam", id: tid },
      ],
    }),
    broadcastMlpLiveDraw: builder.mutation({
      query: ({ tid, event, payload }) => ({
        url: `/api/mlp/tournaments/${tid}/pools/live-draw/broadcast`,
        method: "POST",
        body: { event, payload },
      }),
    }),
    resetMlpTournament: builder.mutation({
      query: ({ tid, ...body }) => ({
        url: `/api/mlp/tournaments/${tid}/reset`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { tid }) => [
        { type: "MlpDual", id: tid },
        { type: "MlpDual", id: "LIST" },
        { type: "MlpStandings", id: tid },
        { type: "MlpTeam", id: tid },
        { type: "MlpPools", id: tid },
      ],
    }),
    forceFinishMlpDual: builder.mutation({
      query: ({ dualId, winner }) => ({
        url: `/api/mlp/duals/${dualId}/force-finish`,
        method: "POST",
        body: { winner },
      }),
      invalidatesTags: (r, e, { dualId, tourId }) => [
        { type: "MlpDual", id: dualId },
        ...(tourId
          ? [
              { type: "MlpDual", id: tourId },
              { type: "MlpStandings", id: tourId },
            ]
          : []),
      ],
    }),
    deleteMlpDual: builder.mutation({
      query: (dualId) => ({
        url: `/api/mlp/duals/${dualId}`,
        method: "DELETE",
      }),
      invalidatesTags: [
        { type: "MlpDual", id: "LIST" },
        { type: "MlpStandings", id: "LIST" },
      ],
    }),
    checkInMlpDual: builder.mutation({
      query: ({ dualId, side }) => ({
        url: `/api/mlp/duals/${dualId}/check-in`,
        method: "POST",
        body: { side },
      }),
      invalidatesTags: (r, e, { dualId }) => [{ type: "MlpDual", id: dualId }],
    }),
  }),
});

export const {
  useUpdateMlpConfigMutation,
  useListMlpTeamsQuery,
  useGetMlpTeamQuery,
  useCreateMlpTeamMutation,
  useUpdateMlpTeamMutation,
  useDeleteMlpTeamMutation,
  useListMlpDualsQuery,
  useGetMlpDualQuery,
  useGenerateMlpDualsMutation,
  useAssignSubMatchLineupMutation,
  useDeleteMlpRoundMutation,
  usePatchMlpSubMatchMutation,
  useSyncSubMatchResultMutation,
  useStartDreamBreakerMutation,
  useScoreDreamBreakerPointMutation,
  useUndoDreamBreakerPointMutation,
  usePatchMlpDualMutation,
  useListMlpStandingsQuery,
  useRecomputeMlpStandingsMutation,
  useListMlpTournamentCourtsQuery,
  useAutoAssignMlpCourtsMutation,
  useGenerateMlpKnockoutMutation,
  useForceFinishMlpDualMutation,
  useDeleteMlpDualMutation,
  useCheckInMlpDualMutation,
  useListMlpPoolsQuery,
  useDrawMlpPoolsMutation,
  useResetMlpPoolsMutation,
  useBroadcastMlpLiveDrawMutation,
  useResetMlpTournamentMutation,
} = mlpApiSlice;
