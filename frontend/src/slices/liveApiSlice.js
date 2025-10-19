import { apiSlice } from "./apiSlice"; // chỉnh đường dẫn đúng nơi bạn để apiSlice

const LIMIT = 12;

export const liveApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getLiveMatches: builder.query({
      // server không có keyword/page => lọc & phân trang client trong transformResponse
      query: ({
        statuses = "scheduled,queued,assigned,live",
        excludeFinished = true,
        windowMs = 8 * 3600 * 1000,
        concurrency = 4,
      } = {}) =>
        `/api/live/matches?statuses=${encodeURIComponent(
          statuses
        )}&excludeFinished=${excludeFinished}&windowMs=${windowMs}&concurrency=${concurrency}`,
      keepUnusedDataFor: 30,
      transformResponse: (resp, meta, arg) => {
        const { keyword = "", page = 0, limit = LIMIT } = arg || {};
        let items = Array.isArray(resp?.items) ? resp.items : [];

        // lọc keyword (client-side): match.code / match.labelKey / courtLabel / platform
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
  }),
});

export const { useGetLiveMatchesQuery } = liveApiSlice;
