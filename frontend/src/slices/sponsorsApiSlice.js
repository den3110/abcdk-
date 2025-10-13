// src/slices/sponsorsApiSlice.js
// Yêu cầu: đã có apiSlice gốc với baseUrl '/api'
import { apiSlice } from "./apiSlice";

export const sponsorsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    /**
     * Lấy danh sách nhà tài trợ (public)
     * args ví dụ: { featuredOnly: 1, tier: 'Gold', limit: 40 }
     * backend trả { items: [...] } -> transform thành mảng
     */
    getSponsorsPublic: builder.query({
      query: (params) => ({ url: "/api/sponsors", params }),
      transformResponse: (res) => res?.items ?? [],
      providesTags: [{ type: "Sponsors", id: "PUBLIC" }],
    }),
  }),
  overrideExisting: false,
});

export const { useGetSponsorsPublicQuery } = sponsorsApiSlice;
