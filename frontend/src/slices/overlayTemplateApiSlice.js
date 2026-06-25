import { apiSlice } from "./apiSlice";

export const overlayTemplateApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    listOverlayTemplateLibrary: builder.query({
      query: () => ({
        url: "/api/overlay/templates/library",
        method: "GET",
      }),
      transformResponse: (res) => (Array.isArray(res?.items) ? res.items : []),
      keepUnusedDataFor: 300,
    }),
    listOverlayTemplates: builder.query({
      query: ({ tournamentId }) => ({
        url: "/api/overlay/templates",
        method: "GET",
        params: { tournamentId },
      }),
      transformResponse: (res) => (Array.isArray(res?.items) ? res.items : []),
      providesTags: (_res, _err, arg) => [
        { type: "OverlayTemplates", id: arg?.tournamentId || "LIST" },
      ],
    }),
    resolveOverlayTemplate: builder.query({
      query: ({ matchId }) => ({
        url: "/api/overlay/templates/resolve",
        method: "GET",
        params: { matchId },
      }),
      providesTags: (_res, _err, arg) => [
        { type: "OverlayTemplates", id: arg?.matchId || "RESOLVE" },
      ],
      keepUnusedDataFor: 10,
    }),
    cloneOverlayTemplate: builder.mutation({
      query: (body) => ({
        url: "/api/overlay/templates/clone",
        method: "POST",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: "OverlayTemplates", id: arg?.tournamentId || "LIST" },
      ],
    }),
    updateOverlayTemplate: builder.mutation({
      query: ({ id, ...body }) => ({
        url: `/api/overlay/templates/${id}`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: "OverlayTemplates", id: arg?.tournamentId || "LIST" },
      ],
    }),
    publishOverlayTemplate: builder.mutation({
      query: ({ id }) => ({
        url: `/api/overlay/templates/${id}/publish`,
        method: "POST",
      }),
      invalidatesTags: (_res, _err, arg) => [
        { type: "OverlayTemplates", id: arg?.tournamentId || "LIST" },
      ],
    }),
  }),
});

export const {
  useListOverlayTemplateLibraryQuery,
  useListOverlayTemplatesQuery,
  useResolveOverlayTemplateQuery,
  useCloneOverlayTemplateMutation,
  useUpdateOverlayTemplateMutation,
  usePublishOverlayTemplateMutation,
} = overlayTemplateApiSlice;
