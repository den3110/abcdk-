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
import useFrontendUiVersion from "../../hook/useFrontendUiVersion.js";
import "../../screens/v3/sport-v3-global.css";

export default function AstryxContentShell({ children, hideFooter = false, hideMobileNav = false, hideNav = false }) {
  // Đồng bộ theme MUI (theme-mode, mặc định light) theo theme Astryx (pk-theme,
  // mặc định dark) để nội dung MUI hợp tông với SiteNav/Footer. Nút đổi theme ở
  // SiteNav chỉ đổi pk-theme → effect này kéo theo theme-mode.
  const pk = usePkTheme();
  const { mode, setThemeMode } = useThemeMode();
  const { isV3Version } = useFrontendUiVersion();
  useEffect(() => {
    if (mode !== pk) setThemeMode(pk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pk, mode]);

  useEffect(() => {
    if (!isV3Version || typeof document === "undefined") return undefined;
    document.documentElement.dataset.pkPublicTheme = pk;
    return () => delete document.documentElement.dataset.pkPublicTheme;
  }, [isV3Version, pk]);

  return (
    <div
      className={
        isV3Version
          ? `pk-v3-content-shell${pk === "light" ? " is-light" : ""}`
          : undefined
      }
      style={{ minHeight: "100vh" }}
    >
      {/* Nav: host ShadowFrame đặt sticky để ghim đầu trang khi cuộn */}
      {!hideNav ? (
        <ShadowFrame style={{ position: "sticky", top: 0, zIndex: 1000 }}>
          <Theme theme={neutralTheme}>
            <SiteNav hideMobileNav={hideMobileNav} />
          </Theme>
        </ShadowFrame>
      ) : null}

      {/* Nội dung tính năng (MUI) — DOM thường */}
      <div className="astryx-content-host">{children}</div>

      {!hideFooter ? (
        <ShadowFrame>
          <Theme theme={neutralTheme}>
            <SiteFooter />
          </Theme>
        </ShadowFrame>
      ) : null}
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

// Chỉ bọc V3 cho các route tiện ích nằm ngoài App shell (ví dụ tài liệu API),
// không làm thay đổi cách hiển thị của V1/V2.
export function V3Wrap({ children, hideNav = false, hideFooter = false }) {
  const { isV3Version } = useFrontendUiVersion();
  if (!isV3Version) return children;
  return <AstryxContentShell hideNav={hideNav} hideFooter={hideFooter}>{children}</AstryxContentShell>;
}
