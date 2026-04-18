import { useMemo } from "react";

import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";

const SUPPORTED_FRONTEND_UI_VERSIONS = new Set(["v1", "v2", "v3"]);

export default function useFrontendUiVersion() {
  const { data } = useGetAppInitQuery();

  return useMemo(() => {
    const rawVersion = String(data?.publicUi?.frontendVersion || "v1")
      .trim()
      .toLowerCase();
    const version = SUPPORTED_FRONTEND_UI_VERSIONS.has(rawVersion)
      ? rawVersion
      : "v1";
    const effectiveVersion = version === "v3" ? "v2" : version;

    return {
      version,
      effectiveVersion,
      isLegacyVersion: effectiveVersion === "v1",
      isModernVersion: effectiveVersion === "v2",
    };
  }, [data?.publicUi?.frontendVersion]);
}
