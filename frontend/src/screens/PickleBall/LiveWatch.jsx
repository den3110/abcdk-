// src/pages/LiveWatch.jsx
import { Box, Card, Typography, Stack, Chip, Divider } from "@mui/material";
import { useParams } from "react-router-dom";
import { useGetMatchQuery } from "../slices/tournamentsApiSlice"; // nếu bạn có API này
import { useLiveMatch } from "../../hook/useLiveMatch";

function pairName(p) {
  if (!p) return "—";
  const a = p.player1?.fullName || "N/A";
  const b = p.player2?.fullName || "N/A";
  return `${a} & ${b}`;
}

export default function LiveWatch() {
  const { matchId } = useParams(); // route: /live/:matchId
  const { data: mmeta } = useGetMatchQuery(matchId, { skip: !matchId }); // để lấy youtubeId nếu lưu theo match
  const { loading, data: m } = useLiveMatch(matchId);

  const youtubeId = mmeta?.youtubeLiveId || ""; // hoặc lưu trên tournament

  return (
    <Box display="grid" gridTemplateColumns={{ xs: "1fr", md: "2fr 1fr" }} gap={2} p={2}>
      <Box sx={{ position: "relative", paddingTop: "56.25%" }}>
        {youtubeId ? (
          <iframe
            title="Live"
            src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&mute=1`}
            allow="autoplay; encrypted-media"
            allowFullScreen
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
          />
        ) : (
          <Card sx={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
            <Typography>Chưa gắn YouTube Live.</Typography>
          </Card>
        )}
      </Box>

      <Card sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          Tỷ số trực tiếp
        </Typography>

        {loading || !m ? (
          <Typography>Đang tải…</Typography>
        ) : (
          <>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography>{pairName(m.pairA)}</Typography>
              <Chip
                size="small"
                label={m.status === "live" ? "Đang diễn ra" : m.status === "finished" ? "Kết thúc" : "Chưa bắt đầu"}
                color={m.status === "live" ? "warning" : m.status === "finished" ? "success" : "default"}
              />
              <Typography>{pairName(m.pairB)}</Typography>
            </Stack>

            <Divider sx={{ my: 1 }} />

            <Box textAlign="center" sx={{ fontSize: 48, fontWeight: 700, lineHeight: 1.1 }}>
              {m.gameScores?.[m.currentGame]?.a ?? 0} : {m.gameScores?.[m.currentGame]?.b ?? 0}
            </Box>

            <Stack direction="row" spacing={1} justifyContent="center" mt={1} flexWrap="wrap">
              {(m.gameScores || []).map((g, i) => (
                <Chip key={i} label={`#${i + 1}: ${g.a}-${g.b}`} size="small" variant={i === m.currentGame ? "filled" : "outlined"} />
              ))}
            </Stack>

            {m.status === "finished" && m.winner && (
              <Typography mt={2} align="center">
                <b>Thắng:</b> {m.winner === "A" ? pairName(m.pairA) : pairName(m.pairB)}
              </Typography>
            )}
          </>
        )}
      </Card>
    </Box>
  );
}
