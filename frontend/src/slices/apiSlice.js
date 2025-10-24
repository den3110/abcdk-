// src/slices/apiSlice.js
import { fetchBaseQuery, createApi } from "@reduxjs/toolkit/query/react";
import { logout, setCredentials } from "./authSlice"; // chỉnh path nếu khác
import { createListenerMiddleware } from "@reduxjs/toolkit";

/* baseQuery gốc (gửi cookie) */
const rawBaseQuery = fetchBaseQuery({
  baseUrl: import.meta.env.VITE_API_URL,
  credentials: "include",
});

/* Helper: chuyển qua trang /404 an toàn (SPA), lưu origin để hiển thị */
function redirectTo404() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/404")) return; // tránh vòng lặp

  try {
    const origin = window.location.pathname + window.location.search;
    sessionStorage.setItem("nf_origin", origin);
  } catch (e) {
    console.log(e);
  }

  try {
    // Điều hướng SPA để React Router render NotFound
    // window.history.pushState({}, "", "/404");
    // window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    // Fallback hard redirect
    // window.location.assign("/404");
  }
}

function redirectTo503() {
  if (typeof window === "undefined") return;
  if (window.location.pathname.startsWith("/503")) return; // tránh vòng lặp

  try {
    const origin = window.location.pathname + window.location.search;
    sessionStorage.setItem("nf_origin", origin);
  } catch (e) {
    console.log(e);
  }

  try {
    // Điều hướng SPA để React Router render NotFound
    window.history.pushState({}, "", "/503");
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    // Fallback hard redirect
    window.location.assign("/503");
  }
}

/* Wrapper: bắt 401 → logout + reset cache; 404 → redirect /404 */
const baseQuery = async (args, api, extraOptions) => {
  const result = await rawBaseQuery(args, api, extraOptions);

  const status = result?.error?.status;

  // 401: đăng xuất & dọn cache
  if (status === 401) {
    try {
      api.dispatch(logout());
      // lưu ý: apiSlice được gán sau, nhưng tới lúc hàm này chạy đã có giá trị
      api.dispatch(apiSlice.util.resetApiState());
    } catch (e) {
      console.log(e);
    }
    // (tuỳ chọn) chuyển về login:
    // if (typeof window !== "undefined") window.location.href = "/login";
    return result;
  }

  // 404: chuyển qua trang NotFound (trừ khi endpoint yêu cầu skip)
  // Có thể truyền cờ ở endpoint: builder.query({ ..., extraOptions: { skip404Redirect: true } })
  if (status === 404 && !extraOptions?.skip404Redirect) {
    redirectTo404();
  }
  if (status === 503) {
    redirectTo503();
  }

  return result;
};

/* RTK Query slice gốc (injectEndpoints ở các slice con) */
export const apiSlice = createApi({
  reducerPath: "api",
  baseQuery,
  tagTypes: [
    "User",
    "Match",
    "Bracket",
    "Tournament",
    "Registration",
    "TournamentMatches",
    "Club",
    "ClubMember",
    "JoinRequest",
  ],
  endpoints: () => ({}),
});

export default apiSlice;

/** Middleware: nghe action logout và reset toàn bộ cache RTK Query */
export const rtkQueryLogoutListener = createListenerMiddleware();

rtkQueryLogoutListener.startListening({
  actionCreator: logout,
  effect: async (_action, { dispatch }) => {
    // Hủy mọi request đang chạy + xoá cache queries/mutations + gỡ subscriptions
    dispatch(apiSlice.util.resetApiState());

    // (tuỳ chọn) dọn vài thứ lặt vặt trên storage nếu có
    try {
      sessionStorage.removeItem("nf_origin");
    } catch (e) {
      console.log(e);
    }
  },
});
