// Yêu cầu: đã có apiSlice gốc (createApi) export { apiSlice } với baseUrl = '/api'.
// TagTypes nên có ít nhất: ['Sponsors', 'Sponsor'] (thêm nếu chưa có).

import { apiSlice } from "./apiSlice";

export const overlayApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getPublicGuideLink: builder.query({
      query: () => ({
        url: "/api/public/guide-link",
        method: "GET",
      }),
      extraOptions: {
        skip404Redirect: true,
        skip503Redirect: true,
        skipSentryCapture: true,
      },
    }),
    // GET /api/public/overlay/config?limit=&featured=&tier=
    getOverlayConfig: builder.query({
      query: (params) => ({
        url: "/api/public/overlay/config",
        params, // { limit, featured, tier }
      }),
      // Cho phép cache-busting theo sponsor
      providesTags: (res) => {
        const base = [{ type: "Sponsors", id: "PUBLIC" }];
        if (!res?.sponsors?.length) return base;
        return [
          ...base,
          ...res.sponsors.map((x) => ({ type: "Sponsor", id: x._id })),
        ];
      },
    }),
    // === Tournament overlay generator (admin/manager) ===
    getTournamentOverlayStatus: builder.query({
      query: (tourId) => ({
        url: `/api/admin/tournaments/${tourId}/overlay/status`,
      }),
      providesTags: (r, e, tourId) => [
        { type: "TournamentOverlay", id: tourId },
      ],
    }),
    generateTournamentOverlay: builder.mutation({
      query: ({ tourId, ...body }) => ({
        url: `/api/admin/tournaments/${tourId}/overlay/generate`,
        method: "POST",
        body,
      }),
    }),
    deployTournamentOverlay: builder.mutation({
      query: ({ tourId, ...body }) => ({
        url: `/api/admin/tournaments/${tourId}/overlay/deploy`,
        method: "POST",
        body,
      }),
      invalidatesTags: (r, e, { tourId }) => [
        { type: "TournamentOverlay", id: tourId },
      ],
    }),
    clearTournamentOverlay: builder.mutation({
      query: (tourId) => ({
        url: `/api/admin/tournaments/${tourId}/overlay`,
        method: "DELETE",
      }),
      invalidatesTags: (r, e, tourId) => [
        { type: "TournamentOverlay", id: tourId },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetPublicGuideLinkQuery,
  useGetOverlayConfigQuery,
  useLazyGetOverlayConfigQuery,
  useGetTournamentOverlayStatusQuery,
  useGenerateTournamentOverlayMutation,
  useDeployTournamentOverlayMutation,
  useClearTournamentOverlayMutation,
} = overlayApiSlice;
