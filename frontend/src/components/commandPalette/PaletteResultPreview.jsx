import { memo } from "react";
import PropTypes from "prop-types";
import {
  alpha,
  Box,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  ContentCopyRounded,
  OpenInNewRounded,
  PushPinRounded,
} from "@mui/icons-material";

import { PaletteIconBadge, paletteItemShape } from "./shared.jsx";

const PaletteResultPreview = memo(function PaletteResultPreview({
  item,
  t,
  isPinned,
  onTogglePin,
  onCopyLink,
  onOpenInNewTab,
}) {
  if (!item) return null;

  const scopeLabel = t(`commandPalette.scopes.${item.scope}`);
  const kindLabel = t(`commandPalette.kinds.${item.scope}`);
  const metaRows = Array.isArray(item.metaRows) ? item.metaRows : [];

  return (
    <Stack spacing={2.1} sx={{ height: "100%", minWidth: 0 }}>
      <Stack spacing={1.4} sx={{ minWidth: 0 }}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="flex-start"
          justifyContent="space-between"
          sx={{ minWidth: 0 }}
        >
          <Stack
            direction="row"
            spacing={0.9}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
            sx={{ minWidth: 0, flex: 1 }}
          >
            <Chip
              size="small"
              label={item.isContextual ? t("commandPalette.badges.context") : kindLabel}
              sx={{
                height: 24,
                fontWeight: 700,
                bgcolor: alpha(item.color || "#1759cf", 0.12),
                color: item.color || "#1759cf",
              }}
            />
            {item.isSuggested ? (
              <Chip
                size="small"
                label={t("commandPalette.badges.suggested")}
                sx={{
                  height: 24,
                  fontWeight: 700,
                  bgcolor: (theme) => alpha(theme.palette.success.main, 0.14),
                  color: "success.dark",
                }}
              />
            ) : null}
            {isPinned ? (
              <Chip
                size="small"
                label={t("commandPalette.badges.pinned")}
                sx={{
                  height: 24,
                  fontWeight: 700,
                  bgcolor: (theme) => alpha(theme.palette.warning.main, 0.16),
                  color: "warning.dark",
                }}
              />
            ) : null}
            {item.isRecent ? (
              <Chip
                size="small"
                label={t("commandPalette.badges.recent")}
                sx={{ height: 24, fontWeight: 700 }}
              />
            ) : null}
          </Stack>

          <Stack
            direction="row"
            spacing={0.35}
            sx={{
              flexShrink: 0,
              p: 0.35,
              borderRadius: 999,
              border: (theme) => `1px solid ${alpha(theme.palette.divider, 0.72)}`,
              bgcolor: (theme) => alpha(theme.palette.background.paper, 0.7),
            }}
          >
            {item.persistPin !== false ? (
              <Tooltip
                title={
                  isPinned
                    ? t("commandPalette.actions.unpinItem")
                    : t("commandPalette.actions.pinItem")
                }
              >
                <IconButton onClick={() => onTogglePin?.(item)} size="small">
                  <PushPinRounded
                    fontSize="small"
                    sx={{
                      transform: isPinned ? "rotate(0deg)" : "rotate(45deg)",
                      opacity: isPinned ? 1 : 0.45,
                      color: isPinned ? "warning.main" : "text.secondary",
                    }}
                  />
                </IconButton>
              </Tooltip>
            ) : null}
            {item.path ? (
              <Tooltip title={t("commandPalette.actions.copyPageLink")}>
                <IconButton onClick={() => onCopyLink?.(item)} size="small">
                  <ContentCopyRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
            {item.path ? (
              <Tooltip title={t("commandPalette.actions.openPageNewTab")}>
                <IconButton onClick={() => onOpenInNewTab?.(item)} size="small">
                  <OpenInNewRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            ) : null}
          </Stack>
        </Stack>

        <Stack direction="row" spacing={1.4} alignItems="flex-start" sx={{ minWidth: 0 }}>
          <Box sx={{ mt: 0.25 }}>
            <PaletteIconBadge iconKey={item.iconKey} color={item.color || "#1759cf"} />
          </Box>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="h5"
              sx={{
                fontWeight: 850,
                lineHeight: 1.16,
                letterSpacing: "-0.02em",
                fontSize: { md: "1.2rem", lg: "1.34rem" },
                overflowWrap: "break-word",
              }}
            >
              {item.title}
            </Typography>
            {item.subtitle ? (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.7,
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.subtitle}
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Stack>

      <Box
        sx={{
          p: 1.75,
          borderRadius: 3,
          bgcolor: (theme) => alpha(theme.palette.primary.main, 0.05),
          border: (theme) => `1px solid ${alpha(theme.palette.primary.main, 0.08)}`,
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {t("commandPalette.preview.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {item.description || t("commandPalette.preview.defaultBody")}
        </Typography>
      </Box>

      <Stack spacing={1}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          {t("commandPalette.preview.about")}
        </Typography>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Chip
            size="small"
            label={scopeLabel}
            sx={{ fontWeight: 700, bgcolor: "action.hover" }}
          />
          {item.path ? (
            <Chip
              size="small"
              label={item.path}
              variant="outlined"
              sx={{
                maxWidth: "100%",
                fontWeight: 600,
                "& .MuiChip-label": {
                  display: "block",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                },
              }}
            />
          ) : null}
        </Stack>
      </Stack>

      {metaRows.length ? (
        <Stack spacing={1}>
          {metaRows.map((row) => (
            <Box
              key={`${row.label}-${row.value}`}
              sx={{
                display: "grid",
                gridTemplateColumns: "minmax(78px, 110px) minmax(0, 1fr)",
                gap: 1.25,
                alignItems: "flex-start",
              }}
            >
              <Typography variant="body2" color="text.secondary">
                {row.label}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  fontWeight: 700,
                  textAlign: "left",
                  minWidth: 0,
                  overflowWrap: "break-word",
                }}
              >
                {row.value}
              </Typography>
            </Box>
          ))}
        </Stack>
      ) : null}

      <Box sx={{ mt: "auto" }}>
        <Typography variant="caption" color="text.secondary">
          {item.path
            ? t("commandPalette.preview.enterToOpen")
            : t("commandPalette.preview.enterToRun")}
        </Typography>
      </Box>
    </Stack>
  );
});

PaletteResultPreview.propTypes = {
  item: paletteItemShape,
  isPinned: PropTypes.bool,
  onCopyLink: PropTypes.func,
  onOpenInNewTab: PropTypes.func,
  onTogglePin: PropTypes.func,
  t: PropTypes.func.isRequired,
};

export default PaletteResultPreview;
