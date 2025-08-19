// src/slices/cmsApiSlice.js
import { apiSlice } from "./apiSlice";

export const cmsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getHeroContent: builder.query({
      query: () => ({ url: "/api/cms/hero", method: "GET" }),
      providesTags: ["CMS_HERO"],
      transformResponse: (res) => res?.data || res?.data === undefined ? res?.data : res?.data,
    }),
     // 🆕 Contact
    getContactContent: builder.query({
      query: () => ({ url: "/api/cms/contact", method: "GET" }),
      transformResponse: (res) => res?.data ?? res,
      providesTags: ["CMS_CONTACT"],
    }),
  }),
});

export const { useGetHeroContentQuery, useGetContactContentQuery } = cmsApiSlice;
