/* eslint-disable react/prop-types */
// ModernRoundElimBracket.jsx
// Bản v4 cho Round Elimination / Pre-Qualifying (khác KO đối xứng — mỗi seed
// ở round R+1 có thể lấy loser hoặc winner từ seed cụ thể ở round R, không
// phải seed 2i/2i+1 chuẩn). Reuse ModernSeedCard từ ModernKnockoutBracket.jsx.

import { useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Box, Chip, Stack, Typography, alpha, useTheme } from "@mui/material";

import {
  ModernSeedCard,
  MODERN_CARD_W,
  MODERN_CARD_MIN_H,
} from "./ModernKnockoutBracket";

/* ================= constants ================= */
const CARD_W = MODERN_CARD_W;
const CARD_H = Math.max(MODERN_CARD_MIN_H, 132);
const COL_GAP = 80;
const ROW_GAP = 28;
const HEADER_H = 50;
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

/* ================= column header (chip) ================= */
function RoundHeaderChip({ title, count, x, theme }) {
  return (
    <Box
      sx={{
        position: "absolute",
        left: x,
        top: 4,
        width: CARD_W,
        display: "flex",
        justifyContent: "center",
        zIndex: 2,
        pointerEvents: "none",
      }}
    >
      <Chip
        size="small"
        label={
          <Stack direction="row" spacing={0.5} alignItems="center">
            <Typography
              component="span"
              sx={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6 }}
            >
              {title || `Vòng`}
            </Typography>
            {count > 0 && (
              <Typography
                component="span"
                sx={{
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: "text.secondary",
                  ml: 0.25,
                }}
              >
                · {count} trận
              </Typography>
            )}
          </Stack>
        }
        sx={{
          background: alpha(theme.palette.primary.main, 0.08),
          color: theme.palette.primary.main,
          border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
          fontWeight: 700,
          px: 1,
          pointerEvents: "auto",
        }}
      />
    </Box>
  );
}

RoundHeaderChip.propTypes = {
  title: PropTypes.string,
  count: PropTypes.number,
  x: PropTypes.number.isRequired,
  theme: PropTypes.object.isRequired,
};

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
  const [hovered, setHovered] = useState(null);
  const layout = useMemo(() => buildLayout(rounds), [rounds]);

  const safeZoom =
    Number.isFinite(Number(zoom)) && Number(zoom) > 0 ? Number(zoom) : 1;

  if (!rounds?.length) return null;

  const loserColor = alpha(theme.palette.warning.main, 0.55);
  const winnerColor = alpha(theme.palette.primary.main, 0.55);

  return (
    <Box
      sx={{
        width: "100%",
        overflowX: "auto",
        overflowY: "visible",
      }}
    >
      <style>{`
        @keyframes mkb-pulse {
          0% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
          100% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
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
            {layout.connectors.map((c) => (
              <path
                key={c.key}
                d={c.d}
                fill="none"
                stroke={c.isLoser ? loserColor : winnerColor}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeDasharray={c.isLoser ? "6 5" : "0"}
              />
            ))}
          </svg>

          {/* round headers */}
          {layout.columns.map((col) => (
            <RoundHeaderChip
              key={`h-${col.roundIndex}`}
              title={col.title}
              count={col.nodes.length}
              x={col.x}
              theme={theme}
            />
          ))}

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
