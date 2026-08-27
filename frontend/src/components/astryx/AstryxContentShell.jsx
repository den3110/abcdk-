/* eslint-disable react/prop-types */
// Khung Astryx (V2) cho các trang tính năng vốn viết bằng MUI (Bảng tin, Bạn bè,
// HLV, Thông báo…). MUI KHÔNG chạy được trong shadow DOM, nên ta chỉ đưa
// SiteNav + SiteFooter (thuần Astryx) vào ShadowFrame, còn nội dung MUI render ở
// DOM thường (theo theme dark/light chung của app). Nhờ vậy chuyển sang V2 vẫn
// có đầy đủ điều hướng + tính năng.
import { useEffect } from "react";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import ShadowFrame from "../../screens/astryx/ShadowFrame.jsx";
import SiteNav from "../../screens/astryx/SiteNav.jsx";
import SiteFooter from "../../screens/astryx/SiteFooter.jsx";
import { usePkTheme } from "../../screens/astryx/theme.js";
import { useThemeMode } from "../../context/ThemeContext.jsx";

export default function AstryxContentShell({ children }) {
  // Đồng bộ theme MUI (theme-mode, mặc định light) theo theme Astryx (pk-theme,
  // mặc định dark) để nội dung MUI hợp tông với SiteNav/Footer. Nút đổi theme ở
  // SiteNav chỉ đổi pk-theme → effect này kéo theo theme-mode.
  const pk = usePkTheme();
  const { mode, toggleTheme } = useThemeMode();
  useEffect(() => {
    if (mode !== pk) toggleTheme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk, mode]);

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Nav: host ShadowFrame đặt sticky để ghim đầu trang khi cuộn */}
      <ShadowFrame style={{ position: "sticky", top: 0, zIndex: 1000 }}>
        <Theme theme={neutralTheme}>
          <SiteNav />
        </Theme>
      </ShadowFrame>

      {/* Nội dung tính năng (MUI) — DOM thường */}
      <div className="astryx-content-host">{children}</div>

      <ShadowFrame>
        <Theme theme={neutralTheme}>
          <SiteFooter />
        </Theme>
      </ShadowFrame>
    </div>
  );
}

// Bọc điều kiện: V2 (Astryx) => shell; V1 => giữ nguyên (chrome global do App.jsx lo)
import useAstryxUi from "../../hook/useAstryxUi.js";
export function AstryxWrap({ children }) {
  const astryx = useAstryxUi();
  if (!astryx) return children;
  return <AstryxContentShell>{children}</AstryxContentShell>;
}
