// screens/CoachesPage.jsx — Danh sách Huấn luyện viên (public directory).
// Card đẹp responsive, sort theo điểm trình, filter tỉnh + search.
// Actions: Xem hồ sơ · Gọi điện (tel:) · Nhắn tin (openDm).
import { useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { Phone, MessageCircle, MapPin, Search, Award } from "lucide-react";
import { toast } from "react-toastify";

import SEOHead from "../components/SEOHead.jsx";
import {
  useListCoachesQuery,
  useListCoachProvincesQuery,
} from "../slices/coachesApiSlice.js";
import { useOpenDmMutation } from "../slices/messagesApiSlice.js";

const authorName = (u) => u?.nickname || u?.name || "Huấn luyện viên";

// tierColor từ Ranking model được lưu dưới dạng CSS named color ("blue" /
// "yellow" / "red" / "grey") — alpha() của MUI không parse được named color,
// phải map sang hex trước khi gọi alpha().
const TIER_HEX = {
  blue: "#3B82F6",
  yellow: "#F59E0B",
  orange: "#F97316",
  red: "#EF4444",
  green: "#22C55E",
  grey: "#94A3B8",
  gray: "#94A3B8",
  purple: "#A855F7",
  cyan: "#06B6D4",
  black: "#0F172A",
  white: "#F8FAFC",
};
const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const safeColor = (c, fallback) => {
  if (!c) return fallback;
  const s = String(c).trim();
  if (HEX_RE.test(s)) return s;
  if (s.startsWith("rgb") || s.startsWith("hsl")) return s;
  return TIER_HEX[s.toLowerCase()] || fallback;
};

function ScoreChip({ label, value, color }) {
  return (
    <Box
      sx={{
        px: 1.1,
        py: 0.35,
        borderRadius: 999,
        bgcolor: alpha(color, 0.12),
        color,
        fontSize: 12,
        fontWeight: 700,
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
      }}
    >
      <Box component="span" sx={{ opacity: 0.75, fontWeight: 600 }}>
        {label}
      </Box>
      {Number(value || 0).toFixed(3)}
    </Box>
  );
}

function CoachCard({ coach, viewer, onMessage }) {
  const navigate = useNavigate();
  const theme = useTheme();
  const nameLabel = authorName(coach);
  const hasPhone = !!coach.phone;

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: 3,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        transition: "transform .15s, box-shadow .15s",
        "&:hover": { transform: "translateY(-2px)", boxShadow: 4 },
      }}
    >
      {/* Hero gradient */}
      <Box
        sx={{
          height: 72,
          background: `linear-gradient(135deg, ${alpha(
            theme.palette.primary.main,
            0.85,
          )}, ${alpha(theme.palette.secondary.main, 0.85)})`,
          position: "relative",
        }}
      />
      <CardContent
        sx={{
          pt: 0,
          px: { xs: 2, sm: 2.5 },
          pb: 2,
          display: "flex",
          flexDirection: "column",
          flex: 1,
          gap: 1,
        }}
      >
        <Box sx={{ mt: -4.5, display: "flex", justifyContent: "flex-start" }}>
          <Avatar
            src={coach.avatar || ""}
            sx={{
              width: 72,
              height: 72,
              border: "3px solid",
              borderColor: "background.paper",
              cursor: "pointer",
              bgcolor: "primary.main",
              fontSize: 28,
              fontWeight: 800,
            }}
            onClick={() => navigate(`/profile/${coach._id}`)}
          >
            {nameLabel[0]?.toUpperCase()}
          </Avatar>
        </Box>

        <Box sx={{ mt: 0.5 }}>
          <Typography
            variant="subtitle1"
            fontWeight={800}
            sx={{
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
              lineHeight: 1.2,
              wordBreak: "break-word",
            }}
            onClick={() => navigate(`/profile/${coach._id}`)}
          >
            {coach.name || nameLabel}
          </Typography>
          {coach.nickname && (
            <Typography variant="caption" color="text.secondary">
              @{coach.nickname}
            </Typography>
          )}
        </Box>

        {coach.coachProfile?.headline && (
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {coach.coachProfile.headline}
          </Typography>
        )}

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
          <ScoreChip
            label="Đơn"
            value={coach.single}
            color={theme.palette.info.main}
          />
          <ScoreChip
            label="Đôi"
            value={coach.double}
            color={theme.palette.secondary.main}
          />
          {coach.tierLabel && (() => {
            const tierHex = safeColor(coach.tierColor, theme.palette.warning.main);
            return (
              <Chip
                size="small"
                label={coach.tierLabel}
                sx={{
                  bgcolor: alpha(tierHex, 0.15),
                  color: tierHex,
                  fontWeight: 700,
                  border: "1px solid",
                  borderColor: alpha(tierHex, 0.35),
                }}
              />
            );
          })()}
        </Stack>

        <Stack spacing={0.5} sx={{ mt: 0.5 }}>
          {coach.province && (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <MapPin size={14} color={theme.palette.text.secondary} />
              <Typography variant="caption" color="text.secondary">
                {coach.province}
              </Typography>
            </Stack>
          )}
          {coach.coachProfile?.experienceYears > 0 && (
            <Stack direction="row" spacing={0.75} alignItems="center">
              <Award size={14} color={theme.palette.text.secondary} />
              <Typography variant="caption" color="text.secondary">
                {coach.coachProfile.experienceYears} năm kinh nghiệm
              </Typography>
            </Stack>
          )}
        </Stack>

        {coach.coachProfile?.specialties?.length > 0 && (
          <Stack
            direction="row"
            spacing={0.5}
            flexWrap="wrap"
            useFlexGap
            sx={{ mt: 0.5 }}
          >
            {coach.coachProfile.specialties.slice(0, 3).map((s) => (
              <Chip
                key={s}
                size="small"
                variant="outlined"
                label={s}
                sx={{ height: 22, fontSize: 11 }}
              />
            ))}
          </Stack>
        )}

        {/* Actions */}
        <Stack
          direction="row"
          spacing={1}
          sx={{ mt: "auto", pt: 1.5, flexWrap: "wrap" }}
          useFlexGap
        >
          <Button
            fullWidth
            variant="contained"
            size="small"
            startIcon={<MessageCircle size={16} />}
            onClick={() => onMessage(coach._id)}
            sx={{ textTransform: "none", flex: 1, minWidth: 120 }}
            disabled={!viewer}
          >
            Nhắn tin
          </Button>
          <IconButton
            size="small"
            component="a"
            href={hasPhone ? `tel:${coach.phone}` : undefined}
            disabled={!hasPhone}
            sx={{
              border: "1px solid",
              borderColor: hasPhone ? "success.main" : "divider",
              color: hasPhone ? "success.main" : "text.disabled",
              borderRadius: 2,
            }}
            aria-label="Gọi điện"
          >
            <Phone size={18} />
          </IconButton>
        </Stack>
      </CardContent>
    </Card>
  );
}

export default function CoachesPage() {
  const viewer = useSelector((s) => s.auth?.userInfo);
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [province, setProvince] = useState("");
  const [cursor, setCursor] = useState(null);
  const sentinelRef = useRef(null);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setCursor(null);
  }, [debouncedQ, province]);

  const { data, isFetching, isLoading } = useListCoachesQuery({
    q: debouncedQ || undefined,
    province: province || undefined,
    cursor,
    limit: 12,
  });
  const provincesQ = useListCoachProvincesQuery();
  const [openDm] = useOpenDmMutation();

  const items = data?.items || [];
  const hasMore = Boolean(data?.hasMore);
  const nextCursor = data?.nextCursor;

  // Infinite scroll
  useEffect(() => {
    if (!sentinelRef.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (
          entries[0]?.isIntersecting &&
          hasMore &&
          !isFetching &&
          nextCursor &&
          nextCursor !== cursor
        ) {
          setCursor(nextCursor);
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(sentinelRef.current);
    return () => io.disconnect();
  }, [hasMore, isFetching, nextCursor, cursor]);

  const provinceOptions = useMemo(
    () => provincesQ.data?.items || [],
    [provincesQ.data?.items],
  );

  const handleMessage = async (userId) => {
    if (!viewer) {
      navigate("/login");
      return;
    }
    try {
      const conv = await openDm(userId).unwrap();
      navigate(`/messages?c=${conv._id || conv.conversationId}`);
    } catch (err) {
      toast.error(err?.data?.message || "Không mở được cuộc trò chuyện");
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <SEOHead
        title="Huấn luyện viên Pickleball | PickleTour"
        description="Danh sách huấn luyện viên Pickleball trên PickleTour — sắp xếp theo điểm trình, tìm theo tỉnh thành."
        path="/coaches"
      />

      {/* Header */}
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="h4" fontWeight={900}>
          Huấn luyện viên
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Danh sách HLV chính thức, sắp xếp theo điểm trình. Bấm để xem hồ sơ, nhắn tin hoặc gọi trực tiếp.
        </Typography>
      </Stack>

      {/* Filters */}
      <Stack
        direction={{ xs: "column", sm: "row" }}
        spacing={1.5}
        sx={{ mb: 2.5 }}
      >
        <TextField
          size="small"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên hoặc biệt danh…"
          fullWidth
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <Search size={16} />
              </InputAdornment>
            ),
          }}
        />
        <Select
          size="small"
          value={province}
          onChange={(e) => setProvince(e.target.value)}
          displayEmpty
          sx={{ minWidth: { xs: "100%", sm: 220 } }}
        >
          <MenuItem value="">Tất cả tỉnh thành</MenuItem>
          {provinceOptions.map((p) => (
            <MenuItem key={p} value={p}>
              {p}
            </MenuItem>
          ))}
        </Select>
      </Stack>

      {/* List */}
      {isLoading && !items.length ? (
        <Box textAlign="center" py={6}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
          <Typography variant="h6" fontWeight={700} gutterBottom>
            Chưa có HLV nào phù hợp
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Thử bỏ bộ lọc hoặc tìm với từ khoá khác.
          </Typography>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {items.map((c) => (
            <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={c._id}>
              <CoachCard
                coach={c}
                viewer={viewer}
                onMessage={handleMessage}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <div ref={sentinelRef} style={{ height: 1 }} />
      {isFetching && cursor && (
        <Box textAlign="center" py={2}>
          <CircularProgress size={22} />
        </Box>
      )}
      {!hasMore && items.length > 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: "block", textAlign: "center", mt: 2 }}
        >
          Đã xem hết danh sách
        </Typography>
      )}
    </Container>
  );
}
