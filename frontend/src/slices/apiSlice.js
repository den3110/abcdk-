import { fetchBaseQuery, createApi } from "@reduxjs/toolkit/query/react";
import { logout } from "./authSlice";             // chỉnh path nếu khác

/* baseQuery gốc (gửi cookie) */
const rawBaseQuery = fetchBaseQuery({
  baseUrl: import.meta.env.VITE_API_URL,
  credentials: "include",
});

/* Wrapper: bắt 401 → logout + reset cache */
const baseQuery = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  if (result.error?.status === 401) {
    api.dispatch(logout());                       // xoá Redux + localStorage
    api.dispatch(apiSlice.util.resetApiState());  // dọn cache RTK Query

    // (tuỳ chọn) chuyển về trang login:
    // window.location.href = "/login";
  }
  return result;
};

/* RTK Query slice */
export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: ["User"],
  endpoints: () => ({}),
});
