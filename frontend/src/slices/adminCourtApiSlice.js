// src/slices/adminCourtApiSlice.js
import { apiSlice } from "./apiSlice";

// ==== Helpers: chuẩn hoá id & encode an toàn ====
const asId = (v) =>
  typeof v === "string"
    ? v
    : v?._id ||
      v?.id ||
      (v && typeof v.toHexString === "function" ? v.toHexString() : "");

const enc = (v) => encodeURIComponent(v || "");

export const adminCourtApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // Upsert danh sách sân theo BRACKET (names[] hoặc count)
    upsertCourts: builder.mutation({
      // { tournamentId, bracket, names?: string[], count?: number, autoAssign?: boolean }
      query: ({ tournamentId, bracket, names, count, autoAssign }) => {
        const tid = asId(tournamentId);
        const bid = asId(bracket);

        const body = {
          bracket: bid,
          ...(Array.isArray(names) && names.length ? { names } : {}),
          ...(Number.isInteger(count) ? { count } : {}),
          ...(typeof autoAssign !== "undefined"
            ? { autoAssign: !!autoAssign }
            : {}),
        };

        return {
          url: `/api/admin/tournaments/${enc(tid)}/courts`,
          method: "POST",
          body,
        };
      },
      transformResponse: (res) => res?.items ?? res, // BE có trả meta.autoAssignApplied; vẫn giữ items như cũ
      invalidatesTags: ["ADMIN_COURTS", "ADMIN_QUEUE"],
    }),

    // Build hàng đợi vòng bảng theo lượt A1,B1,C1,D1… rồi A2,B2…
    buildGroupsQueue: builder.mutation({
      // { tournamentId, bracket }
      query: ({ tournamentId, bracket }) => {
        const tid = asId(tournamentId);
        const bid = asId(bracket);
        return {
          url: `/api/admin/tournaments/${enc(tid)}/queue/groups/build`,
          method: "POST",
          body: { bracket: bid },
        };
      },
      transformResponse: (res) => res ?? {},
      invalidatesTags: ["ADMIN_QUEUE"],
    }),

    // HTTP assign next (fallback nếu muốn, mặc định dùng socket)
    assignNextHttp: builder.mutation({
      // { tournamentId, courtId, bracket }
      query: ({ tournamentId, courtId, bracket }) => {
        const tid = asId(tournamentId);
        const cid = asId(courtId);
        const bid = asId(bracket);
        return {
          url: `/api/admin/tournaments/${enc(tid)}/courts/${enc(cid)}/assign-next`,
          method: "POST",
          body: { bracket: bid },
        };
      },
      transformResponse: (res) => res ?? {},
      invalidatesTags: ["ADMIN_QUEUE", "ADMIN_COURTS"],
    }),

    // Free court
    freeCourtHttp: builder.mutation({
      // { tournamentId, courtId }
      query: ({ tournamentId, courtId }) => {
        const tid = asId(tournamentId);
        const cid = asId(courtId);
        return {
          url: `/api/admin/tournaments/${enc(tid)}/courts/${enc(cid)}/free`,
          method: "POST",
        };
      },
      transformResponse: (res) => res ?? {},
      invalidatesTags: ["ADMIN_QUEUE", "ADMIN_COURTS"],
    }),

    // Lấy scheduler state theo BRACKET (fallback/polling)
    getSchedulerState: builder.query({
      // { tournamentId, bracket }
      query: ({ tournamentId, bracket }) => {
        const tid = asId(tournamentId);
        const bid = asId(bracket);
        return {
          url: `/api/admin/tournaments/${enc(tid)}/courts/state?bracket=${enc(
            bid
          )}`,
          method: "GET",
        };
      },
      transformResponse: (res) => res ?? { courts: [], matches: [] },
      providesTags: ["ADMIN_QUEUE", "ADMIN_COURTS"],
    }),

    // ===== Matches (ưu tiên theo bracket nếu có) =====
    listMatches: builder.query({
      // args: { tournamentId?, bracket?, status?, limit?, page?, type?, stage?, court?, sort?, q? }
      query: (args = {}) => {
        const {
          tournamentId: rawTid,
          bracket: rawBid,
          status,
          limit,
          page,
          type,
          stage,
          court,
          sort,
          q,
        } = args;

        const tid = asId(rawTid);
        const bid = asId(rawBid);

        // chỉ đẩy primitive params hợp lệ
        const params = {};
        if (!bid && tid) params.tournamentId = tid; // nếu dùng route tournaments
        if (status) params.status = String(status);
        if (Number.isFinite(page)) params.page = Number(page);
        if (Number.isFinite(limit)) params.limit = Number(limit);
        if (type) params.type = String(type);
        if (Number.isFinite(stage)) params.stage = Number(stage);
        if (court) params.court = asId(court);
        if (sort) params.sort = String(sort);
        if (q) params.q = String(q);

        let url = "/api/admin/matches";
        if (bid) {
          // có bracket -> route theo bracket
          url = `/api/admin/brackets/${enc(bid)}/matches`;
        } else if (tid) {
          // không có bracket -> route theo tournament
          url = `/api/admin/tournaments/${enc(tid)}/matches`;
        }

        return { url, method: "GET", params };
      },
      transformResponse: (res) =>
        res?.items ?? res?.results ?? res?.rows ?? res ?? [],
      keepUnusedDataFor: 0, // bỏ cache khi unmount
      forceRefetch: () => true, // luôn refetch khi có subscriber mới
      providesTags: () => [{ type: "ADMIN_MATCHES", id: "LIST" }],
    }),
    // ⭐ NEW: Gán 1 trận cụ thể vào 1 sân
    assignSpecificHttp: builder.mutation({
      query: ({ tournamentId, courtId, bracket, matchId, replace = true }) => ({
        url: `/api/admin/tournaments/${tournamentId}/courts/${courtId}/assign-specific`,
        method: "POST",
        body: { bracket, matchId, replace },
      }),
      invalidatesTags: [{ type: "Scheduler", id: "STATE" }],
    }),

    // ⭐ NEW: Reset tất cả sân & gỡ gán
    resetCourtsHttp: builder.mutation({
      query: ({ tournamentId, bracket }) => ({
        url: `/api/admin/tournaments/${tournamentId}/courts/reset`,
        method: "POST",
        body: { bracket },
      }),
      invalidatesTags: [{ type: "Scheduler", id: "STATE" }],
    }),
    // ⭐ NEW: Lấy matchesLite cho dialog gán trận
    getSchedulerMatchesLite: builder.query({
      // args: { tournamentId, bracket?, cluster?, includeCurrent?, statuses? }
      query: ({
        tournamentId,
        bracket,
        cluster = "Main",
        includeCurrent = true,
        statuses = ["scheduled", "queued", "assigned"],
      }) => {
        const params = {
          tournamentId: asId(tournamentId),
          ...(bracket ? { bracket: asId(bracket) } : { cluster }),
          includeCurrent: includeCurrent ? "1" : "0",
          statuses: Array.isArray(statuses)
            ? statuses.join(",")
            : String(statuses || ""),
        };
        return {
          url: `/api/admin/courts/matches`,
          method: "GET",
          params,
        };
      },
      transformResponse: (res) => res?.matches ?? [],
      // Mình để cache tối thiểu, mở dropdown là gọi lại
      keepUnusedDataFor: 0,
      providesTags: [{ type: "Scheduler", id: "STATE" }],
    }),
    adminListCourts: builder.query({
      /**
       * @param {{ tid: string, bracket?: string, q?: string, cluster?: string, limit?: number, page?: number }} args
       */
      query: ({ tid, bracket, q = "", cluster = "", limit, page }) => {
        if (!tid) throw new Error("tid is required");
        const params = new URLSearchParams();
        if (bracket) params.set("bracket", bracket);
        if (q) params.set("q", q);
        if (cluster) params.set("cluster", cluster);
        if (Number.isFinite(limit)) params.set("limit", String(limit));
        if (Number.isFinite(page)) params.set("page", String(page));
        const qs = params.toString();
        return {
          url: `/api/admin/tournaments/${tid}/courts${qs ? `?${qs}` : ""}`,
          method: "GET",
        };
      },
      // để các mutation khác (gán/bỏ gán sân) có thể invalidates
      providesTags: (result, error, { tid }) => [
        { type: "Courts", id: tid },
        // có thể expose từng court để fine-grain (tuỳ thích):
        ...(Array.isArray(result)
          ? result.map((c) => ({ type: "Court", id: c._id }))
          : []),
      ],
      keepUnusedDataFor: 30,
    }),
  }),

  // nếu file này được inject nhiều lần ở môi trường hot-reload:
  overrideExisting: true,
});

export const {
  useUpsertCourtsMutation,
  useBuildGroupsQueueMutation,
  useAssignNextHttpMutation,
  useFreeCourtHttpMutation,
  useGetSchedulerStateQuery,
  useListMatchesQuery,
  useAssignSpecificHttpMutation,
  useResetCourtsHttpMutation,
  useLazyGetSchedulerMatchesLiteQuery,
  useAdminListCourtsQuery,
} = adminCourtApiSlice;
