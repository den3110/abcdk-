import { createSlice } from "@reduxjs/toolkit";

const slice = createSlice({
  name: "adminUi",
  initialState: { page: 0, keyword: "", role: "" },
  reducers: {
    setPage: (s, { payload }) => void (s.page = payload),
    setKeyword: (s, { payload }) => {
      s.keyword = payload;
      s.page = 0;
    },
    setRole: (s, { payload }) => {
      s.role = payload;
      s.page = 0;
    },
  },
});

export const { setPage, setKeyword, setRole } = slice.actions;
export default slice.reducer;
