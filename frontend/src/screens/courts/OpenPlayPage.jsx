/* eslint-disable react/prop-types */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Grid,
  Card,
  CardContent,
  CardMedia,
  Chip,
  Stack,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
} from "@mui/material";
import SportsTennisIcon from "@mui/icons-material/SportsTennis";
import PlaceOutlinedIcon from "@mui/icons-material/PlaceOutlined";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PersonOutlineIcon from "@mui/icons-material/PersonOutline";
import GroupsIcon from "@mui/icons-material/Groups";
import {
  useListOpenPlayQuery,
  useJoinOpenPlayMutation,
} from "../../slices/bookingsApiSlice";
import { imgSrc, fmtVND } from "./courtShared";

/** Nhãn chính sách giới tính. */
function genderLabel(policy) {
  switch (policy) {
    case "male":
      return "Chỉ nam";
    case "female":
      return "Chỉ nữ";
    case "balanced":
      return "Cân bằng nam/nữ";
    default:
      return "";
  }
}

/** Nhãn điểm trình. */
function skillLabel(min, max) {
  if (min == null && max == null) return "Mọi trình";
  if (min != null && max != null) return `${min}–${max}`;
  return min != null ? `từ ${min}` : `đến ${max}`;
}

function fmtDateTime(x) {
  if (!x) return "";
  return new Date(x).toLocaleString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function OpenPlayCard({ item, onJoin, onOpenVenue, joining }) {
  const cover = imgSrc(item.coverImage);
  const full = (item.slotsLeft ?? 0) <= 0;
  const gLabel = genderLabel(item.genderPolicy);
  return (
    <Card
      variant="outlined"
      sx={{
        height: "100%",
        borderRadius: 3,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {cover ? (
        <CardMedia
          component="img"
          image={cover}
          alt={item.venueName}
          sx={{ height: 168, objectFit: "cover" }}
        />
      ) : (
        <Box
          sx={{
            height: 168,
            display: "grid",
            placeItems: "center",
            bgcolor: "action.hover",
          }}
        >
          <SportsTennisIcon sx={{ fontSize: 52, color: "text.disabled" }} />
        </Box>
      )}

      <CardContent sx={{ flex: 1, display: "flex", flexDirection: "column", gap: 0.75 }}>
        <Typography
          variant="subtitle1"
          fontWeight={800}
          sx={{
            lineHeight: 1.25,
            cursor: item.venueId ? "pointer" : "default",
            "&:hover": item.venueId ? { color: "primary.main" } : undefined,
          }}
          onClick={() => item.venueId && onOpenVenue(item.venueId)}
        >
          {item.venueName}
          {item.courtName ? ` · ${item.courtName}` : ""}
        </Typography>

        {item.hostName ? (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
            <PersonOutlineIcon sx={{ fontSize: 16 }} />
            <Typography variant="body2">Chủ kèo: {item.hostName}</Typography>
          </Stack>
        ) : null}

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary" }}>
          <AccessTimeIcon sx={{ fontSize: 16 }} />
          <Typography variant="body2">
            {fmtDateTime(item.startAt)}
            {item.endAt ? ` → ${fmtDateTime(item.endAt)}` : ""}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary", minWidth: 0 }}>
          <PlaceOutlinedIcon sx={{ fontSize: 16, flexShrink: 0 }} />
          <Typography variant="body2" noWrap>
            {item.address || item.province || "Chưa cập nhật"}
          </Typography>
        </Stack>

        <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap sx={{ mt: 0.5 }}>
          <Chip
            size="small"
            color={item.pricePerPerson > 0 ? "primary" : "success"}
            label={item.pricePerPerson > 0 ? `${fmtVND(item.pricePerPerson)}/người` : "Miễn phí"}
            sx={{ fontWeight: 700 }}
          />
          <Chip size="small" variant="outlined" label={`Trình: ${skillLabel(item.skillMin, item.skillMax)}`} />
          {gLabel ? <Chip size="small" variant="outlined" label={gLabel} /> : null}
        </Stack>

        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: full ? "error.main" : "text.secondary", mt: 0.5 }}>
          <GroupsIcon sx={{ fontSize: 16 }} />
          <Typography variant="body2" fontWeight={600}>
            {full ? "Đã đủ người" : `còn ${item.slotsLeft} suất`}
            {item.capacity ? ` / ${item.capacity}` : ""}
          </Typography>
        </Stack>

        {item.note ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {item.note}
          </Typography>
        ) : null}

        <Box sx={{ flex: 1 }} />
        <Button
          variant="contained"
          fullWidth
          disabled={full || joining}
          onClick={() => onJoin(item._id)}
          sx={{ mt: 1.5, fontWeight: 700, borderRadius: 2 }}
        >
          {full ? "Hết suất" : "Tham gia"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function OpenPlayPage() {
  const navigate = useNavigate();
  const [province] = useState("");
  const { data, isLoading, isFetching, refetch } = useListOpenPlayQuery({ province });
  const [joinOpenPlay, { isLoading: joining }] = useJoinOpenPlayMutation();
  const [snack, setSnack] = useState({ open: false, msg: "", severity: "success" });

  const items = Array.isArray(data) ? data : data?.items || [];
  const loading = isLoading || isFetching;

  const handleJoin = async (id) => {
    try {
      await joinOpenPlay(id).unwrap();
      setSnack({ open: true, msg: "Đã tham gia, liên hệ chủ kèo", severity: "success" });
      refetch();
    } catch (err) {
      setSnack({
        open: true,
        msg: err?.data?.message || "Không tham gia được, thử lại sau.",
        severity: "error",
      });
    }
  };

  return (
    <Container maxWidth="lg" sx={{ py: { xs: 2.5, md: 4 } }}>
      <Typography variant="h4" fontWeight={900} sx={{ letterSpacing: "-0.02em" }}>
        Sân mở ghép
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
        Tham gia đánh chung, chia tiền theo đầu người.
      </Typography>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : items.length === 0 ? (
        <Alert severity="info">Chưa có lượt mở ghép nào.</Alert>
      ) : (
        <Grid container spacing={2.5}>
          {items.map((item) => (
            <Grid item xs={12} md={6} key={item._id}>
              <OpenPlayCard
                item={item}
                joining={joining}
                onJoin={handleJoin}
                onOpenVenue={(vid) => navigate(`/courts/${vid}`)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((s) => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={snack.severity}
          variant="filled"
          onClose={() => setSnack((s) => ({ ...s, open: false }))}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Container>
  );
}
