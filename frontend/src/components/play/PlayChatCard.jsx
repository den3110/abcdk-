// src/components/play/PlayChatCard.jsx — thẻ kèo "Tìm bạn đánh" trong tin nhắn
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { formatPlayTime, skillLabel } from "../../constants/play";

export default function PlayChatCard({ play, isMine }) {
  const navigate = useNavigate();
  if (!play) return null;
  const slotsLeft = Math.max(0, (play.slots || 0) - (play.acceptedCount || 0));
  return (
    <Box
      onClick={() => play._id && navigate(`/play/${play._id}`)}
      sx={{
        mt: 0.75,
        width: 250,
        maxWidth: "100%",
        borderRadius: 2,
        overflow: "hidden",
        cursor: "pointer",
        bgcolor: isMine ? "rgba(255,255,255,0.15)" : "background.paper",
        border: "1px solid",
        borderColor: isMine ? "rgba(255,255,255,0.35)" : "divider",
      }}
    >
      <Box sx={{ px: 1.25, py: 0.6, bgcolor: isMine ? "rgba(255,255,255,0.2)" : "#16a34a", display: "flex", alignItems: "center", gap: 0.5 }}>
        <span style={{ fontSize: 12 }}>🏓</span>
        <Typography variant="caption" sx={{ fontWeight: 700, color: "#fff" }}>Kèo giao lưu</Typography>
      </Box>
      <Box sx={{ p: 1.1 }}>
        <Typography noWrap sx={{ fontWeight: 700, fontSize: 13.5, color: isMine ? "#fff" : "text.primary" }}>
          {play.title || play.courtName || "Kèo pickleball"}
        </Typography>
        <Typography sx={{ fontSize: 12, color: isMine ? "rgba(255,255,255,0.85)" : "text.secondary" }}>
          🕒 {formatPlayTime(play.playAt)}
        </Typography>
        <Typography noWrap sx={{ fontSize: 12, color: isMine ? "rgba(255,255,255,0.85)" : "text.secondary" }}>
          {skillLabel(play.skillMin, play.skillMax)} · thiếu {slotsLeft}
        </Typography>
        <Box sx={{ mt: 0.75, textAlign: "center", py: 0.5, borderRadius: 1, bgcolor: isMine ? "rgba(255,255,255,0.25)" : "#16a34a", color: "#fff", fontWeight: 800, fontSize: 12 }}>
          {play.status === "open" ? "Tham gia →" : "Xem kèo →"}
        </Box>
      </Box>
    </Box>
  );
}
