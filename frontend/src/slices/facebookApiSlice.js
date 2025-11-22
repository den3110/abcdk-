// src/slices/facebookApiSlice.js
import { apiSlice } from "./apiSlice";

export const facebookApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Lấy URL OAuth để mở Facebook
    getFacebookLoginUrl: builder.mutation({
      query: () => ({
        url: "/api/fb/me/facebook/login-url", // backend đang mount /api rồi
        method: "GET",
      }),
    }),

    // Lấy danh sách page đã connect
    getFacebookPages: builder.query({
      query: () => ({
        url: "/api/fb/me/facebook/pages",
        method: "GET",
      }),
      // tuỳ bạn có muốn keepUnusedDataFor không
    }),

    // Đặt 1 page làm mặc định
    setDefaultFacebookPage: builder.mutation({
      query: (pageConnectionId) => ({
        url: "/api/fb/me/facebook/default-page",
        method: "POST",
        body: { pageConnectionId },
      }),
    }),

    // Xoá kết nối 1 page
    deleteFacebookPage: builder.mutation({
      query: (id) => ({
        url: `/api/fb/me/facebook/pages/${id}`,
        method: "DELETE",
      }),
    }),
  }),
});

export const {
  useGetFacebookLoginUrlMutation,
  useGetFacebookPagesQuery,
  useSetDefaultFacebookPageMutation,
  useDeleteFacebookPageMutation,
} = facebookApiSlice;
