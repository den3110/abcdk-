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
      invalidatesTags: [{ type: "Rankings", id: "LIST" }],
    }),
  }),
});

export const { useCreateEvaluationMutation } = evaluationsApiSlice;
