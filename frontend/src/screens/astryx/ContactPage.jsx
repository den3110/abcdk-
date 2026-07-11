/**
 * ContactPage — trang Liên hệ phong cách Astryx (trong ShadowFrame, dark).
 * Data từ CMS (/api/cms/contact): 3 kênh hỗ trợ (chung / giải đấu-chấm điểm /
 * hợp tác), địa chỉ, mạng xã hội, và khu TẢI ỨNG DỤNG (App Store / Google Play /
 * APK trực tiếp / app trọng tài / app live). Có fallback khi CMS lỗi.
 * ?ui=v1 tại route này ra trang cũ (gate ở ContactScreen.jsx).
 */
import "@fontsource-variable/figtree";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { Text } from "@astryxdesign/core/Text";
import {
  ClipboardCheck,
  Download,
  Facebook,
  Handshake,
  LifeBuoy,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  Radio,
  Smartphone,
  Youtube,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import ShadowFrame from "./ShadowFrame.jsx";
import SiteNav from "./SiteNav.jsx";
import SiteFooter from "./SiteFooter.jsx";
import PickleMark from "./PickleMark.jsx";
import { useGetContactContentQuery } from "../../slices/cmsApiSlice.js";

/* ------------------------------- helpers ------------------------------- */
const Container = ({ children, style }) => (
  <div style={{ maxWidth: 1180, margin: "0 auto", padding: "0 24px", ...style }}>
    {children}
  </div>
);

const FALLBACK = {
  address: "Việt Nam",
  phone: "0932471990",
  email: "support@pickletour.vn",
  support: {
    generalEmail: "support@pickletour.vn",
    generalPhone: "0932471990",
    scoringEmail: "support@pickletour.vn",
    scoringPhone: "0932471990",
    salesEmail: "support@pickletour.vn",
  },
  socials: {},
  apps: {},
};

const clean = (s) => {
  const v = String(s || "").trim();
  return v && v !== "#" ? v : "";
};

/* dòng liên hệ trong card: mailto/tel bấm được */
function ContactLine({ icon: Ico, href, label }) {
  if (!label) return null;
  return (
    <a
      href={href}
      style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none", color: "#C9CDD2", fontSize: 14, fontWeight: 550, padding: "5px 0" }}
    >
      <Ico size={14.5} style={{ opacity: 0.75, flexShrink: 0 }} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </a>
  );
}

function SupportCard({ icon: Ico, title, desc, children, index }) {
  return (
    <div
      className="pk-tcard pk-reveal-card"
      style={{
        borderRadius: 18,
        border: "1px solid var(--color-border)",
        background: "var(--color-background-surface)",
        padding: "22px 20px 18px",
        animationDelay: `${index * 0.06}s`,
      }}
    >
      <span style={{ width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center", background: "rgba(61,135,255,.12)", color: "#7FB3FF", border: "1px solid rgba(61,135,255,.25)" }}>
        <Ico size={19} />
      </span>
      <div style={{ marginTop: 14, color: "#F0F1F3", fontWeight: 750, fontSize: 16.5 }}>{title}</div>
      <div style={{ marginTop: 6, color: "#9AA0A6", fontSize: 13.5, lineHeight: 1.5, minHeight: 40 }}>{desc}</div>
      <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,.07)", paddingTop: 8 }}>{children}</div>
    </div>
  );
}

/* nút tải app */
function AppBtn({ icon: Ico, label, sub, href }) {
  if (!clean(href)) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="pk-pill"
      style={{ display: "inline-flex", alignItems: "center", gap: 11, padding: "11px 18px 11px 14px", borderRadius: 14, textDecoration: "none", background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.10)" }}
    >
      <Ico size={22} color="#E6E8EA" style={{ flexShrink: 0 }} />
      <span>
        <span style={{ display: "block", fontSize: 11, color: "#8F959C", fontWeight: 650, letterSpacing: ".03em" }}>{sub}</span>
        <span style={{ display: "block", fontSize: 14.5, color: "#F0F1F3", fontWeight: 700, marginTop: 1 }}>{label}</span>
      </span>
    </a>
  );
}

/* ================================= PAGE ================================= */
export default function ContactPage() {
  const { data } = useGetContactContentQuery();
  // slice đã transformResponse unwrap sẵn res.data -> data chính là object contact
  const c = { ...FALLBACK, ...(data || {}) };
  const sup = { ...FALLBACK.support, ...(c.support || {}) };
  const socials = c.socials || {};
  const apps = c.apps || {};

  const socialItems = [
    [Facebook, "Facebook", clean(socials.facebook)],
    [Youtube, "YouTube", clean(socials.youtube)],
    [MessageCircle, "Zalo", clean(socials.zalo)],
  ].filter(([, , href]) => href);

  return (
    <>
      <SEOHead
        title="Liên hệ — PickleTour"
        description="Liên hệ đội ngũ PickleTour: hỗ trợ kỹ thuật, giải đấu, chấm điểm và hợp tác."
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div style={{ minHeight: "100vh", background: "var(--color-background-body)" }}>
            <SiteNav />

            {/* page head */}
            <div style={{ position: "relative", overflow: "hidden" }}>
              <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(46% 62% at 76% 4%, rgba(61,135,255,.12), transparent 62%)" }} />
              <div aria-hidden className="pk-spin-slow" style={{ position: "absolute", right: -140, top: -130, opacity: 0.06, color: "var(--color-brand, #3D87FF)", pointerEvents: "none" }}>
                <PickleMark size={440} />
              </div>
              <Container style={{ position: "relative", zIndex: 2 }}>
                <div style={{ padding: "76px 0 46px" }}>
                  <h1
                    className="pk-rise"
                    style={{ margin: 0, fontWeight: 750, fontSize: "clamp(42px, 6.4vw, 84px)", lineHeight: 1.02, letterSpacing: "-0.028em", color: "#F5F6F7" }}
                  >
                    Liên hệ
                    <br />
                    <span style={{ color: "var(--color-brand, #3D87FF)" }}>với PickleTour.</span>
                  </h1>
                  <div className="pk-rise" style={{ maxWidth: 620, marginTop: 22, animationDelay: ".14s" }}>
                    <Text type="large" color="secondary">
                      Hỗ trợ kỹ thuật, vận hành giải đấu và hợp tác — đội ngũ phản hồi trong giờ hành chính.
                    </Text>
                  </div>
                </div>
              </Container>
            </div>

            <Container>
              {/* 3 kênh hỗ trợ */}
              <div className="pk-3col" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 18 }}>
                <SupportCard icon={LifeBuoy} title="Hỗ trợ chung" desc="Tài khoản, đăng ký thi đấu, sự cố khi dùng nền tảng." index={0}>
                  <ContactLine icon={Mail} href={`mailto:${sup.generalEmail}`} label={sup.generalEmail} />
                  <ContactLine icon={Phone} href={`tel:${sup.generalPhone}`} label={sup.generalPhone} />
                </SupportCard>
                <SupportCard icon={ClipboardCheck} title="Giải đấu & chấm điểm" desc="Điểm trình, kết quả trận, khiếu nại trong giải." index={1}>
                  <ContactLine icon={Mail} href={`mailto:${sup.scoringEmail}`} label={sup.scoringEmail} />
                  <ContactLine icon={Phone} href={`tel:${sup.scoringPhone}`} label={sup.scoringPhone} />
                </SupportCard>
                <SupportCard icon={Handshake} title="Hợp tác & tài trợ" desc="Tổ chức giải, tài trợ, truyền thông và đối tác sân bãi." index={2}>
                  <ContactLine icon={Mail} href={`mailto:${sup.salesEmail}`} label={sup.salesEmail} />
                  {clean(c.address) && <ContactLine icon={MapPin} href="#" label={c.address} />}
                </SupportCard>
              </div>

              {/* mạng xã hội */}
              {socialItems.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 26, flexWrap: "wrap" }}>
                  <Text type="supporting" color="secondary">Theo dõi PickleTour:</Text>
                  {socialItems.map(([Ico, label, href]) => (
                    <a
                      key={label}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="pk-pill"
                      style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 36, padding: "0 15px", borderRadius: 999, textDecoration: "none", background: "rgba(255,255,255,.06)", color: "#DFE2E5", fontSize: 13.5, fontWeight: 650, border: "1px solid rgba(255,255,255,.09)" }}
                    >
                      <Ico size={15} />
                      {label}
                    </a>
                  ))}
                </div>
              )}

              {/* tải ứng dụng */}
              {(clean(apps.appStore) || clean(apps.playStore) || clean(apps.apkPickleTour) || clean(apps.apkReferee) || clean(apps.liveAppApk)) && (
                <div style={{ margin: "56px 0 84px", borderRadius: 20, border: "1px solid var(--color-border)", background: "var(--color-background-surface)", padding: "30px 26px", position: "relative", overflow: "hidden" }}>
                  <div aria-hidden style={{ position: "absolute", inset: 0, background: "radial-gradient(50% 80% at 90% 0%, rgba(61,135,255,.10), transparent 70%)", pointerEvents: "none" }} />
                  <div style={{ position: "relative" }}>
                    <div style={{ color: "#F0F1F3", fontWeight: 750, fontSize: "clamp(22px, 2.6vw, 30px)", letterSpacing: "-0.015em" }}>
                      Mang PickleTour ra sân
                    </div>
                    <div style={{ marginTop: 8, maxWidth: 560 }}>
                      <Text type="body" color="secondary">
                        Ứng dụng cho vận động viên, trọng tài và đội livestream — cài bản phù hợp với bạn.
                      </Text>
                    </div>
                    <div style={{ display: "flex", gap: 12, marginTop: 22, flexWrap: "wrap" }}>
                      <AppBtn icon={Smartphone} sub="TẢI TRÊN" label="App Store" href={apps.appStore} />
                      <AppBtn icon={Smartphone} sub="TẢI TRÊN" label="Google Play" href={apps.playStore} />
                      <AppBtn icon={Download} sub="APK TRỰC TIẾP" label="PickleTour" href={apps.apkPickleTour} />
                      <AppBtn icon={ClipboardCheck} sub="APK TRỰC TIẾP" label="App Trọng tài" href={apps.apkReferee} />
                      <AppBtn icon={Radio} sub="APK TRỰC TIẾP" label="App Live" href={apps.liveAppApk} />
                    </div>
                  </div>
                </div>
              )}
            </Container>

            <SiteFooter />
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
