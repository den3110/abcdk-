// src/slices/uploadApiSlice.js
import { apiSlice } from "./apiSlice";

export const uploadApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    uploadAvatar: builder.mutation({
      query: (file) => {
        const formData = new FormData();
        formData.append("avatar", file);

        return {
          url: "/api/upload/avatar",
          method: "POST",
          body: formData,
        };
      },
    }),
    uploadCccd: builder.mutation({
      query: (formData) => ({
        url   : "/api/upload/cccd",
        method: "POST",
        body  : formData,
      }),
    }),
  }),
});

export const { useUploadAvatarMutation, useUploadCccdMutation  } = uploadApiSlice;
