// src/slices/refereeScopeApiSlice.js
import { apiSlice } from "./apiSlice";

// Nếu bạn đã có utils enc() thì import; nếu chưa có, dùng fallback
// import { enc } from "../utils/http";
const enc = (v) => (v == null ? "" : encodeURIComponent(String(v)));

export const refereeScopeApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    /** Lấy danh sách trọng tài thuộc phạm vi 1 giải (User.role='referee'
     *  và user.referee.tournaments có chứa tournamentId)
     *  GET /admin/tournaments/:tid/referees?q=<search>&limit=<n>
     */
    listTournamentReferees: builder.query({
      // args: { tid, q?, limit? }
      query: ({ tid, q = "", limit = 50 }) => ({
        url: `/api/admin/tournaments/${enc(tid)}/referees`,
        params: { q, limit },
      }),
      transformResponse: (res) => res?.items ?? res ?? [],
      providesTags: (_res, _err, arg) => [
        { type: "TOURNAMENT_REFEREES", id: arg?.tid },
      ],
    }),

    /** Batch gán trọng tài cho nhiều trận
     *  POST /admin/matches/batch/update-referee
     *  body: { ids: string[], referees: string[] }
     */
    batchAssignReferee: builder.mutation({
      query: ({ ids, referees }) => ({
        url: `/api/admin/matches/batch/update-referee`,
        method: "POST",
        body: { ids, referees },
      }),
      // sau khi gán xong thường bạn sẽ refetch MATCHES ở các list
      invalidatesTags: (res, err, { ids = [] }) =>
        ids.map((id) => ({ type: "MatchReferees", id })),
    }),
    // Upsert trọng tài cho giải (POST /api/admin/tournaments/:tid/referees)
    upsertTournamentReferees: builder.mutation({
      /**
       * @param {Object} args
       * @param {string} args.tid - tournament id (bắt buộc)
       * @param {string[]=} args.set   - (OPTION 1) thay thế toàn bộ list
       * @param {string[]=} args.add   - (OPTION 2) thêm
       * @param {string[]=} args.remove- (OPTION 2) bớt
       */
      query: ({ tid, set, add = [], remove = [] }) => {
        if (!tid) throw new Error("tid is required");
        const body = Array.isArray(set) ? { set } : { add, remove };
        return {
          url: `/api/admin/tournaments/${tid}/referees`,
          method: "POST",
          body,
        };
      },
      // Sau khi upsert, làm mới danh sách trọng tài của giải
      invalidatesTags: (result, error, { tid }) => [
        { type: "TournamentReferees", id: tid },
      ],
    }),
  }),

  overrideExisting: false,
});

export const {
  useListTournamentRefereesQuery,
  useBatchAssignRefereeMutation,
  useUpsertTournamentRefereesMutation,
} = refereeScopeApiSlice;
