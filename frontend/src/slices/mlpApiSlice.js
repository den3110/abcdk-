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
  useSyncSubMatchResultMutation,
  useStartDreamBreakerMutation,
  useScoreDreamBreakerPointMutation,
  useUndoDreamBreakerPointMutation,
  usePatchMlpDualMutation,
  useListMlpStandingsQuery,
  useRecomputeMlpStandingsMutation,
} = mlpApiSlice;
