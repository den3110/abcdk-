/* eslint-disable react/prop-types */
// ModernRoundElimBracket.jsx
// Bản v4 cho Round Elimination / Pre-Qualifying (khác KO đối xứng — mỗi seed
// ở round R+1 có thể lấy loser hoặc winner từ seed cụ thể ở round R, không
// phải seed 2i/2i+1 chuẩn). Reuse ModernSeedCard từ ModernKnockoutBracket.jsx.

import { useMemo, useState, useId } from "react";
import PropTypes from "prop-types";
import { Box, Stack, Typography, alpha, useTheme } from "@mui/material";

import {
  ModernSeedCard,
  ModernRoundChip,
  MODERN_CARD_W,
  MODERN_CARD_MIN_H,
  MODERN_BRACKET_KEYFRAMES,
  modernBracketBackdropSx,
  accentForIndex,
} from "./ModernKnockoutBracket";

/* ================= constants ================= */
const CARD_W = MODERN_CARD_W;
const CARD_H = Math.max(MODERN_CARD_MIN_H, 140);
const COL_GAP = 84;
const ROW_GAP = 30;
const HEADER_H = 54;
const SEED_PAD_X = 6;

/* ================= layout helpers (mirror buildRoundElimManualLayout) ================= */
function seedKey(seed, fallbackRound, fallbackOrder) {
  const match = seed?.__match;
  const round = Number(match?.round ?? seed?.__round ?? fallbackRound);
  const order = Number(match?.order ?? fallbackOrder);
  if (!Number.isFinite(round) || !Number.isFinite(order)) return "";
  return `${round}:${order}`;
}

function sourceRefsOf(seed) {
  const match = seed?.__match;
  if (!match) return [];
  return [match.seedA, match.seedB]
    .map((source) => {
      const type = String(source?.type || "");
      if (
        type !== "stageMatchLoser" &&
        type !== "stageMatchWinner" &&
        type !== "matchLoser" &&
        type !== "matchWinner"
      ) {
        return null;
      }
      const round = Number(source?.ref?.round);
      const order = Number(source?.ref?.order);
      if (!Number.isFinite(round) || !Number.isFinite(order)) return null;
      return { round, order, isLoser: type.toLowerCase().includes("loser") };
    })
    .filter(Boolean);
}

function buildLayout(rounds = []) {
  const positionsByKey = new Map();
  const columns = [];
  const connectors = [];
  let maxBottom = HEADER_H + CARD_H;

  (rounds || []).forEach((round, roundIndex) => {
    const x = roundIndex * (CARD_W + COL_GAP);
    const seeds = Array.isArray(round?.seeds) ? round.seeds : [];
    const nodes = seeds.map((seed, seedIndex) => {
      const key = seedKey(seed, roundIndex + 1, seedIndex);
      let centerY =
        HEADER_H + seedIndex * (CARD_H + ROW_GAP) + CARD_H / 2;

      if (roundIndex > 0) {
        const sourceCenters = sourceRefsOf(seed)
          .map((ref) => positionsByKey.get(`${ref.round}:${ref.order}`)?.centerY)
          .filter((v) => Number.isFinite(v));
        if (sourceCenters.length) {
          centerY =
            sourceCenters.reduce((s, v) => s + v, 0) / sourceCenters.length;
        }
      }

      const y = Math.max(HEADER_H, centerY - CARD_H / 2);
      const node = {
        key: key || `${roundIndex + 1}:${seedIndex}`,
        seed,
        x,
        y,
        centerY: y + CARD_H / 2,
      };
      if (key) positionsByKey.set(key, node);
      maxBottom = Math.max(maxBottom, y + CARD_H);
      return node;
    });

    columns.push({
      title: round?.title || "",
      x,
      nodes,
      roundIndex,
    });
  });

  columns.forEach((column, roundIndex) => {
    if (roundIndex === 0) return;
    column.nodes.forEach((target) => {
      sourceRefsOf(target.seed).forEach((ref) => {
        const source = positionsByKey.get(`${ref.round}:${ref.order}`);
        if (!source) return;
        const startX = source.x + CARD_W - SEED_PAD_X;
        const endX = target.x + SEED_PAD_X;
        const midX = (startX + endX) / 2;
        // bezier smooth
        const d = `M ${startX} ${source.centerY} C ${midX} ${source.centerY}, ${midX} ${target.centerY}, ${endX} ${target.centerY}`;
        connectors.push({
          key: `${source.key}->${target.key}`,
          d,
          isLoser: !!ref.isLoser,
          x1: startX,
          y1: source.centerY,
          x2: endX,
          y2: target.centerY,
          fromColor: accentForIndex(roundIndex - 1),
          toColor: accentForIndex(roundIndex),
        });
      });
    });
  });

  return {
    columns,
    connectors,
    width:
      Math.max(1, columns.length) * CARD_W +
      Math.max(0, columns.length - 1) * COL_GAP,
    height: maxBottom + ROW_GAP,
  };
}

/* ================= main component ================= */
export default function ModernRoundElimBracket({
  rounds,
  onOpen,
  championMatchId,
  resolveSideLabel,
  resolveSideHighlightId,
  baseRoundStart = 1,
  zoom = 1,
}) {
  const theme = useTheme();
  const gradPrefix = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [hovered, setHovered] = useState(null);
  const layout = useMemo(() => buildLayout(rounds), [rounds]);

  const safeZoom =
    Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;

  if (!rounds?.length) return null;

  const loserColor = alpha(theme.palette.warning.main, 0.6);

  return (
    <Box
      sx={{
        width: "100%",
        overflowX: "auto",
        overflowY: "visible",
        ...modernBracketBackdropSx(theme),
      }}
    >
      <style>{MODERN_BRACKET_KEYFRAMES}</style>
      <Box
        sx={{
          position: "relative",
          width: layout.width * safeZoom + 24,
          minHeight: layout.height * safeZoom + 24,
          mx: "auto",
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: layout.width,
            height: layout.height,
            transform: `scale(${safeZoom})`,
            transformOrigin: "0 0",
            px: 1,
            pb: 2,
          }}
        >
          {/* connectors */}
          <svg
            width={layout.width}
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{
              position: "absolute",
              inset: 0,
              overflow: "visible",
              pointerEvents: "none",
              zIndex: 0,
            }}
          >
            <defs>
              {layout.connectors
                .filter((c) => !c.isLoser)
                .map((c) => (
                  <linearGradient
                    key={`g-${c.key}`}
                    id={`${gradPrefix}-${c.key.replace(/[^a-zA-Z0-9]/g, "_")}`}
                    gradientUnits="userSpaceOnUse"
                    x1={c.x1}
                    y1={c.y1}
                    x2={c.x2}
                    y2={c.y2}
                  >
                    <stop offset="0%" stopColor={alpha(c.fromColor, 0.55)} />
                    <stop offset="100%" stopColor={alpha(c.toColor, 0.85)} />
                  </linearGradient>
                ))}
            </defs>
            {layout.connectors.map((c) => (
              <path
                key={c.key}
                d={c.d}
                fill="none"
                stroke={
                  c.isLoser
                    ? loserColor
                    : `url(#${gradPrefix}-${c.key.replace(/[^a-zA-Z0-9]/g, "_")})`
                }
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeDasharray={c.isLoser ? "6 5" : "0"}
              />
            ))}
          </svg>

          {/* round headers */}
          {layout.columns.map((col) => (
            <Box
              key={`h-${col.roundIndex}`}
              sx={{
                position: "absolute",
                left: col.x,
                top: 4,
                width: CARD_W,
                display: "flex",
                justifyContent: "center",
                zIndex: 2,
              }}
            >
              <ModernRoundChip
                title={col.title || `Vòng ${col.roundIndex + 1}`}
                count={col.nodes.length}
                accent={accentForIndex(col.roundIndex)}
                isFinal={false}
              />
            </Box>
          ))}

          {/* legend nhỏ giải thích đường nét đứt */}
          {layout.connectors.some((c) => c.isLoser) && (
            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                position: "absolute",
                right: 4,
                top: 8,
                zIndex: 2,
                px: 1,
                py: 0.4,
                borderRadius: 1,
                background: alpha(theme.palette.background.paper, 0.85),
                border: `1px solid ${alpha(theme.palette.divider, 1)}`,
              }}
            >
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Box
                  sx={{
                    width: 18,
                    height: 0,
                    borderTop: `2.2px solid ${alpha(theme.palette.primary.main, 0.7)}`,
                    borderRadius: 1,
                  }}
                />
                <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
                  Đội thắng đi tiếp
                </Typography>
              </Stack>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Box
                  sx={{
                    width: 18,
                    height: 0,
                    borderTop: `2.2px dashed ${loserColor}`,
                    borderRadius: 1,
                  }}
                />
                <Typography sx={{ fontSize: 10.5, color: "text.secondary" }}>
                  Đội thua xuống nhánh
                </Typography>
              </Stack>
            </Stack>
          )}

          {/* seed cards */}
          {layout.columns.map((col) =>
            col.nodes.map((node) => (
              <Box
                key={node.key}
                sx={{
                  position: "absolute",
                  left: node.x,
                  top: node.y,
                  width: CARD_W,
                  zIndex: 1,
                }}
              >
                <ModernSeedCard
                  seed={node.seed}
                  onOpen={onOpen}
                  championMatchId={championMatchId}
                  resolveSideLabel={resolveSideLabel}
                  resolveSideHighlightId={resolveSideHighlightId}
                  baseRoundStart={baseRoundStart}
                  hovered={hovered}
                  setHovered={setHovered}
                  nodeKey={node.key}
                  accent={accentForIndex(col.roundIndex)}
                />
              </Box>
            )),
          )}
        </Box>
      </Box>
    </Box>
  );
}

ModernRoundElimBracket.propTypes = {
  rounds: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string,
      seeds: PropTypes.array,
    }),
  ).isRequired,
  onOpen: PropTypes.func,
  championMatchId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  resolveSideLabel: PropTypes.func,
  resolveSideHighlightId: PropTypes.func,
  baseRoundStart: PropTypes.number,
  zoom: PropTypes.number,
};
