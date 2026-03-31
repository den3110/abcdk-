import { apiSlice } from "./apiSlice";

const COMMAND_PALETTE_URL = "/api/command-palette";

export const commandPaletteApiSlice = apiSlice.injectEndpoints({
  endpoints: (builder) => ({
    assistCommandPalette: builder.query({
      query: (payload) => ({
        url: `${COMMAND_PALETTE_URL}/assist`,
        method: "POST",
        body: payload,
      }),
      keepUnusedDataFor: 0,
    }),
  }),
});

export const { useLazyAssistCommandPaletteQuery } = commandPaletteApiSlice;
