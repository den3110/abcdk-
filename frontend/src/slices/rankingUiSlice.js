// src/slices/rankingUiSlice.js
import { createSlice } from "@reduxjs/toolkit";

const slice = createSlice({
  name: "rankingUi",
  initialState: { page: 0, keyword: "" },
  reducers: {
    setPage: (s, { payload }) => void (s.page = payload),
    setKeyword: (s, { payload }) => {
      s.keyword = payload;
      s.page = 0;                 // reset về page 0 khi đổi keyword
    },
  },
});

export const { setPage, setKeyword } = slice.actions;
export default slice.reducer;
