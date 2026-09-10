/* eslint-disable react/prop-types */
import { useEffect } from "react";

import { useThemeMode } from "../../context/ThemeContext.jsx";
import { usePkTheme } from "../astryx/theme.js";

export default function V3AuthSurface({ children }) {
  const pkTheme = usePkTheme();
  const { mode, setThemeMode } = useThemeMode();

  useEffect(() => {
    if (mode !== pkTheme) setThemeMode(pkTheme);
    // Đồng bộ một lần theo thay đổi theme; setter cố ý không đưa vào deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pkTheme]);

  return <div className="pk-v3-auth-shell">{children}</div>;
}
