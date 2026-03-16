import { Box, ButtonBase, Tooltip, alpha, useTheme } from "@mui/material";
import PropTypes from "prop-types";

import { useLanguage } from "../context/LanguageContext.jsx";

const OPTIONS = [
  { value: "vi", label: "VI", titleKey: "common.languages.vi" },
  { value: "en", label: "EN", titleKey: "common.languages.en" },
];

export default function LanguageSwitcher({ compact = false }) {
  const theme = useTheme();
  const { language, setLanguage, t } = useLanguage();

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        p: 0.5,
        borderRadius: 999,
        border: `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
        bgcolor: alpha(theme.palette.background.paper, 0.72),
        backdropFilter: "blur(10px)",
      }}
    >
      {OPTIONS.map((option) => {
        const active = option.value === language;

        return (
          <Tooltip key={option.value} title={t(option.titleKey)}>
            <ButtonBase
              onClick={() => setLanguage(option.value)}
              sx={{
                minWidth: compact ? 34 : 40,
                height: compact ? 30 : 32,
                px: compact ? 1 : 1.25,
                borderRadius: 999,
                fontSize: "0.78rem",
                fontWeight: 800,
                color: active ? "#fff" : "text.secondary",
                bgcolor: active ? theme.palette.primary.main : "transparent",
                transition: "all 0.2s ease",
                "&:hover": {
                  bgcolor: active
                    ? theme.palette.primary.main
                    : alpha(theme.palette.primary.main, 0.08),
                },
              }}
            >
              {option.label}
            </ButtonBase>
          </Tooltip>
        );
      })}
    </Box>
  );
}

LanguageSwitcher.propTypes = {
  compact: PropTypes.bool,
};
