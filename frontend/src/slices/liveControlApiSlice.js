import { apiSlice } from "./apiSlice";

// Điều khiển luồng live từ web pickletour.vn (admin).
// Web → backend proxy → control-server desktop (Tailscale). Giống bản mobile.
export const liveControlApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Danh sách máy PC live đã đăng ký (online trước).
    getLiveMachines: builder.query({
      query: () => `/api/live-control/machines`,
      keepUnusedDataFor: 10,
    }),
    // Gọi 1 lệnh tới control-server của máy (path = endpoint control-server desktop).
    liveControlCall: builder.mutation({
      query: ({ machineId, path, method = "GET", body }) => ({
        url: `/api/live-control/${encodeURIComponent(machineId)}/call`,
        method: "POST",
        body: { path, method, body: body || {} },
      }),
    }),
  }),
});

export const { useGetLiveMachinesQuery, useLiveControlCallMutation } =
  liveControlApiSlice;
