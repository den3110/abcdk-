import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  userInfo: localStorage.getItem("userInfo")
    ? JSON.parse(localStorage.getItem("userInfo"))
    : null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    /* Lưu / cập nhật hồ sơ sau login hoặc refetch profile */
    setCredentials: (state, { payload }) => {
      state.userInfo = payload;
      localStorage.setItem("userInfo", JSON.stringify(payload));
    },

    /* Đăng xuất – dọn sạch mọi thứ trong storage */
    logout: (state) => {
      state.userInfo = null;
      localStorage.clear(); // xoá toàn bộ key app đã lưu
      sessionStorage.clear(); // (nếu có dùng)
    },
  },
});

export const { setCredentials, logout } = authSlice.actions;
export default authSlice.reducer;
