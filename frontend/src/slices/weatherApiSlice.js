// src/slices/weatherApiSlice.js
import { apiSlice } from "./apiSlice";

export const weatherApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    // GET /api/weather/tournament/:tid
    getTournamentWeather: builder.query({
      query: (tournamentId) => `/api/weather/tournament/${tournamentId}`,
      // có thể thêm keepUnusedDataFor / providesTags nếu cần
      // keepUnusedDataFor: 60,
    }),
  }),
  // nếu muốn override existing endpoints thì set overrideExisting: true
});

export const { useGetTournamentWeatherQuery } = weatherApiSlice;
