// src/slices/botContextSlice.js
import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  matchId: null,
  tournamentId: null,
  courtCode: null,
};

const botContextSlice = createSlice({
  name: "botContext",
  initialState,
  reducers: {
    setBotContext(state, action) {
      const { matchId, tournamentId, courtCode } = action.payload || {};

      if (matchId !== undefined) {
        state.matchId = matchId;
      }
      if (tournamentId !== undefined) {
        state.tournamentId = tournamentId;
      }
      if (courtCode !== undefined) {
        state.courtCode = courtCode;
      }
    },
    clearBotContext() {
      return initialState;
    },
  },
});

export const { setBotContext, clearBotContext } = botContextSlice.actions;
export default botContextSlice.reducer;
