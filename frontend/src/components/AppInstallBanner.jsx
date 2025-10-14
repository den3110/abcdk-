import { useEffect, useMemo, useRef, useState } from "react";
import { Container } from "react-bootstrap";

/* =========================================================
   AppInstallBanner (smart suggest top bar)
   - Detect iOS/Android
   - Pick correct store link (fallback APK for Android)
   - Dismissible, remember 14 days
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

const DISMISS_KEY = "pt_app_banner_dismissed_at";
const DISMISS_TTL_DAYS = 14;

function shouldShowFromStorage() {
  try {
    const ts = parseInt(localStorage.getItem(DISMISS_KEY) || "0", 10);
    if (!ts) return true;
    const ms = Date.now() - ts;
    return ms > DISMISS_TTL_DAYS * 24 * 60 * 60 * 1000;
  } catch {
    return true;
  }
}

export default function AppInstallBanner({ links }) {
  const { isAndroid, isIOS, isMobile, isStandalone } = detectPlatform();
  const [visible, setVisible] = useState(false);
  const barRef = useRef(null);
  const [barH, setBarH] = useState(0);

  const hasIOS = !!links?.appStore;
  const hasAndroid = !!links?.playStore || !!links?.apkPickleTour;
  const logoSrc = `/icon.png`;
  // decide target link
  const targetHref = useMemo(() => {
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

  const primaryLabel = isIOS ? "Tải" : "Tải";

  useEffect(() => {
    // only show on mobile web, not PWA, must have link
    const can =
      isMobile && !isStandalone && !!targetHref && shouldShowFromStorage();
    setVisible(!!can);
  }, [isMobile, isStandalone, targetHref]);

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
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch (e) {
      console.log(e);
    }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <>
      <div
        ref={barRef}
        className="position-fixed top-0 start-0 end-0"
        style={{
          zIndex: 1050,
          background: "linear-gradient(90deg, #111827, #0b1220)",
          color: "#fff",
          boxShadow: "0 4px 20px rgba(0,0,0,0.28)",
        }}
      >
        <Container className="py-2">
          <div className="d-flex align-items-center gap-3">
            {/* App icon placeholder (use your logo if available) */}
            <img
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
                // fallback: ẩn nếu thiếu file
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
                href={targetHref}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-sm btn-light fw-semibold"
              >
                {primaryLabel}
              </a>
              <button
                type="button"
                className="btn btn-sm btn-outline-light"
                onClick={onDismiss}
                aria-label="Đóng"
                title="Đóng"
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
