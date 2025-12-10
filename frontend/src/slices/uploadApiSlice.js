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
    uploadRealAvatar: builder.mutation({
      query: (file) => {
        const formData = new FormData();
        formData.append("avatar", file);

        return {
          url: "/api/upload/user/avatar",
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
    uploadRegisterCccd: builder.mutation({
      query: (file) => {
        const fd = new FormData();
        fd.append("image", file); // field name
        return { url: "/api/upload/register-cccd", method: "POST", body: fd };
      },
    }),
  }),
});

export const { useUploadAvatarMutation, useUploadCccdMutation, useUploadRegisterCccdMutation, useUploadRealAvatarMutation  } = uploadApiSlice;
