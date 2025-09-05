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
      // không chắc rankings slice có tag, nên mình refetch thủ công ở UI
    }),
  }),
});

export const { useCreateEvaluationMutation } = evaluationsApiSlice;
