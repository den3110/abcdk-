// src/hooks/useBotContext.js
import { useEffect } from "react";
import { useDispatch } from "react-redux";
import { setBotContext, clearBotContext } from "../slices/botContextSlice";

export function useBotContext(ctx) {
  const dispatch = useDispatch();

  useEffect(() => {
    dispatch(setBotContext(ctx || {}));
    return () => {
      // tuỳ bạn, có thể không clear
      dispatch(clearBotContext());
    };
  }, [dispatch, JSON.stringify(ctx || {})]);
}
