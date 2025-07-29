import { apiSlice } from './apiSlice';

export const rankingsApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    getRankings: builder.query({
      query: (keyword = '') => `/api/rankings?keyword=${keyword}`,
      providesTags: ['Rankings'],
    }),
  }),
});

export const { useGetRankingsQuery } = rankingsApiSlice;
