import { useMemo } from "react";

import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";
import { CAP_ENV_ENABLED } from "../utils/cap.js";

export default function useCapEnabled() {
  const { data } = useGetAppInitQuery();

  return useMemo(() => {
    if (!CAP_ENV_ENABLED) return false;
    return data?.publicUi?.captchaEnabled !== false;
  }, [data?.publicUi?.captchaEnabled]);
}
