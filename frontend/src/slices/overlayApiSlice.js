// Yêu cầu: đã có apiSlice gốc (createApi) export { apiSlice } với baseUrl = '/api'.
// TagTypes nên có ít nhất: ['Sponsors', 'Sponsor'] (thêm nếu chưa có).

import { apiSlice } from "./apiSlice";

export const overlayApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
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
  }),
  overrideExisting: false,
});

export const {
  useGetOverlayConfigQuery,
  useLazyGetOverlayConfigQuery,
} = overlayApiSlice;
