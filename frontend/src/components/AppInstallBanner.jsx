// src/components/AppInstallBanner.jsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  Button,
  Container,
  Typography,
  IconButton,
  Collapse,
  useTheme,
  alpha,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import GetAppIcon from "@mui/icons-material/GetApp";

/* =========================================================
   LOGIC GIỮ NGUYÊN (Detect Platform & Store Links)
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

const SNOOZE_KEY = "pt_app_banner_snoozed_at";
const SNOOZE_TTL_DAYS = 2;
const INSTALLED_FLAG = "pt_app_native_installed";

function daysToMs(d) {
  return d * 24 * 60 * 60 * 1000;
}

function shouldShowFromStorage() {
  try {
    const now = Date.now();
    const s = parseInt(localStorage.getItem(SNOOZE_KEY) || "0", 10);
    if (s && now - s <= daysToMs(SNOOZE_TTL_DAYS)) return false;
    return true;
  } catch {
    return true;
  }
}

async function detectInstalledAndroid(androidPackage) {
  try {
    if (!androidPackage) return false;
    const nav = navigator;
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
  const theme = useTheme();
  const { isAndroid, isIOS, isMobile, isStandalone } = detectPlatform();
  const [visible, setVisible] = useState(false);
  const [installed, setInstalled] = useState(false);

  // inputs
  const hasIOS = !!links?.appStore;
  const hasAndroid = !!links?.playStore || !!links?.apkPickleTour;
  const androidPackage = links?.androidPackage || "";
  const deeplinkPath = links?.deeplinkPath || "";
  const domain = links?.domain || "";

  // Logo
  const logoSrc = `${import.meta.env.BASE_URL}icon.png`;

  // Deeplink
  const deeplinkUrl = useMemo(() => {
    if (!deeplinkPath) return "";
    if (deeplinkPath.startsWith("http")) return deeplinkPath;
    const host = domain || window.location.origin;
    return `${host}${deeplinkPath.startsWith("/") ? "" : "/"}${deeplinkPath}`;
  }, [deeplinkPath, domain]);

  // Store Href
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

  // Intent Href (Android)
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

  // Check flag installed
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

  // Check android api
  useEffect(() => {
    if (!isAndroid) return;
    detectInstalledAndroid(androidPackage).then((ok) => {
      if (ok) setInstalled(true);
    });
  }, [isAndroid, androidPackage]);

  // Show condition
  useEffect(() => {
    const can =
      isMobile &&
      !isStandalone &&
      !!(storeHref || deeplinkUrl) &&
      shouldShowFromStorage();

    // Delay nhỏ để animation mượt hơn khi mount
    if (can) {
      const t = setTimeout(() => setVisible(true), 500);
      return () => clearTimeout(t);
    }
  }, [isMobile, isStandalone, storeHref, deeplinkUrl]);

  const onDismiss = () => {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now()));
    } catch (e) {
      console.log(e);
    }
    setVisible(false);
  };

  const primaryLabel = installed ? "Mở App" : "Tải App";
  const btnHref = installed
    ? (isAndroid ? intentHref || deeplinkUrl : deeplinkUrl) || storeHref
    : storeHref;

  const btnTarget = installed && !isAndroid ? undefined : "_blank";
  const btnRel = btnTarget ? "noopener noreferrer" : undefined;

  // Nếu không visible thì trả về null luôn để đỡ tốn DOM,
  // nhưng dùng Collapse thì component vẫn render, chỉ height = 0.
  // Ta return Collapse để có animation đẹp khi ẩn.

  return (
    <Collapse in={visible} timeout="auto" unmountOnExit>
      <Box
        sx={{
          position: "relative", // Quan trọng: relative để đẩy Header xuống
          zIndex: 1200, // Cao hơn Header (thường là 1100)
          background: "linear-gradient(90deg, #111827, #0b1220)",
          color: "#fff",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
        }}
      >
        <Container maxWidth="xl" sx={{ py: 1.5 }}>
          <Box display="flex" alignItems="center" gap={2}>
            {/* Logo */}
            <Box
              component="img"
              src={logoSrc}
              alt="App Icon"
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                bgcolor: "rgba(255,255,255,0.1)",
                objectFit: "cover",
                flexShrink: 0,
              }}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />

            {/* Content */}
            <Box flexGrow={1} minWidth={0}>
              <Typography variant="subtitle2" fontWeight={700} lineHeight={1.2}>
                Trải nghiệm tốt hơn trên App
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: "rgba(255,255,255,0.7)", display: "block" }}
                noWrap
              >
                Thông báo, chấm trình & cập nhật tức thời.
              </Typography>
            </Box>

            {/* Actions */}
            <Box display="flex" alignItems="center" gap={1}>
              <Button
                variant="contained"
                size="small"
                href={btnHref}
                target={btnTarget}
                rel={btnRel}
                startIcon={!installed && <GetAppIcon fontSize="inherit" />}
                sx={{
                  bgcolor: "background.paper",
                  color: "text.primary",
                  fontWeight: 700,
                  textTransform: "none",
                  borderRadius: 4,
                  px: 2,
                  whiteSpace: "nowrap",
                  "&:hover": {
                    bgcolor: "action.hover",
                  },
                }}
              >
                {primaryLabel}
              </Button>

              <IconButton
                size="small"
                onClick={onDismiss}
                sx={{
                  color: "rgba(255,255,255,0.5)",
                  "&:hover": {
                    color: "#fff",
                    bgcolor: "rgba(255,255,255,0.1)",
                  },
                }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Container>
      </Box>
    </Collapse>
  );
}
