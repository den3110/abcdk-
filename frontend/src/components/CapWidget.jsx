import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Box, Typography } from "@mui/material";
import { useLanguage } from "../context/LanguageContext.jsx";
import {
  CAP_API_ENDPOINT,
  CAP_ENABLED,
  CAP_WASM_URL,
  CAP_WIDGET_SCRIPT_URL,
} from "../utils/cap.js";

let capWidgetLoaderPromise = null;

function loadCapWidgetScript(scriptUrl) {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.customElements?.get("cap-widget")) return Promise.resolve();
  if (capWidgetLoaderPromise) return capWidgetLoaderPromise;

  capWidgetLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-cap-widget-loader='true']");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Cap widget")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.capWidgetLoader = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      capWidgetLoaderPromise = null;
      reject(new Error("Failed to load Cap widget"));
    };
    document.head.appendChild(script);
  });

  return capWidgetLoaderPromise;
}

export default function CapWidget({
  fieldBackground,
  fieldBorder,
  textColor,
  helperColor,
  hiddenFieldName = "cap-token",
}) {
  const { t, language } = useLanguage();
  const [isReady, setIsReady] = useState(() =>
    typeof window !== "undefined" &&
    Boolean(window.customElements?.get("cap-widget")),
  );
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!CAP_ENABLED) return undefined;

    if (!CAP_API_ENDPOINT || !CAP_WIDGET_SCRIPT_URL) {
      setLoadError(
        t(
          "auth.cap.configError",
          {},
          language === "vi"
            ? "CAPTCHA chưa được cấu hình đầy đủ."
            : "CAPTCHA is not fully configured.",
        ),
      );
      return undefined;
    }

    if (CAP_WASM_URL && typeof window !== "undefined") {
      window.CAP_CUSTOM_WASM_URL = CAP_WASM_URL;
    }

    let cancelled = false;

    loadCapWidgetScript(CAP_WIDGET_SCRIPT_URL)
      .then(() => {
        if (cancelled) return;
        setIsReady(true);
        setLoadError("");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError(
          t(
            "auth.cap.loadError",
            {},
            language === "vi"
              ? "Không thể tải CAPTCHA. Vui lòng thử lại sau."
              : "Unable to load CAPTCHA. Please try again later.",
          ),
        );
      });

    return () => {
      cancelled = true;
    };
  }, [language, t]);

  if (!CAP_ENABLED) return null;

  if (loadError) {
    return (
      <Typography
        sx={{
          color: "#d14343",
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {loadError}
      </Typography>
    );
  }

  if (!isReady) {
    return (
      <Typography
        sx={{
          color: helperColor,
          fontSize: 13,
          lineHeight: 1.45,
        }}
      >
        {t(
          "auth.cap.loading",
          {},
          language === "vi"
            ? "Đang tải xác minh người dùng..."
            : "Loading CAPTCHA verification...",
        )}
      </Typography>
    );
  }

  return (
    <Box
      sx={{
        "& cap-widget": {
          display: "block",
          "--cap-widget-width": "100%",
          "--cap-widget-height": "54px",
          "--cap-widget-padding": "14px",
          "--cap-background": fieldBackground,
          "--cap-border-color": fieldBorder,
          "--cap-border-radius": "14px",
          "--cap-color": textColor,
          "--cap-checkbox-border": `1px solid ${fieldBorder}`,
          "--cap-checkbox-background": fieldBackground,
          "--cap-font": "inherit",
          "--cap-spinner-color": textColor,
          "--cap-spinner-background-color": fieldBorder,
        },
      }}
    >
      <cap-widget
        required
        data-cap-api-endpoint={CAP_API_ENDPOINT}
        data-cap-hidden-field-name={hiddenFieldName}
        data-cap-i18n-initial-state={t(
          "auth.cap.initialState",
          {},
          language === "vi" ? "Xác minh bạn là người dùng" : "Verify you're human",
        )}
        data-cap-i18n-verifying-label={t(
          "auth.cap.verifyingLabel",
          {},
          language === "vi" ? "Đang xác minh..." : "Verifying...",
        )}
        data-cap-i18n-solved-label={t(
          "auth.cap.solvedLabel",
          {},
          language === "vi" ? "Đã xác minh" : "Verified",
        )}
        data-cap-i18n-error-label={t(
          "auth.cap.errorLabel",
          {},
          language === "vi" ? "Có lỗi, thử lại" : "Error. Try again.",
        )}
        data-cap-i18n-troubleshooting-label={t(
          "auth.cap.troubleshootingLabel",
          {},
          language === "vi" ? "Khắc phục" : "Troubleshoot",
        )}
        data-cap-i18n-wasm-disabled={t(
          "auth.cap.wasmDisabled",
          {},
          language === "vi"
            ? "Hãy bật WASM để tăng tốc xác minh"
            : "Enable WASM for faster verification",
        )}
        data-cap-i18n-verify-aria-label={t(
          "auth.cap.verifyAriaLabel",
          {},
          language === "vi"
            ? "Nhấn để xác minh bạn là người dùng"
            : "Click to verify you're human",
        )}
        data-cap-i18n-verifying-aria-label={t(
          "auth.cap.verifyingAriaLabel",
          {},
          language === "vi"
            ? "Đang xác minh, vui lòng chờ"
            : "Verifying, please wait",
        )}
        data-cap-i18n-verified-aria-label={t(
          "auth.cap.verifiedAriaLabel",
          {},
          language === "vi" ? "Đã xác minh" : "Verified",
        )}
        data-cap-i18n-required-label={t(
          "auth.cap.requiredLabel",
          {},
          language === "vi"
            ? "Vui lòng hoàn thành xác minh CAPTCHA"
            : "Please complete the CAPTCHA",
        )}
        data-cap-i18n-error-aria-label={t(
          "auth.cap.errorAriaLabel",
          {},
          language === "vi"
            ? "Có lỗi xác minh, vui lòng thử lại"
            : "An error occurred, please try again",
        )}
      />
    </Box>
  );
}

CapWidget.propTypes = {
  fieldBackground: PropTypes.string.isRequired,
  fieldBorder: PropTypes.string.isRequired,
  textColor: PropTypes.string.isRequired,
  helperColor: PropTypes.string.isRequired,
  hiddenFieldName: PropTypes.string,
};
