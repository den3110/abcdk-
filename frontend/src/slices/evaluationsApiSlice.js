// slices/evaluationsApiSlice.js
import { apiSlice } from "./apiSlice";

export const evaluationsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    createEvaluation: builder.mutation({
      query: (body) => ({
        url: "/api/users/evaluations",
        method: "POST",
        body,
      }),
      invalidatesTags: (_result, _error, arg) => [
        { type: "Rankings", id: "LIST" },
        { type: "RatingHistory", id: arg?.targetUser || "LIST" },
        { type: "AssessmentHistory", id: arg?.targetUser || "LIST" },
        "AssessmentHistory",
      ],
    }),
  }),
});

export const { useCreateEvaluationMutation } = evaluationsApiSlice;
