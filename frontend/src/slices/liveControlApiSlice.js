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
    // Tạo liên kết bình luận viên (mic → luồng live) cho 1 sân đang live.
    createCommentaryToken: builder.mutation({
      query: ({ machineId, sid, courtName }) => ({
        url: `/api/live-control/${encodeURIComponent(machineId)}/commentary-token`,
        method: "POST",
        body: { sid, courtName: courtName || "" },
      }),
    }),
  }),
});

export const {
  useGetLiveMachinesQuery,
  useLiveControlCallMutation,
  useCreateCommentaryTokenMutation,
} = liveControlApiSlice;
