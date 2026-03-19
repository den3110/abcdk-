import { apiSlice } from "./apiSlice";

export const oauthApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getOAuthAuthorizeContext: builder.query({
      query: (search) => ({
        url: `/api/oauth/authorize/context${search ? `?${search}` : ""}`,
        method: "GET",
      }),
      keepUnusedDataFor: 0,
    }),
    approveOAuthAuthorize: builder.mutation({
      query: (body) => ({
        url: "/api/oauth/authorize/approve",
        method: "POST",
        body,
      }),
    }),
  }),
});

export const {
  useGetOAuthAuthorizeContextQuery,
  useApproveOAuthAuthorizeMutation,
} = oauthApiSlice;
