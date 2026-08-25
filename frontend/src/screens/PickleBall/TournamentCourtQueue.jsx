// Màn hình HÀNG ĐỢI SÂN — dành cho TV/màn hình lớn tại giải.
// Mỗi sân: trận đang đánh (LIVE) + các trận kế tiếp kèm giờ dự kiến.
// Dữ liệu lấy từ danh sách trận công khai; sân lấy theo autoCourtNo (bộ tự
// xếp giờ gán) hoặc sân thực khi đã gán. Tự refresh 15s.
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Box, Typography, Chip, Stack } from "@mui/material";

import {
  useGetTournamentQuery,
  useListPublicMatchesByTournamentQuery,
} from "../../slices/tournamentsApiSlice";
import {
  getPairDisplayName,
  getSeedDisplayName,
} from "../../utils/matchDisplay";

const LIVE = "live";
const FINISHED = "finished";

function sideName(m, side) {
  const pair = side === "A" ? m?.pairA : m?.pairB;
  if (pair) return getPairDisplayName(pair, m?.tournament) || "—";
  const seed = side === "A" ? m?.seedA : m?.seedB;
  if (seed) return getSeedDisplayName(seed, m) || "—";
  const prev = side === "A" ? m?.previousA : m?.previousB;
  if (prev) return `Thắng ${prev.code || `V${prev.round || "?"}`}`;
  return "—";
}

function courtNoOf(m) {
  if (Number(m?.autoCourtNo) > 0) return Number(m.autoCourtNo);
  if (m?.court && Number.isFinite(Number(m.court.order)))
    return Number(m.court.order) + 1;
  return null;
}

function fmtTime(ts) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function liveScore(m) {
  const gs = m?.gameScores;
  if (Array.isArray(gs) && gs.length) {
    const last = gs[gs.length - 1] || {};
    if (last.a != null && last.b != null) return `${last.a} – ${last.b}`;
  }
  if (m?.currentGame && m.currentGame.a != null)
    return `${m.currentGame.a} – ${m.currentGame.b}`;
  return "";
}

export default function TournamentCourtQueue() {
  const { id } = useParams();
  const { data: tournament } = useGetTournamentQuery(id);
  const { data: matchesResp } = useListPublicMatchesByTournamentQuery(
    { tid: id },
    { pollingInterval: 15000, refetchOnFocus: true },
  );

  const matches = useMemo(() => {
    const raw = Array.isArray(matchesResp)
      ? matchesResp
      : matchesResp?.items || matchesResp?.list || matchesResp?.matches || [];
    return raw.filter((m) => m && m.status !== FINISHED);
  }, [matchesResp]);

  const courts = useMemo(() => {
    const map = new Map(); // courtNo -> { current, upcoming[] }
    let maxNo = 0;
    for (const m of matches) {
      const no = courtNoOf(m);
      if (!no) continue;
      maxNo = Math.max(maxNo, no);
      if (!map.has(no)) map.set(no, { current: null, upcoming: [] });
      const slot = map.get(no);
      if (m.status === LIVE) {
        if (!slot.current) slot.current = m;
        else slot.upcoming.push(m);
      } else {
        slot.upcoming.push(m);
      }
    }
    const list = [];
    for (let no = 1; no <= maxNo; no += 1) {
      const slot = map.get(no) || { current: null, upcoming: [] };
      slot.upcoming.sort(
        (a, b) =>
          new Date(a.scheduledAt || 0).getTime() -
          new Date(b.scheduledAt || 0).getTime(),
      );
      list.push({ no, ...slot });
    }
    return list;
  }, [matches]);

  return (
    <Box
      sx={{
        minHeight: "100vh",
        bgcolor: "#0B0F14",
        color: "#fff",
        p: { xs: 2, md: 4 },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ mb: 3, flexWrap: "wrap", gap: 1 }}
      >
        <Box>
          <Typography sx={{ fontSize: { xs: 22, md: 34 }, fontWeight: 900 }}>
            Hàng đợi sân
          </Typography>
          <Typography sx={{ color: "#9AA0A6", fontSize: { xs: 14, md: 18 } }}>
            {tournament?.name || "Giải đấu"}
          </Typography>
        </Box>
        <Chip
          label="Tự cập nhật"
          sx={{ bgcolor: "#132", color: "#4ADE80", fontWeight: 700 }}
        />
      </Stack>

      {courts.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 10, color: "#9AA0A6" }}>
          <Typography sx={{ fontSize: 22, fontWeight: 700 }}>
            Chưa có lịch sân.
          </Typography>
          <Typography sx={{ mt: 1 }}>
            Vào trang Quản lý giải hoặc Lịch đấu → bấm "Tự động xếp giờ" để tạo
            hàng đợi sân.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              lg: "repeat(3, 1fr)",
              xl: "repeat(4, 1fr)",
            },
            gap: 2.5,
          }}
        >
          {courts.map((c) => {
            const cur = c.current;
            const nexts = c.upcoming.slice(0, 3);
            return (
              <Box
                key={c.no}
                sx={{
                  borderRadius: 4,
                  border: "1px solid #1E2630",
                  bgcolor: "#111720",
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    px: 2.5,
                    py: 1.5,
                    bgcolor: "#1877F2",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Typography sx={{ fontWeight: 900, fontSize: 22 }}>
                    Sân {c.no}
                  </Typography>
                  {cur ? (
                    <Chip
                      label="ĐANG ĐÁNH"
                      size="small"
                      sx={{
                        bgcolor: "#E5484D",
                        color: "#fff",
                        fontWeight: 800,
                      }}
                    />
                  ) : (
                    <Chip
                      label="Trống"
                      size="small"
                      sx={{ bgcolor: "#0B0F14", color: "#9AA0A6" }}
                    />
                  )}
                </Box>

                <Box sx={{ p: 2.5 }}>
                  {cur ? (
                    <Box sx={{ mb: 2 }}>
                      <MatchLine m={cur} big score={liveScore(cur)} />
                    </Box>
                  ) : (
                    <Typography sx={{ color: "#6B7280", mb: 2 }}>
                      Chưa có trận đang đánh
                    </Typography>
                  )}

                  <Typography
                    sx={{
                      color: "#9AA0A6",
                      fontSize: 13,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      mb: 1,
                    }}
                  >
                    Kế tiếp
                  </Typography>
                  {nexts.length === 0 ? (
                    <Typography sx={{ color: "#6B7280" }}>
                      Không còn trận.
                    </Typography>
                  ) : (
                    <Stack spacing={1.25}>
                      {nexts.map((m) => (
                        <MatchLine key={m._id} m={m} />
                      ))}
                    </Stack>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function MatchLine({ m, big = false, score = "" }) {
  const a = sideName(m, "A");
  const b = sideName(m, "B");
  const time = fmtTime(m?.scheduledAt);
  const code = m?.code || "";
  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
          mb: 0.5,
        }}
      >
        <Typography sx={{ color: "#7C8695", fontSize: 12, fontWeight: 700 }}>
          {code || "Trận"}
        </Typography>
        {big && score ? (
          <Typography sx={{ fontSize: 20, fontWeight: 900, color: "#FDE68A" }}>
            {score}
          </Typography>
        ) : time ? (
          <Chip
            label={time}
            size="small"
            sx={{
              bgcolor: "#0B0F14",
              color: "#9CC1FF",
              fontWeight: 800,
              height: 22,
            }}
          />
        ) : null}
      </Box>
      <Typography
        sx={{
          fontWeight: big ? 800 : 700,
          fontSize: big ? 18 : 15.5,
          lineHeight: 1.3,
        }}
        noWrap
      >
        {a}
      </Typography>
      <Typography sx={{ color: "#6B7280", fontSize: 12, my: 0.25 }}>vs</Typography>
      <Typography
        sx={{
          fontWeight: big ? 800 : 700,
          fontSize: big ? 18 : 15.5,
          lineHeight: 1.3,
        }}
        noWrap
      >
        {b}
      </Typography>
    </Box>
  );
}
