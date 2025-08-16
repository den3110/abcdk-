import { apiSlice } from "./apiSlice";
import { setCredentials } from "./authSlice";

const USERS_URL = "/api/users";

export const userApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    login: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/auth`,
        method: "POST",
        body: data,
      }),
    }),
    logout: builder.mutation({
      query: () => ({
        url: `${USERS_URL}/logout`,
        method: "POST",
      }),
    }),
    register: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}`,
        method: "POST",
        body: data,
      }),
    }),
    updateUser: builder.mutation({
      query: (data) => ({
        url: `${USERS_URL}/profile`,
        method: "PUT",
        body: data,
      }),
    }),
    getPublicProfile: builder.query({
      query: (id) => `${USERS_URL}/${id}/public`,
    }),
    getRatingHistory: builder.query({
      query: (id) => `/api/users/${id}/ratings`,
    }),
    getMatchHistory: builder.query({
      query: (id) => `/api/users/${id}/matches`,
    }),
    getProfile: builder.query({
      query: () => "/api/users/profile",
      providesTags: ["User"],
      keepUnusedDataFor: 0, // bỏ cache ngay khi không còn subscriber
      // Luôn refetch khi có subscriber mới (VD: vào lại ProfileScreen)
      forceRefetch() {
        return true;
      },
      async onQueryStarted(arg, { dispatch, getState, queryFulfilled }) {
        try {
          const { data } = await queryFulfilled; // profile từ server
          const prev = getState().auth?.userInfo || {};
          const next = { ...prev, ...data };
          if (!data?.token && prev?.token) next.token = prev.token;
          dispatch(setCredentials(next));
        } catch {
          // ignore lỗi để không đụng state auth
        }
      },
    }),
    searchUser: builder.query({
      query: (q) => `/api/users/search?q=${encodeURIComponent(q)}`,
    }),
  }),
});

export const {
  useLoginMutation,
  useLogoutMutation,
  useRegisterMutation,
  useUpdateUserMutation,
  useGetPublicProfileQuery,
  useGetRatingHistoryQuery,
  useGetMatchHistoryQuery,
  useGetProfileQuery,
  useLazyGetProfileQuery,
  useLazySearchUserQuery,
} = userApiSlice;
