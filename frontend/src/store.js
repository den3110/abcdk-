import { configureStore } from "@reduxjs/toolkit";
import authReducer from "./slices/authSlice";
import { apiSlice, rtkQueryLogoutListener } from "./slices/apiSlice";
import rankingUiReducer from "./slices/rankingUiSlice";
import adminUiReducer from "./slices/adminUiSlice";

const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    auth: authReducer,
    adminUi: adminUiReducer,
    rankingUi: rankingUiReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      apiSlice.middleware,
      rtkQueryLogoutListener.middleware
    ),
  devTools: true,
});

export default store;
