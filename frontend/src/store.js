import { configureStore } from "@reduxjs/toolkit";
import { setupListeners } from "@reduxjs/toolkit/query";
import authReducer from "./slices/authSlice";
import { apiSlice, rtkQueryLogoutListener } from "./slices/apiSlice";
import rankingUiReducer from "./slices/rankingUiSlice";
import adminUiReducer from "./slices/adminUiSlice";
import botContextReducer from "./slices/botContextSlice";

const store = configureStore({
  reducer: {
    [apiSlice.reducerPath]: apiSlice.reducer,
    auth: authReducer,
    adminUi: adminUiReducer,
    rankingUi: rankingUiReducer,
    botContext: botContextReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      apiSlice.middleware,
      rtkQueryLogoutListener.middleware,
    ),
  devTools: true,
});

setupListeners(store.dispatch);

export default store;
