import { apiSlice } from "./apiSlice";

const LIMIT = 12;

export const liveApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getLiveClusters: builder.query({
      query: () => "/api/live/clusters",
      transformResponse: (resp) => resp?.items || [],
      providesTags: (result = []) => [
        ...result.map((item) => ({ type: "LiveCluster", id: item._id })),
        { type: "LiveCluster", id: "LIST" },
      ],
    }),
    getLiveCluster: builder.query({
      query: (clusterId) => `/api/live/clusters/${clusterId}`,
      providesTags: (result, error, clusterId) => [
        { type: "LiveCluster", id: clusterId },
      ],
    }),
    getLiveCourt: builder.query({
      query: (courtStationId) => `/api/live/courts/${courtStationId}`,
      providesTags: (result, error, courtStationId) => [
        { type: "LiveCourt", id: courtStationId },
      ],
    }),
    getLiveMatches: builder.query({
      query: ({
        statuses = "scheduled,queued,assigned,live",
        excludeFinished,
        windowMs = 8 * 3600 * 1000,
        keyword = "",
        q = "",
        tournamentId = "",
        page = 1,
        limit = LIMIT,
        all = false,
      } = {}) => {
        const params = new URLSearchParams();

        if (statuses) params.set("statuses", statuses);
        if (windowMs > 0) params.set("windowMs", String(windowMs));
        if (excludeFinished === false) params.set("excludeFinished", "false");
        if (keyword || q) params.set("q", String(q || keyword || "").trim());
        if (tournamentId) params.set("tournamentId", tournamentId);
        if (page) params.set("page", String(page));
        if (limit) params.set("limit", String(limit));
        if (all) params.set("all", "true");

        const queryString = params.toString();
        return `/api/live/matches${queryString ? `?${queryString}` : ""}`;
      },
      keepUnusedDataFor: 30,
      transformResponse: (resp, meta, arg) => {
        const requestPage = Math.max(1, Number(arg?.page || 1));
        const requestLimit = Math.max(1, Number(arg?.limit || LIMIT));
        const total = Number(resp?.count || 0);

        return {
          items: Array.isArray(resp?.items) ? resp.items : [],
          total,
          count: total,
          page: Number(resp?.page || requestPage),
          pages: Math.max(1, Number(resp?.pages || 1)),
          limit: Number(resp?.limit || requestLimit),
          meta: resp?.meta || {},
          tournaments: Array.isArray(resp?.tournaments) ? resp.tournaments : [],
          rawCount: total,
          countLive: Number(resp?.countLive || 0),
        };
      },
    }),
    deleteLiveVideo: builder.mutation({
      query: (matchId) => ({
        url: `/api/live/matches/${matchId}/video`,
        method: "DELETE",
      }),
      invalidatesTags: (result, error, matchId) => [
        { type: "LiveMatches", id: "LIST" },
        { type: "LiveMatch", id: matchId },
      ],
    }),
  }),
});

export const {
  useGetLiveClustersQuery,
  useGetLiveClusterQuery,
  useGetLiveCourtQuery,
  useGetLiveMatchesQuery,
  useDeleteLiveVideoMutation,
} = liveApiSlice;
