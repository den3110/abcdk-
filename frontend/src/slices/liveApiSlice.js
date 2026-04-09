import { apiSlice } from "./apiSlice";

const LIMIT = 12;
const FEED_LIMIT = 8;

function dedupeById(items = []) {
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    const id = String(item?._id || "").trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function transformFeedResponse(resp, fallbackLimit = FEED_LIMIT) {
  const total = Number(resp?.count || 0);
  return {
    items: dedupeById(Array.isArray(resp?.items) ? resp.items : []),
    total,
    count: total,
    page: Math.max(1, Number(resp?.page || 1)),
    pages: Math.max(1, Number(resp?.pages || 1)),
    limit: Math.max(1, Number(resp?.limit || fallbackLimit)),
    meta: resp?.meta || {},
  };
}

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
    getLiveFeed: builder.query({
      query: ({
        page = 1,
        limit = FEED_LIMIT,
        q = "",
        tournamentId = "",
        mode = "all",
      } = {}) => {
        const params = new URLSearchParams();

        params.set("page", String(page));
        params.set("limit", String(limit));
        if (q) params.set("q", String(q).trim());
        if (tournamentId) params.set("tournamentId", String(tournamentId));
        if (mode) params.set("mode", String(mode));

        return `/api/live/feed?${params.toString()}`;
      },
      keepUnusedDataFor: 30,
      serializeQueryArgs: ({ endpointName, queryArgs }) => {
        const mode = String(queryArgs?.mode || "all");
        const q = String(queryArgs?.q || "").trim();
        const tournamentId = String(queryArgs?.tournamentId || "").trim();
        const limit = Math.max(1, Number(queryArgs?.limit || FEED_LIMIT));
        return `${endpointName}:${mode}:${tournamentId}:${q}:${limit}`;
      },
      transformResponse: (resp, meta, arg) =>
        transformFeedResponse(resp, Number(arg?.limit || FEED_LIMIT)),
      merge: (currentCache, incomingCache, { arg }) => {
        const requestedPage = Math.max(1, Number(arg?.page || 1));
        if (requestedPage <= 1) {
          currentCache.items = dedupeById(incomingCache.items);
        } else {
          currentCache.items = dedupeById([
            ...(Array.isArray(currentCache.items) ? currentCache.items : []),
            ...(Array.isArray(incomingCache.items) ? incomingCache.items : []),
          ]);
        }
        currentCache.total = incomingCache.total;
        currentCache.count = incomingCache.count;
        currentCache.page = incomingCache.page;
        currentCache.pages = incomingCache.pages;
        currentCache.limit = incomingCache.limit;
        currentCache.meta = incomingCache.meta;
      },
      forceRefetch({ currentArg, previousArg }) {
        return (
          currentArg?.page !== previousArg?.page ||
          currentArg?.limit !== previousArg?.limit ||
          currentArg?.mode !== previousArg?.mode ||
          currentArg?.q !== previousArg?.q ||
          currentArg?.tournamentId !== previousArg?.tournamentId
        );
      },
    }),
    getLiveFeedProbe: builder.query({
      query: ({
        page = 1,
        limit = FEED_LIMIT,
        q = "",
        tournamentId = "",
        mode = "all",
      } = {}) => {
        const params = new URLSearchParams();

        params.set("page", String(page));
        params.set("limit", String(limit));
        if (q) params.set("q", String(q).trim());
        if (tournamentId) params.set("tournamentId", String(tournamentId));
        if (mode) params.set("mode", String(mode));

        return `/api/live/feed?${params.toString()}`;
      },
      keepUnusedDataFor: 10,
      transformResponse: (resp, meta, arg) =>
        transformFeedResponse(resp, Number(arg?.limit || FEED_LIMIT)),
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
  useGetLiveFeedProbeQuery,
  useGetLiveFeedQuery,
  useGetLiveMatchesQuery,
  useDeleteLiveVideoMutation,
} = liveApiSlice;
