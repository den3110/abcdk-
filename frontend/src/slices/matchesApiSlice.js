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
      invalidatesTags: (res, err, { id, tid }) => {
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
  }),
});

export const { useAdminPatchMatchMutation } = matchesApiSlice;
