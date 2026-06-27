import { apiSlice } from "./apiSlice"; // baseQuery đã set credentials

export const matchesApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    adminPatchMatch: builder.mutation({
      // 👇 cho phép truyền kèm tid để invalidates chính xác
      query: ({ id, body }) => ({
        url: `/api/matches/${id}/admin`,
        method: "PATCH",
        body,
      }),
      invalidatesTags: (res, err, { id }) => {
        const tags = [{ type: "Match", id }];

        // cố gắng suy ra tournament id từ nhiều nguồn:
        const tournamentId =
          res?.tournament || // nếu BE trả string id
          res?.tournamentId; // tuỳ BE

        if (tournamentId) {
          tags.push({ type: "TournamentMatches", id: tournamentId });
        }
        return tags;
      },
    }),
    adminSwapMatchTeams: builder.mutation({
      query: ({ id, targetMatchId }) => ({
        url: `/api/matches/${id}/admin/swap-teams`,
        method: "POST",
        body: { targetMatchId },
      }),
      invalidatesTags: (res, err, { id, targetMatchId }) => {
        const tags = [
          { type: "Match", id },
          { type: "Match", id: targetMatchId },
        ];
        const tournamentId = res?.tournament || res?.tournamentId;
        if (tournamentId) {
          tags.push({ type: "TournamentMatches", id: tournamentId });
        }
        return tags;
      },
    }),
  }),
});

export const {
  useAdminPatchMatchMutation,
  useAdminSwapMatchTeamsMutation,
} = matchesApiSlice;
