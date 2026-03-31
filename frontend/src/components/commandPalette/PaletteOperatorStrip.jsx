import { memo } from "react";
import PropTypes from "prop-types";
import { alpha, Box, Button, Chip, Stack, Typography } from "@mui/material";
import { AutoAwesomeRounded } from "@mui/icons-material";

import { paletteItemShape } from "./shared.jsx";

const PaletteOperatorStrip = memo(function PaletteOperatorStrip({
  visible,
  isSearching,
  isDark,
  source,
  suggestedScope,
  operatorTitle,
  operatorHint,
  operatorMode,
  hasRewrite,
  rewriteQuery,
  primaryItem,
  planItems,
  clarifyQuestion,
  clarifyChoices,
  suggestedPrompts,
  canRunPlan,
  onSelectScope,
  onApplyRewrite,
  onRunPrimary,
  onRunPlan,
  onActivateItem,
  onSelectPrompt,
  t,
}) {
  if (!visible) return null;

  const sourceLabel =
    source === "smart"
      ? t("commandPalette.smart.label")
      : isSearching
        ? t("commandPalette.ai.thinking")
        : t("commandPalette.ai.label");

  return (
    <Box
      sx={{
        borderRadius: 3,
        p: 1.25,
        border: (theme) =>
          `1px solid ${alpha(
            source === "smart" ? theme.palette.primary.main : theme.palette.secondary.main,
            0.18,
          )}`,
        bgcolor: (theme) =>
          alpha(
            source === "smart" ? theme.palette.primary.main : theme.palette.secondary.main,
            isDark ? 0.14 : 0.08,
          ),
      }}
    >
      <Stack spacing={1}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1}
          alignItems={{ xs: "flex-start", md: "center" }}
          justifyContent="space-between"
        >
          <Stack spacing={0.35} sx={{ minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={0.9}
              alignItems="center"
              useFlexGap
              flexWrap="wrap"
            >
              <Chip
                size="small"
                icon={<AutoAwesomeRounded sx={{ fontSize: 16 }} />}
                label={sourceLabel}
                sx={{
                  height: 24,
                  fontWeight: 800,
                  bgcolor: (theme) =>
                    alpha(
                      source === "smart"
                        ? theme.palette.primary.main
                        : theme.palette.secondary.main,
                      0.16,
                    ),
                  color: source === "smart" ? "primary.main" : "secondary.main",
                }}
              />
              {source === "smart" && isSearching ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("commandPalette.ai.refining")}
                />
              ) : null}
              {suggestedScope ? (
                <Chip
                  size="small"
                  variant="outlined"
                  label={t("commandPalette.ai.scope", {
                    scope: t(`commandPalette.scopes.${suggestedScope}`),
                  })}
                  onClick={() => onSelectScope?.(suggestedScope)}
                />
              ) : null}
            </Stack>
            <Typography variant="body2" sx={{ fontWeight: 800, minWidth: 0 }}>
              {operatorTitle}
            </Typography>
            {operatorMode === "clarify" && clarifyQuestion ? (
              <Typography variant="caption" color="text.secondary">
                {clarifyQuestion}
              </Typography>
            ) : operatorHint ? (
              <Typography variant="caption" color="text.secondary">
                {operatorHint}
              </Typography>
            ) : null}
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {hasRewrite ? (
              <Button size="small" variant="outlined" onClick={onApplyRewrite}>
                {t("commandPalette.ai.acceptRewrite")}
              </Button>
            ) : null}
            {canRunPlan ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<AutoAwesomeRounded />}
                onClick={onRunPlan}
              >
                {t("commandPalette.smart.runPlan")}
              </Button>
            ) : primaryItem ? (
              <Button
                size="small"
                variant="contained"
                startIcon={<AutoAwesomeRounded />}
                onClick={onRunPrimary}
              >
                {primaryItem.path
                  ? t(
                      operatorMode === "plan"
                        ? "commandPalette.smart.startPlan"
                        : "commandPalette.ai.openPrimary",
                    )
                  : t(
                      operatorMode === "plan"
                        ? "commandPalette.smart.runPrimary"
                        : "commandPalette.ai.runPrimary",
                    )}
              </Button>
            ) : null}
          </Stack>
        </Stack>

        {hasRewrite && rewriteQuery ? (
          <Typography variant="caption" color="text.secondary">
            {t("commandPalette.ai.rewrite", {
              query: rewriteQuery,
            })}
          </Typography>
        ) : null}

        {operatorMode === "plan" && planItems.length ? (
          <Stack spacing={0.65}>
            <Typography variant="overline" color="text.secondary">
              {source === "smart"
                ? t("commandPalette.smart.plan")
                : t("commandPalette.ai.plan")}
            </Typography>
            <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
              {planItems.map((item, index) => (
                <Chip
                  key={`plan-${item.id}`}
                  clickable
                  variant={index === 0 ? "filled" : "outlined"}
                  color={index === 0 ? "secondary" : "default"}
                  label={t("commandPalette.ai.step", {
                    index: index + 1,
                    title: item.title,
                  })}
                  onClick={() => onActivateItem?.(item)}
                />
              ))}
            </Stack>
          </Stack>
        ) : null}

        {operatorMode === "clarify" && clarifyChoices.length ? (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {clarifyChoices.map((choice) => (
              <Chip
                key={choice}
                clickable
                variant="outlined"
                label={choice}
                onClick={() => onSelectPrompt?.(choice)}
              />
            ))}
          </Stack>
        ) : null}

        {suggestedPrompts.length ? (
          <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap">
            {suggestedPrompts.map((prompt) => (
              <Chip
                key={prompt}
                size="small"
                clickable
                variant="outlined"
                label={prompt}
                onClick={() => onSelectPrompt?.(prompt)}
              />
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
});

PaletteOperatorStrip.propTypes = {
  visible: PropTypes.bool,
  isSearching: PropTypes.bool,
  isDark: PropTypes.bool,
  source: PropTypes.oneOf(["ai", "smart", null]),
  suggestedScope: PropTypes.string,
  operatorTitle: PropTypes.string,
  operatorHint: PropTypes.string,
  operatorMode: PropTypes.oneOf(["pick", "plan", "clarify"]),
  hasRewrite: PropTypes.bool,
  rewriteQuery: PropTypes.string,
  primaryItem: paletteItemShape,
  planItems: PropTypes.arrayOf(paletteItemShape),
  clarifyQuestion: PropTypes.string,
  clarifyChoices: PropTypes.arrayOf(PropTypes.string),
  suggestedPrompts: PropTypes.arrayOf(PropTypes.string),
  canRunPlan: PropTypes.bool,
  onSelectScope: PropTypes.func,
  onApplyRewrite: PropTypes.func,
  onRunPrimary: PropTypes.func,
  onRunPlan: PropTypes.func,
  onActivateItem: PropTypes.func,
  onSelectPrompt: PropTypes.func,
  t: PropTypes.func.isRequired,
};

PaletteOperatorStrip.defaultProps = {
  visible: false,
  isSearching: false,
  isDark: false,
  source: null,
  suggestedScope: "",
  operatorTitle: "",
  operatorHint: "",
  operatorMode: "pick",
  hasRewrite: false,
  rewriteQuery: "",
  primaryItem: null,
  planItems: [],
  clarifyQuestion: "",
  clarifyChoices: [],
  suggestedPrompts: [],
  canRunPlan: false,
  onSelectScope: undefined,
  onApplyRewrite: undefined,
  onRunPrimary: undefined,
  onRunPlan: undefined,
  onActivateItem: undefined,
  onSelectPrompt: undefined,
};

export default PaletteOperatorStrip;
