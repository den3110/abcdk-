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
        url: "/api/upload/cccd",
        method: "POST",
        body: formData,
      }),
    }),
    uploadRegisterCccd: builder.mutation({
      query: (file) => {
        const fd = new FormData();
        fd.append("image", file); // field name
        return { url: "/api/upload/register-cccd", method: "POST", body: fd };
      },
    }),
    uploadImageToFolder: builder.mutation({
      query: ({ folder = "misc", file, options = {} }) => {
        const fd = new FormData();
        fd.append("image", file);
        Object.entries(options).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") {
            fd.append(key, String(value));
          }
        });
        return {
          url: `/api/upload/${encodeURIComponent(folder)}`,
          method: "POST",
          body: fd,
        };
      },
    }),
  }),
});

export const {
  useUploadAvatarMutation,
  useUploadCccdMutation,
  useUploadRegisterCccdMutation,
  useUploadRealAvatarMutation,
  useUploadImageToFolderMutation,
} = uploadApiSlice;
