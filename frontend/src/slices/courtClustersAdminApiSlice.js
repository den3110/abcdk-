import { apiSlice } from "./apiSlice";

export const courtClustersAdminApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getTournamentCourtClusterOptions: builder.query({
      query: (tournamentId) =>
        `/api/admin/tournaments/${tournamentId}/allowed-court-clusters/options`,
      keepUnusedDataFor: 0,
      providesTags: (result, error, tournamentId) => [
        { type: "TournamentCourtClusters", id: tournamentId },
      ],
    }),
    updateTournamentAllowedCourtClusters: builder.mutation({
      query: ({ tournamentId, allowedCourtClusterIds }) => ({
        url: `/api/admin/tournaments/${tournamentId}/allowed-court-clusters`,
        method: "PUT",
        body: { allowedCourtClusterIds },
      }),
      invalidatesTags: (result, error, { tournamentId }) => [
        { type: "TournamentCourtClusters", id: tournamentId },
        { type: "Tournaments", id: tournamentId },
      ],
    }),
    getTournamentCourtClusterRuntime: builder.query({
      query: ({ tournamentId, clusterId }) =>
        `/api/admin/tournaments/${tournamentId}/court-clusters/${clusterId}/runtime`,
      keepUnusedDataFor: 0,
      providesTags: (result, error, { tournamentId, clusterId }) => [
        {
          type: "TournamentCourtClusterRuntime",
          id: `${tournamentId}:${clusterId}`,
        },
        { type: "TournamentCourtClusterRuntime", id: `LIST_${tournamentId}` },
      ],
    }),
    assignTournamentMatchToCourtStation: builder.mutation({
      query: ({ tournamentId, stationId, matchId }) => ({
        url: `/api/admin/tournaments/${tournamentId}/court-stations/${stationId}/assign-match`,
        method: "POST",
        body: { matchId },
      }),
      invalidatesTags: (result, error, { tournamentId, stationId }) => [
        { type: "TournamentCourtClusters", id: tournamentId },
        { type: "Tournaments", id: tournamentId },
        { type: "CourtClusterRuntime", id: stationId },
        { type: "TournamentCourtClusterRuntime", id: `LIST_${tournamentId}` },
      ],
    }),
    updateTournamentCourtStationAssignmentConfig: builder.mutation({
      query: ({
        tournamentId,
        stationId,
        assignmentMode,
        queueMatchIds,
        refereeIds,
      }) => ({
        url: `/api/admin/tournaments/${tournamentId}/court-stations/${stationId}/assignment-config`,
        method: "PUT",
        body: { assignmentMode, queueMatchIds, refereeIds },
      }),
      invalidatesTags: (result, error, { tournamentId, stationId }) => [
        { type: "TournamentCourtClusters", id: tournamentId },
        {
          type: "TournamentCourtClusterRuntime",
          id: `${tournamentId}:${stationId}`,
        },
        { type: "CourtClusterRuntime", id: stationId },
        { type: "TournamentCourtClusterRuntime", id: `LIST_${tournamentId}` },
      ],
    }),
    appendTournamentCourtStationQueueItem: builder.mutation({
      query: ({ tournamentId, stationId, matchId }) => ({
        url: `/api/admin/tournaments/${tournamentId}/court-stations/${stationId}/queue/items`,
        method: "POST",
        body: { matchId },
      }),
      invalidatesTags: (result, error, { tournamentId, stationId }) => [
        { type: "TournamentCourtClusters", id: tournamentId },
        {
          type: "TournamentCourtClusterRuntime",
          id: `${tournamentId}:${stationId}`,
        },
        { type: "CourtClusterRuntime", id: stationId },
        { type: "TournamentCourtClusterRuntime", id: `LIST_${tournamentId}` },
      ],
    }),
    removeTournamentCourtStationQueueItem: builder.mutation({
      query: ({ tournamentId, stationId, matchId }) => ({
        url: `/api/admin/tournaments/${tournamentId}/court-stations/${stationId}/queue/items/${matchId}`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, { tournamentId, stationId }) => [
        { type: "TournamentCourtClusters", id: tournamentId },
        {
          type: "TournamentCourtClusterRuntime",
          id: `${tournamentId}:${stationId}`,
        },
        { type: "CourtClusterRuntime", id: stationId },
        { type: "TournamentCourtClusterRuntime", id: `LIST_${tournamentId}` },
      ],
    }),
    freeTournamentCourtStation: builder.mutation({
      query: ({ tournamentId, stationId }) => ({
        url: `/api/admin/tournaments/${tournamentId}/court-stations/${stationId}/free`,
        method: "POST",
      }),
      invalidatesTags: (result, error, { tournamentId, stationId }) => [
        { type: "TournamentCourtClusters", id: tournamentId },
        { type: "Tournaments", id: tournamentId },
        { type: "CourtClusterRuntime", id: stationId },
        { type: "TournamentCourtClusterRuntime", id: `LIST_${tournamentId}` },
      ],
    }),
    getAdminCourtClusterRuntime: builder.query({
      query: (clusterId) => `/api/admin/court-clusters/${clusterId}/runtime`,
      keepUnusedDataFor: 0,
      providesTags: (result, error, clusterId) => [
        { type: "CourtClusterRuntime", id: clusterId },
      ],
    }),
    updateAdminCourtStation: builder.mutation({
      query: ({ clusterId, stationId, ...body }) => ({
        url: `/api/admin/court-clusters/${clusterId}/courts/${stationId}`,
        method: "PUT",
        body,
      }),
      invalidatesTags: (result, error, { clusterId, stationId }) => [
        { type: "CourtClusterRuntime", id: clusterId },
        { type: "CourtClusterRuntime", id: stationId },
      ],
    }),
    assignMatchToCourtStation: builder.mutation({
      query: ({ stationId, matchId }) => ({
        url: `/api/admin/court-stations/${stationId}/assign-match`,
        method: "POST",
        body: { matchId },
      }),
    }),
    freeCourtStation: builder.mutation({
      query: (stationId) => ({
        url: `/api/admin/court-stations/${stationId}/free`,
        method: "POST",
      }),
    }),
  }),
  overrideExisting: true,
});

export const {
  useGetTournamentCourtClusterOptionsQuery,
  useUpdateTournamentAllowedCourtClustersMutation,
  useGetTournamentCourtClusterRuntimeQuery,
  useAssignTournamentMatchToCourtStationMutation,
  useUpdateTournamentCourtStationAssignmentConfigMutation,
  useAppendTournamentCourtStationQueueItemMutation,
  useRemoveTournamentCourtStationQueueItemMutation,
  useFreeTournamentCourtStationMutation,
  useGetAdminCourtClusterRuntimeQuery,
  useUpdateAdminCourtStationMutation,
  useAssignMatchToCourtStationMutation,
  useFreeCourtStationMutation,
} = courtClustersAdminApiSlice;
