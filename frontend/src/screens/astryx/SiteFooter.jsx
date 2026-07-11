/**
 * SiteFooter — footer DÙNG CHUNG cho các trang giao diện mới (Astryx, trong ShadowFrame).
 * Cột "Tài khoản" đổi theo trạng thái đăng nhập.
 */
import { useSelector } from "react-redux";
import { Text } from "@astryxdesign/core/Text";

import PickleMark from "./PickleMark.jsx";
import PickleWordmark from "./PickleWordmark.jsx";
import { A } from "./ui.jsx";

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
