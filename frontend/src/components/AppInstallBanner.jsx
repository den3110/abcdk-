import { useEffect, useMemo, useRef, useState } from "react";
import { Container } from "react-bootstrap";

/* =========================================================
   AppInstallBanner (smart suggest top bar)
   - Detect iOS/Android
   - Show "Mở" if app installed, else "Tải"
   - iOS: memory flag via ?from_app=1
   - Android: navigator.getInstalledRelatedApps()
   - Snooze 2 days on "Để sau"
   - (Optional) Dismiss 14 days via DISMISS_KEY (giữ để mở rộng sau)
   - Only shows on mobile & when link exists
========================================================= */
function detectPlatform() {
  const ua = (navigator.userAgent || "").toLowerCase();
  const isAndroid = /android/.test(ua);
  const isIOS = /iphone|ipod|ipad/.test(ua);
  const isMobile = isAndroid || isIOS;
  const isStandalone =
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone;
  return { isAndroid, isIOS, isMobile, isStandalone };
}

const DISMISS_KEY = "pt_app_banner_dismissed_at"; // (14d) nếu cần dùng sau
const DISMISS_TTL_DAYS = 14;

const SNOOZE_KEY = "pt_app_banner_snoozed_at"; // (2d) cho "Để sau"
const SNOOZE_TTL_DAYS = 2;

const INSTALLED_FLAG = "pt_app_native_installed"; // ghi nhớ cho iOS

function daysToMs(d) {
  return d * 24 * 60 * 60 * 1000;
}

function shouldShowFromStorage() {
  try {
    const now = Date.now();

    // 1) Snooze ngắn hạn (2 ngày)
    const s = parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10);
    if (s && now - s <= daysToMs(SNOOZE_TTL_DAYS)) return false;

    // 2) Dismiss dài hạn (14 ngày) — hiện chưa set ở đâu, để sẵn nếu cần
    const ts = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
    if (ts && now - ts <= daysToMs(DISMISS_TTL_DAYS)) return false;

    return true;
  } catch {
    return true;
  }
}

async function detectInstalledAndroid(androidPackage) {
  try {
    if (!androidPackage) return false;
    const nav = /** @type {any} */ (navigator);
    if (typeof nav.getInstalledRelatedApps !== "function") return false;
    const apps = await nav.getInstalledRelatedApps();
    return !!apps?.find?.(
      (a) => a.platform === "play" && a.id === androidPackage
    );
  } catch {
    return false;
  }
}

export default function AppInstallBanner({ links }) {
  const { isAndroid, isIOS, isMobile, isStandalone } = detectPlatform();
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);
  const barRef = useRef(null);
  const [barH, setBarH] = useState(0);

  // inputs
  const hasIOS = !!links?.appStore;
  const hasAndroid = !!links?.playStore || !!links?.apkPickleTour;
  const androidPackage = links?.androidPackage || ""; // ví dụ "com.pico.picoapp"
  const deeplinkPath = links?.deeplinkPath || ""; // ví dụ "/u/123"
  const domain = links?.domain || ""; // ví dụ "https://yourdomain.com"

  // logo trong public (ổn với mọi base của Vite)
  const logoSrc = `${import.meta.env.BASE_URL}icon.png`;

  // build deeplink chuẩn HTTPS (Universal/App Links)
  const deeplinkUrl = useMemo(() => {
    if (!deeplinkPath) return "";
    if (deeplinkPath.startsWith("http")) return deeplinkPath;
    const host = domain || window.location.origin;
    return `${host}${deeplinkPath.startsWith("/") ? "" : "/"}${deeplinkPath}`;
  }, [deeplinkPath, domain]);

  // Store link fallback
  const storeHref = useMemo(() => {
    const utm =
      "utm_source=web-banner&utm_medium=smart-banner&utm_campaign=install";
    if (isIOS && hasIOS) {
      return links.appStore.includes("?")
        ? `${links.appStore}&${utm}`
        : `${links.appStore}?${utm}`;
    }
    if (isAndroid && hasAndroid) {
      const link = links.playStore || links.apkPickleTour;
      return link.includes("?") ? `${link}&${utm}` : `${link}?${utm}`;
    }
    return "";
  }, [isIOS, isAndroid, hasIOS, hasAndroid, links]);

  // Android intent URL (mở app nếu có, fallback về deeplink / store)
  const intentHref = useMemo(() => {
    if (!isAndroid || !deeplinkPath || !androidPackage) return "";
    const pathNoSlash = deeplinkPath.startsWith("/")
      ? deeplinkPath.slice(1)
      : deeplinkPath;
    const fallback = encodeURIComponent(
      deeplinkUrl || storeHref || window.location.href
    );
    return `intent://${pathNoSlash}#Intent;scheme=https;package=${androidPackage};S.browser_fallback_url=${fallback};end`;
  }, [isAndroid, deeplinkPath, androidPackage, deeplinkUrl, storeHref]);

  // === Ghi nhớ "đã có app" khi app redirect về web kèm flag (iOS workaround) ===
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("from_app") === "1" || sp.get("app_installed") === "1") {
      try {
        localStorage.setItem(INSTALLED_FLAG, "1");
      } catch {}
      setInstalled(true);
      return;
    }
    try {
      if (localStorage.getItem(INSTALLED_FLAG) === "1") setInstalled(true);
    } catch {}
  }, []);

  // === Android: detect thật bằng getInstalledRelatedApps ===
  useEffect(() => {
    if (!isAndroid) return;
    detectInstalledAndroid(androidPackage).then((ok) => {
      if (ok) setInstalled(true);
    });
  }, [isAndroid, androidPackage]);

  // === Hiển thị banner khi đủ điều kiện ===
  useEffect(() => {
    const can =
      isMobile &&
      !isStandalone &&
      !!(storeHref || deeplinkUrl) &&
      shouldShowFromStorage();
    setVisible(!!can);
  }, [isMobile, isStandalone, storeHref, deeplinkUrl]);

  // đo chiều cao spacer
  useEffect(() => {
    if (!visible) return;
    const ro = new ResizeObserver(() => {
      if (barRef.current) setBarH(barRef.current.offsetHeight || 0);
    });
    if (barRef.current) ro.observe(barRef.current);
    return () => ro.disconnect();
  }, [visible]);

  const onDismiss = () => {
    try {
      // Snooze 2 ngày
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch (e) {
      console.log(e);
    }
    setVisible(false);
  };

  if (!visible) return null;

  // Nút chính: nếu đã cài → "Mở" (iOS: deeplink, Android: intent)
  // nếu chưa → "Tải" (đi store)
  const primaryLabel = installed ? "Mở" : "Tải";
  const btnHref = installed
    ? (isAndroid ? intentHref || deeplinkUrl : deeplinkUrl) || storeHref
    : storeHref;

  // iOS deeplink KHÔNG target để Universal Link hoạt động
  const btnTarget = installed && !isAndroid ? undefined : "_blank";
  const btnRel = btnTarget ? "noopener noreferrer" : undefined;

  return (
    <>
      <div
        ref={barRef}
        className="position-fixed bottom-0 start-0 end-0"
        style={{
          zIndex: 1050,
          background: "linear-gradient(90deg, #111827, #0b1220)",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(0,0,0,0.28)",
        }}
      >
        <Container className="py-2">
          <div className="d-flex align-items-center gap-3">
            <img
              className="align-self-start"
              src={logoSrc}
              alt="PickleTour"
              width={44}
              height={44}
              draggable={false}
              style={{
                borderRadius: 10,
                background: "rgba(255,255,255,.08)",
                objectFit: "cover",
                flex: "0 0 44px",
                display: "block",
              }}
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            <div className="flex-grow-1">
              <div className="fw-semibold" style={{ lineHeight: 1.1 }}>
                Cài đặt ứng dụng PickleTour
              </div>
              <div className="text-white-50 small">
                Trải nghiệm mượt hơn, nhận thông báo & theo dõi giải đấu tức
                thời.
              </div>
            </div>
            <div className="d-flex align-items-center gap-2">
              <a
                href={btnHref || "#"}
                target={btnTarget}
                rel={btnRel}
                className="btn btn-sm btn-light fw-semibold"
                style={{ whiteSpace: "nowrap" }}
              >
                {primaryLabel}
              </a>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={onDismiss}
                aria-label="Đóng"
                title="Đóng"
                style={{ whiteSpace: "nowrap" }}
              >
                Để sau
              </button>
            </div>
          </div>
        </Container>
      </div>
      {/* Spacer để tránh bị che nội dung */}
      <div style={{ height: barH }} />
    </>
  );
}
