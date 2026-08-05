// Card giải đấu compact hiển thị trong bubble chat / feed post — tên + địa chỉ
// + ngày + số cặp đã đăng ký. Tap → /tournament/:id
import { Link as RouterLink } from "react-router-dom";
import { Avatar, Box, Stack, Typography } from "@mui/material";
import { Trophy, MapPin, Calendar, Users, ChevronRight } from "lucide-react";

function fmtDateRange(startIso, endIso) {
  if (!startIso) return "";
  const s = new Date(startIso);
  const fmt = (d) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(
      d.getMonth() + 1
    ).padStart(2, "0")}/${d.getFullYear()}`;
  if (!endIso || endIso === startIso) return fmt(s);
  const e = new Date(endIso);
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear() && s.getDate() !== e.getDate()) {
    return `${String(s.getDate()).padStart(2, "0")}–${fmt(e)}`;
  }
  return `${fmt(s)} → ${fmt(e)}`;
}

export default function TournamentBubbleCard({
  tour,
  variant = "chat", // "chat" | "chatMine" | "feed"
}) {
  if (!tour) return null;
  const isMine = variant === "chatMine";
  const isFeed = variant === "feed";
  const dateStr = fmtDateRange(tour?.startDate, tour?.endDate);
  const regCount = Number(tour?.registrationCount || 0);
  const maxPairs = Number(tour?.maxPairs || 0);

  const bg = isFeed
    ? "#FFFBEB"
    : isMine
    ? "rgba(255,255,255,0.15)"
    : "#FFFBEB";
  const border = isMine ? "rgba(255,255,255,0.28)" : "#FDE68A";
  const labelColor = isMine ? "#FEF3C7" : "#B45309";
  const nameColor = isMine ? "#fff" : "text.primary";
  const subColor = isMine ? "rgba(255,255,255,0.85)" : "text.secondary";
  const chevronColor = isMine ? "#DBEAFE" : "#94A3B8";
  const imgSize = isFeed ? 56 : 44;

  return (
    <Box
      component={RouterLink}
      to={`/tournament/${tour._id}`}
      sx={{
        mt: isFeed ? 1.5 : 0.75,
        display: "flex",
        alignItems: "flex-start",
        gap: 1.2,
        p: 1,
        borderRadius: 2,
        bgcolor: bg,
        border: 1,
        borderColor: border,
        textDecoration: "none",
        color: "inherit",
        transition: "background-color .15s",
        "&:hover": {
          bgcolor: isMine ? "rgba(255,255,255,0.22)" : "#FEF3C7",
        },
      }}
    >
      {tour.image ? (
        <Avatar
          src={tour.image}
          variant="rounded"
          sx={{ width: imgSize, height: imgSize, bgcolor: "#FEF3C7" }}
        />
      ) : (
        <Avatar
          variant="rounded"
          sx={{ width: imgSize, height: imgSize, bgcolor: "#FEF3C7" }}
        >
          <Trophy size={22} color="#F59E0B" />
        </Avatar>
      )}
      <Box flex={1} minWidth={0} sx={{ overflow: "hidden" }}>
        <Typography
          variant="caption"
          fontWeight={800}
          sx={{
            display: "block",
            color: labelColor,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            lineHeight: 1.2,
          }}
        >
          Giải đấu
        </Typography>
        <Typography
          variant="body2"
          fontWeight={700}
          sx={{
            color: nameColor,
            lineHeight: 1.3,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
            mt: 0.2,
          }}
        >
          {tour.name}
        </Typography>
        {tour.location && (
          <Stack
            direction="row"
            spacing={0.5}
            alignItems="flex-start"
            sx={{ mt: 0.4, minWidth: 0 }}
          >
            <MapPin
              size={12}
              color={isMine ? "#DBEAFE" : "#94A3B8"}
              style={{ marginTop: 2, flexShrink: 0 }}
            />
            <Typography
              variant="caption"
              sx={{
                color: subColor,
                fontSize: 11,
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                minWidth: 0,
                wordBreak: "break-word",
              }}
            >
              {tour.location}
            </Typography>
          </Stack>
        )}
        {dateStr && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.3 }}>
            <Calendar size={12} color={isMine ? "#DBEAFE" : "#94A3B8"} />
            <Typography variant="caption" sx={{ color: subColor, fontSize: 11 }}>
              {dateStr}
            </Typography>
          </Stack>
        )}
        {(regCount > 0 || maxPairs > 0) && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.3 }}>
            <Users size={12} color={isMine ? "#DBEAFE" : "#94A3B8"} />
            <Typography variant="caption" sx={{ color: subColor, fontSize: 11 }}>
              {regCount} cặp{maxPairs > 0 ? ` / ${maxPairs}` : ""} đã đăng ký
            </Typography>
          </Stack>
        )}
      </Box>
      <ChevronRight
        size={16}
        color={chevronColor}
        style={{ flexShrink: 0, marginTop: 4 }}
      />
    </Box>
  );
}
