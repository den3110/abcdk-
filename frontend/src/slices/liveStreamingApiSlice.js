// liveStreamingApiSlice.js - FIXED VERSION
import { apiSlice } from "./apiSlice";

export const liveStreamingApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // ==================== COURT & MATCH INFO ====================

    /**
     * Lấy thông tin sân (bao gồm currentMatch)
     */
    getCourtInfo: builder.query({
      query: (courtId) => ({
        url: `/api/courts/${courtId}`,
      }),
      providesTags: (result, error, courtId) => [
        { type: "Court", id: courtId },
      ],
    }),

    /**
     * Lấy thông tin chi tiết trận đấu
     */
    getMatchInfo: builder.query({
      query: (matchId) => ({
        url: `/api/matches/${matchId}`,
      }),
      providesTags: (result, error, matchId) => [
        { type: "Match", id: matchId },
      ],
    }),

    /**
     * Lấy trận hiện tại của sân (wrapper tiện lợi)
     */
    getCurrentMatchByCourt: builder.query({
      async queryFn(courtId, _queryApi, _extraOptions, fetchWithBQ) {
        // Bước 1: Lấy thông tin sân
        const courtResult = await fetchWithBQ({
          url: `/api/courts/${courtId}`,
        });

        if (courtResult.error) return { error: courtResult.error };

        const court = courtResult.data;
        if (!court.currentMatch) {
          return { data: { court, match: null } };
        }

        // Bước 2: Lấy chi tiết trận đấu
        // 🔧 FIX: court.currentMatch có thể là object (nếu populate) hoặc string
        const matchId =
          typeof court.currentMatch === "object"
            ? court.currentMatch._id
            : court.currentMatch;

        const matchResult = await fetchWithBQ({
          url: `/api/admin/matches/${matchId}`,
        });

        if (matchResult.error) return { error: matchResult.error };

        return {
          data: {
            court,
            match: matchResult.data,
          },
        };
      },
      providesTags: (result, error, courtId) => [
        { type: "Court", id: courtId },
        ...(result?.match?._id
          ? [{ type: "Match", id: result.match._id }]
          : []),
      ],
    }),

    // ==================== LIVE SESSION MANAGEMENT ====================

    /**
     * Tạo live session cho trận đấu
     * POST /api/admin/match/:matchId/live/create
     */
    createLiveSession: builder.mutation({
      query: ({ matchId, pageId }) => ({
        url: `/api/matches/${matchId}/live/create`,
        method: "POST",
        body: pageId ? { pageId } : {},
      }),
      invalidatesTags: (result, error, { matchId }) => [
        { type: "Match", id: matchId },
        "LiveSession",
      ],
    }),

    /**
     * Lấy thông tin live session hiện tại của trận
     */
    getMatchLiveSession: builder.query({
      query: (matchId) => ({
        url: `/api/matches/${matchId}/live`,
      }),
      providesTags: (result, error, matchId) => [
        { type: "Match", id: matchId },
        "LiveSession",
      ],
    }),

    // ==================== MONITORING & CONTROL ====================

    /**
     * Polling để theo dõi trận đấu theo sân
     * Sử dụng với pollingInterval
     */
    pollCourtMatches: builder.query({
      query: ({ courtIds }) => {
        const ids = Array.isArray(courtIds) ? courtIds : [courtIds];
        return {
          url: `/api/courts/batch`,
          method: "POST",
          body: { courtIds: ids },
        };
      },
      providesTags: (result, error, { courtIds }) => {
        const ids = Array.isArray(courtIds) ? courtIds : [courtIds];
        return [...ids.map((id) => ({ type: "Court", id })), "CourtBatch"];
      },
    }),

    /**
     * Lấy danh sách các sân đang có trận live
     */
    getActiveCourts: builder.query({
      query: (tournamentId) => ({
        url: `/api/tournaments/${tournamentId}/courts/active`,
      }),
      providesTags: ["ActiveCourts"],
    }),

    // ==================== LIVE STREAM CONTROL ====================

    /**
     * Báo cho backend biết stream đã bắt đầu
     * (Optional - nếu backend cần track streaming state)
     */
    notifyStreamStarted: builder.mutation({
      query: ({ matchId, platform }) => ({
        url: `/api/matches/${matchId}/live/start`,
        method: "POST",
        body: { platform, timestamp: new Date().toISOString() },
      }),
      invalidatesTags: (result, error, { matchId }) => [
        { type: "Match", id: matchId },
      ],
    }),

    /**
     * Báo cho backend biết stream đã kết thúc
     */
    notifyStreamEnded: builder.mutation({
      query: ({ matchId, platform }) => ({
        url: `/api/matches/${matchId}/live/end`,
        method: "POST",
        body: { platform, timestamp: new Date().toISOString() },
      }),
      invalidatesTags: (result, error, { matchId }) => [
        { type: "Match", id: matchId },
      ],
    }),

    // ==================== ANALYTICS & HISTORY ====================

    /**
     * Lấy lịch sử streaming của giải
     */
    getTournamentStreamHistory: builder.query({
      query: ({ tournamentId, limit = 50, skip = 0 }) => {
        const q = new URLSearchParams();
        q.set("limit", limit);
        q.set("skip", skip);
        return {
          url: `/api/tournaments/${tournamentId}/stream-history?${q.toString()}`,
        };
      },
      providesTags: ["StreamHistory"],
    }),

    /**
     * Lấy thống kê streaming theo sân
     */
    getCourtStreamStats: builder.query({
      query: ({ courtId, from, to }) => {
        const q = new URLSearchParams();
        if (from) q.set("from", from);
        if (to) q.set("to", to);
        return {
          url: `/api/courts/${courtId}/stream-stats?${q.toString()}`,
        };
      },
      providesTags: (result, error, { courtId }) => [
        { type: "Court", id: courtId },
        "StreamStats",
      ],
    }),

    // ==================== UTILITY ENDPOINTS ====================

    /**
     * Health check cho streaming system
     */
    checkStreamingHealth: builder.query({
      query: () => ({
        url: `/api/streaming/health`,
      }),
    }),

    /**
     * Lấy cấu hình streaming platforms
     */
    getStreamingConfig: builder.query({
      query: () => ({
        url: `/api/streaming/config`,
      }),
      providesTags: ["StreamingConfig"],
    }),

    /**
     * Update streaming config (admin only)
     */
    updateStreamingConfig: builder.mutation({
      query: (config) => ({
        url: `/api/streaming/config`,
        method: "PATCH",
        body: config,
      }),
      invalidatesTags: ["StreamingConfig"],
    }),
  }),
});

// Export hooks
export const {
  // Court & Match queries
  useGetCourtInfoQuery,
  useGetMatchInfoQuery,
  useGetCurrentMatchByCourtQuery,
  useLazyGetCurrentMatchByCourtQuery,

  // Live session mutations
  useCreateLiveSessionMutation,
  useGetMatchLiveSessionQuery,

  // Monitoring
  usePollCourtMatchesQuery,
  useGetActiveCourtsQuery,

  // Stream control
  useNotifyStreamStartedMutation,
  useNotifyStreamEndedMutation,

  // Analytics
  useGetTournamentStreamHistoryQuery,
  useGetCourtStreamStatsQuery,

  // Utility
  useCheckStreamingHealthQuery,
  useGetStreamingConfigQuery,
  useUpdateStreamingConfigMutation,
} = liveStreamingApiSlice;
