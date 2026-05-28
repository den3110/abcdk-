import { apiSlice } from "./apiSlice";

const IDENTITY_SECURITY_URL = "/api/identity-security";

export const identitySecurityApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getIdentitySecurityOverview: builder.query({
      query: ({ days = 30, limit = 12 } = {}) => ({
        url: `${IDENTITY_SECURITY_URL}/overview`,
        params: { days, limit },
      }),
    }),
    getIdentitySecurityUser: builder.query({
      query: ({ userId, days = 30 }) => ({
        url: `${IDENTITY_SECURITY_URL}/users/${userId}`,
        params: { days },
      }),
    }),
    explainIdentitySecurityUser: builder.mutation({
      query: ({ userId, days = 30, audience = "admin" }) => ({
        url: `${IDENTITY_SECURITY_URL}/users/${userId}/explain`,
        method: "POST",
        body: { days, audience },
      }),
    }),
    getIdentitySecuritySettings: builder.query({
      query: () => `${IDENTITY_SECURITY_URL}/settings`,
    }),
    updateIdentitySecuritySettings: builder.mutation({
      query: (body) => ({
        url: `${IDENTITY_SECURITY_URL}/settings`,
        method: "PUT",
        body,
      }),
    }),
  }),
});

export const {
  useGetIdentitySecurityOverviewQuery,
  useGetIdentitySecurityUserQuery,
  useExplainIdentitySecurityUserMutation,
  useGetIdentitySecuritySettingsQuery,
  useUpdateIdentitySecuritySettingsMutation,
} = identitySecurityApiSlice;
