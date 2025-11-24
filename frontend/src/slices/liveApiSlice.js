import { apiSlice } from "./apiSlice";

const LIMIT = 12;

export const liveApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getLiveMatches: builder.query({
      query: ({
        statuses = "scheduled,queued,assigned,live",
        excludeFinished, // ← bỏ default value
        windowMs = 8 * 3600 * 1000,
        concurrency = 4,
      } = {}) => {
        // Build URL động
        const params = new URLSearchParams({
          statuses: statuses,
          windowMs: windowMs.toString(),
          concurrency: concurrency.toString(),
        });

        // Chỉ thêm excludeFinished khi có giá trị false
        if (excludeFinished === false) {
          params.append("excludeFinished", "false");
        }

        return `/api/live/matches?${params.toString()}`;
      },
      keepUnusedDataFor: 30,
      transformResponse: (resp, meta, arg) => {
        const { keyword = "", page = 0, limit = LIMIT } = arg || {};
        let items = Array.isArray(resp?.items) ? resp.items : [];

        const kw = String(keyword || "").toLowerCase();
        if (kw) {
          items = items.filter((it) => {
            const m = it.match || {};
            const platformStr = (it.platforms || []).join(" ");
            return (
              String(m.code || "")
                .toLowerCase()
                .includes(kw) ||
              String(m.labelKey || "")
                .toLowerCase()
                .includes(kw) ||
              String(m.courtLabel || "")
                .toLowerCase()
                .includes(kw) ||
              platformStr.toLowerCase().includes(kw)
            );
          });
        }

        const total = items.length;
        const pages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(Math.max(0, page), pages - 1);
        const start = safePage * limit;
        const pageItems = items.slice(start, start + limit);

        return {
          items: pageItems,
          total,
          page: safePage,
          pages,
          limit,
          meta: resp?.meta || {},
          rawCount: resp?.count ?? total,
        };
      },
    }),
     // ✅ Xoá video khỏi match (không xoá match)
    deleteLiveVideo: builder.mutation({
      query: (matchId) => ({
        url: `/api/live/matches/${matchId}/video`, // BE làm route này
        method: "DELETE",
      }),
      invalidatesTags: (result, error, matchId) => [
        { type: "LiveMatches", id: "LIST" },
        { type: "LiveMatch", id: matchId },
      ],
    }),
  }),
});

export const { useGetLiveMatchesQuery } = liveApiSlice;
