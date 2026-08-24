/**
 * SiteFooter — footer DÙNG CHUNG cho các trang giao diện mới (Astryx, trong ShadowFrame).
 * Cột "Tài khoản" đổi theo trạng thái đăng nhập.
 */
import { useSelector } from "react-redux";
import { Text } from "@astryxdesign/core/Text";

import PickleMark from "./PickleMark.jsx";
import PickleWordmark from "./PickleWordmark.jsx";
import { A } from "./ui.jsx";

// Link cộng đồng chính thức của PickleTour.
const FANPAGE_URL = "https://www.facebook.com/pickletour2025/";
const ZALO_GROUP_URL = "https://zalo.me/g/yarnhm129";

const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1140, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

export default function SiteFooter() {
  const authed = Boolean(useSelector((s) => s.auth?.userInfo));
  const cols = [
    ["Sản phẩm", [["Giải đấu", "/pickle-ball/tournaments"], ["Bảng xếp hạng", "/pickle-ball/rankings"], ["Trực tiếp", "/live"], ["Câu lạc bộ", "/clubs"]]],
    [
      "Tài khoản",
      authed
        ? [["Hồ sơ", "/profile"], ["Giải của tôi", "/my-tournaments"], ["Đặt sân", "/my-bookings"]]
        : [["Đăng nhập", "/login"], ["Đăng ký", "/register"], ["Hồ sơ", "/profile"]],
    ],
    ["Hỗ trợ", [["Liên hệ", "/contact"], ["Trạng thái", "/status"], ["Tin tức", "/blog"]]],
    ["Pháp lý", [["Chính sách", "/privacy-and-policy"], ["Điều khoản", "/terms"], ["Cookies", "/cookies"]]],
  ];
  return (
    <div style={{ borderTop: "1px solid var(--color-border)", background: "var(--color-background-surface)" }}>
      <Container>
        <div style={{ padding: "64px 0 40px" }}>
          <div className="pk-foot" style={{ display: "grid", gridTemplateColumns: "1.6fr repeat(4, 1fr)", gap: 40 }}>
            <div style={{ maxWidth: 280 }}>
              <A href="/" aria-label="PickleTour" style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <PickleMark size={30} />
                <span style={{ display: "inline-block", width: 120, color: "var(--color-brand, #3D87FF)" }}><PickleWordmark id="ft" /></span>
              </A>
              <div style={{ marginTop: 16 }}><Text type="supporting" color="secondary">Nền tảng tổ chức, chấm điểm & phát sóng giải đấu pickleball cho cộng đồng Việt Nam.</Text></div>
            </div>
            {cols.map(([h, links]) => (
              <div key={h} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <Text type="supporting" weight="semibold">{h}</Text>
                {links.map(([label, href]) => (
                  <A key={href} href={href} style={{ textDecoration: "none" }}><Text type="supporting" color="secondary">{label}</Text></A>
                ))}
              </div>
            ))}
          </div>

          <div style={{ marginTop: 44, display: "flex", flexDirection: "column", gap: 12 }}>
            <Text type="supporting" weight="semibold">Kết nối cộng đồng</Text>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <a
                href={FANPAGE_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 18px", borderRadius: 14, background: "#1877F2", color: "#fff", fontWeight: 700, fontSize: 14.5, textDecoration: "none" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.89v2.25h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"/></svg>
                Fanpage Facebook
              </a>
              <a
                href={ZALO_GROUP_URL}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "inline-flex", alignItems: "center", gap: 10, padding: "12px 18px", borderRadius: 14, background: "#0068FF", color: "#fff", fontWeight: 700, fontSize: 14.5, textDecoration: "none" }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C6.48 2 2 5.94 2 10.8c0 2.76 1.46 5.22 3.74 6.84-.13.98-.6 2.3-1.5 3.36-.2.24-.02.6.29.55 1.9-.32 3.36-1.02 4.3-1.6.98.26 2.03.4 3.17.4 5.52 0 10-3.94 10-8.8S17.52 2 12 2z"/></svg>
                Nhóm Zalo
              </a>
            </div>
          </div>

          <div style={{ height: 40 }} />
          <div style={{ borderTop: "1px solid var(--color-border)", paddingTop: 24, display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <Text type="supporting" color="tertiary">© {new Date().getFullYear()} PickleTour</Text>
            <Text type="supporting" color="tertiary">Dựng bằng React · Astryx</Text>
          </div>
        </div>
      </Container>
    </div>
  );
}
