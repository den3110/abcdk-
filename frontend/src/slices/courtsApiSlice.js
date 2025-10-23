import { apiSlice } from "./apiSlice";

export const courtsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    adminListCourtsByTournament: builder.query({
      query: ({ tid, bracketId }) => {
        const q = new URLSearchParams();
        if (bracketId) q.set("bracketId", bracketId);
        return { url: `/api/admin/tournaments/c/${tid}/courts?${q.toString()}` };
      },
    }),

    adminGetCourtLiveConfig: builder.query({
      query: (courtId) => ({ url: `/api/admin/courts/${courtId}/live-config` }),
    }),

    adminSetCourtLiveConfig: builder.mutation({
      query: ({ courtId, enabled, videoUrl, overrideExisting }) => ({
        url: `/api/admin/courts/${courtId}/live-config`,
        method: "PATCH",
        body: { enabled, videoUrl, overrideExisting },
      }),
    }),

    adminBulkSetCourtLiveConfig: builder.mutation({
      query: ({ tid, items }) => ({
        url: `/api/admin/tournaments/${tid}/courts/live-config/bulk`,
        method: "PATCH",
        body: { items },
      }),
    }),
  }),
});

export const {
  useAdminListCourtsByTournamentQuery,
  useAdminGetCourtLiveConfigQuery,
  useAdminSetCourtLiveConfigMutation,
  useAdminBulkSetCourtLiveConfigMutation,
} = courtsApiSlice;
