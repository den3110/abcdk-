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
        // FE-only
        keyword = "",
        page = 0,
        limit = LIMIT,
      } = {}) => {
        // giữ nguyên params cũ cho khỏi ảnh hưởng nơi khác (backend sẽ ignore)
        const params = new URLSearchParams({
          statuses: statuses,
          windowMs: windowMs.toString(),
          concurrency: concurrency.toString(),
        });

        if (excludeFinished === false) {
          params.append("excludeFinished", "false");
        }

        return `/api/live/matches?${params.toString()}`;
      },

      keepUnusedDataFor: 30,

      transformResponse: (resp, meta, arg) => {
        const { keyword = "", page = 0, limit = LIMIT } = arg || {};
        let items = Array.isArray(resp?.items) ? resp.items : [];

        // phòng hờ: pin live lên đầu
        const isLive = (m) => String(m?.status || "") === "live";
        items = [...items].sort((a, b) => {
          const s = Number(isLive(b)) - Number(isLive(a));
          if (s !== 0) return s;
          return (
            new Date(b?.updatedAt || 0).getTime() -
            new Date(a?.updatedAt || 0).getTime()
          );
        });

        const getPairNames = (pair) => {
          const p1 = pair?.player1?.user?.name;
          const p2 = pair?.player2?.user?.name;
          return [p1, p2].filter(Boolean).join(" ");
        };

        const kw = String(keyword || "").toLowerCase();
        if (kw) {
          items = items.filter((m) => {
            const hay = [
              m?.code,
              m?.displayCode,
              m?.labelKey,
              m?.courtLabel,
              m?.status,
              getPairNames(m?.pairA),
              getPairNames(m?.pairB),
              m?.facebookLive?.status,
              m?.facebookLive?.pageId,
              m?.facebookLive?.id,
              m?.facebookLive?.watch_url,
              m?.facebookLive?.permalink_url,
              m?.facebookLive?.video_permalink_url,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase();

            return hay.includes(kw);
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
          countLive: Number(resp?.countLive || 0),
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

export const { useGetLiveMatchesQuery, useDeleteLiveVideoMutation } =
  liveApiSlice;
