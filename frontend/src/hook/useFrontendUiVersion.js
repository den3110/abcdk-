import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";

import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";

const SUPPORTED_FRONTEND_UI_VERSIONS = new Set(["v1", "v2", "v3"]);

export default function useFrontendUiVersion() {
  const { data } = useGetAppInitQuery();
  const [searchParams] = useSearchParams();
  const publicUi = data?.publicUi;
  const queryVersion = String(searchParams.get("ui") || "")
    .trim()
    .toLowerCase();

  return useMemo(() => {
    const configuredVersion = String(publicUi?.frontendVersion || "v1")
      .trim()
      .toLowerCase();
    const rawVersion = SUPPORTED_FRONTEND_UI_VERSIONS.has(queryVersion)
      ? queryVersion
      : configuredVersion;
    const version = SUPPORTED_FRONTEND_UI_VERSIONS.has(rawVersion)
      ? rawVersion
      : "v1";

    return {
      version,
      effectiveVersion: version,
      isLegacyVersion: version === "v1",
      isModernVersion: version === "v2" || version === "v3",
      isV2Version: version === "v2",
      isV3Version: version === "v3",
      pikoraEnabled: publicUi ? publicUi.pikoraEnabled !== false : false,
    };
  }, [publicUi, queryVersion]);
}
