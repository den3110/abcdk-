// src/components/TournamentReviews.jsx — Đánh giá giải đấu (web)
import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import {
  Box,
  Stack,
  Typography,
  Rating,
  TextField,
  Button,
  Avatar,
  Chip,
  LinearProgress,
  Divider,
  IconButton,
} from "@mui/material";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import EditRoundedIcon from "@mui/icons-material/EditRounded";
import DeleteOutlineRoundedIcon from "@mui/icons-material/DeleteOutlineRounded";
import {
  useGetReviewsQuery,
  useUpsertReviewMutation,
  useDeleteMyReviewMutation,
} from "../slices/reviewApiSlice";

const ACCENT = "#f59e0b";

const uname = (u) => u?.nickname || u?.name || "Ẩn danh";
const fmtDate = (d) => {
  try {
    return new Date(d).toLocaleDateString("vi-VN");
  } catch {
    return "";
  }
};

const ASPECTS = [
  { key: "organization", label: "Tổ chức" },
  { key: "venue", label: "Sân bãi" },
  { key: "value", label: "Xứng đáng" },
];

export default function TournamentReviews({ tournamentId }) {
  const targetType = "tournament";
  const userInfo = useSelector((s) => s.auth?.userInfo);

  const { data, isLoading } = useGetReviewsQuery(
    { targetType, targetId: tournamentId, page: 1, limit: 50 },
    { skip: !tournamentId }
  );
  const [upsert, { isLoading: saving }] = useUpsertReviewMutation();
  const [removeReview] = useDeleteMyReviewMutation();

  const summary = data?.summary;
  const mine = data?.mine;
  const items = data?.items || [];

  const [rating, setRating] = useState(0);
  const [aspects, setAspects] = useState({ organization: 0, venue: 0, value: 0 });
  const [comment, setComment] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (mine) {
      setRating(mine.rating || 0);
      setAspects({
        organization: mine.aspects?.organization || 0,
        venue: mine.aspects?.venue || 0,
        value: mine.aspects?.value || 0,
      });
      setComment(mine.comment || "");
    }
  }, [mine?._id]);

  const showForm = editing || !mine;

  const submit = async () => {
    if (!rating) return;
    try {
      await upsert({
        targetType,
        targetId: tournamentId,
        rating,
        comment: comment.trim(),
        aspects: {
          organization: aspects.organization || null,
          venue: aspects.venue || null,
          value: aspects.value || null,
        },
      }).unwrap();
      setEditing(false);
    } catch (e) {
      alert(e?.data?.message || "Không gửi được đánh giá.");
    }
  };

  const onDelete = async () => {
    if (!window.confirm("Xoá đánh giá của bạn?")) return;
    try {
      await removeReview({ targetType, targetId: tournamentId }).unwrap();
      setRating(0);
      setAspects({ organization: 0, venue: 0, value: 0 });
      setComment("");
      setEditing(false);
    } catch (e) {
      alert(e?.data?.message || "Không xoá được.");
    }
  };

  const card = {
    borderRadius: "18px",
    border: "1px solid var(--color-border)",
    background: "var(--color-background-surface)",
    p: "22px 24px",
  };

  return (
    <Box sx={{ mt: "44px" }}>
      <Stack direction="row" alignItems="center" spacing={1.2} sx={{ mb: 2.2 }}>
        <StarRoundedIcon sx={{ color: ACCENT }} />
        <Typography sx={{ color: "var(--pk-text-strong)", fontWeight: 750, fontSize: 20 }}>
          Đánh giá giải đấu
        </Typography>
        {summary?.count > 0 && (
          <Chip
            size="small"
            label={`${summary.avg?.toFixed(1)} ★ · ${summary.count}`}
            sx={{ bgcolor: "rgba(245,158,11,.15)", color: ACCENT, fontWeight: 700 }}
          />
        )}
      </Stack>

      {isLoading ? (
        <LinearProgress />
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0,1fr) minmax(300px,.9fr)" }, gap: 2.5, alignItems: "start" }}>
          {/* Left: summary + list */}
          <Box>
            {/* Summary */}
            <Box sx={card}>
              <Stack direction="row" spacing={3} alignItems="center">
                <Box sx={{ textAlign: "center", minWidth: 92 }}>
                  <Typography sx={{ fontSize: 44, fontWeight: 900, color: "var(--pk-text-strong)", lineHeight: 1 }}>
                    {summary?.avg ? summary.avg.toFixed(1) : "—"}
                  </Typography>
                  <Rating value={summary?.avg || 0} precision={0.5} readOnly size="small" sx={{ mt: 0.5 }} />
                  <Typography sx={{ color: "var(--pk-text)", opacity: 0.7, fontSize: 13, mt: 0.5 }}>
                    {summary?.count || 0} đánh giá
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }}>
                  {[5, 4, 3, 2, 1].map((s) => {
                    const c = summary?.dist?.[s] || 0;
                    const total = summary?.count || 0;
                    const pct = total ? (c / total) * 100 : 0;
                    return (
                      <Stack key={s} direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                        <Typography sx={{ fontSize: 12, color: "var(--pk-text)", opacity: 0.7, width: 10 }}>{s}</Typography>
                        <StarRoundedIcon sx={{ fontSize: 12, color: ACCENT }} />
                        <Box sx={{ flex: 1, height: 7, borderRadius: 4, bgcolor: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                          <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: ACCENT }} />
                        </Box>
                        <Typography sx={{ fontSize: 12, color: "var(--pk-text)", opacity: 0.7, width: 22, textAlign: "right" }}>{c}</Typography>
                      </Stack>
                    );
                  })}
                </Box>
              </Stack>
              {summary?.count > 0 && (
                <Stack direction="row" divider={<Divider orientation="vertical" flexItem />} sx={{ mt: 2, pt: 2, borderTop: "1px solid var(--color-border)" }}>
                  {ASPECTS.map((a) => (
                    <Box key={a.key} sx={{ flex: 1, textAlign: "center" }}>
                      <Typography sx={{ fontSize: 18, fontWeight: 800, color: "var(--pk-text-strong)" }}>
                        {summary.aspects?.[a.key] ? summary.aspects[a.key].toFixed(1) : "—"}
                      </Typography>
                      <Typography sx={{ fontSize: 12, color: "var(--pk-text)", opacity: 0.7 }}>{a.label}</Typography>
                    </Box>
                  ))}
                </Stack>
              )}
            </Box>

            {/* Review list */}
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {items.length === 0 ? (
                <Typography sx={{ color: "var(--pk-text)", opacity: 0.6, textAlign: "center", py: 3 }}>
                  Chưa có đánh giá nào. Hãy là người đầu tiên!
                </Typography>
              ) : (
                items.map((r) => (
                  <Box key={r._id} sx={{ ...card, p: "16px 18px" }}>
                    <Stack direction="row" spacing={1.2} alignItems="flex-start">
                      <Avatar src={r.reviewer?.avatar} sx={{ width: 38, height: 38 }}>
                        {uname(r.reviewer)[0]}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Typography sx={{ fontWeight: 700, color: "var(--pk-text-strong)" }} noWrap>
                            {uname(r.reviewer)}
                          </Typography>
                          {r.verified && (
                            <Chip size="small" label="Đã tham gia" sx={{ height: 18, fontSize: 10, bgcolor: "rgba(34,197,94,.15)", color: "#22c55e" }} />
                          )}
                        </Stack>
                        <Stack direction="row" alignItems="center" spacing={1}>
                          <Rating value={r.rating} readOnly size="small" />
                          <Typography sx={{ fontSize: 12, color: "var(--pk-text)", opacity: 0.6 }}>
                            {fmtDate(r.createdAt)}
                          </Typography>
                        </Stack>
                        {!!r.comment && (
                          <Typography sx={{ mt: 0.6, color: "var(--pk-text)", fontSize: 14, lineHeight: 1.5 }}>
                            {r.comment}
                          </Typography>
                        )}
                      </Box>
                    </Stack>
                  </Box>
                ))
              )}
            </Stack>
          </Box>

          {/* Right: write / your review */}
          <Box sx={{ ...card, position: { md: "sticky" }, top: { md: 90 } }}>
            {!userInfo ? (
              <Stack alignItems="center" spacing={1.5} sx={{ py: 2 }}>
                <Typography sx={{ color: "var(--pk-text)", opacity: 0.8 }}>
                  Đăng nhập để đánh giá giải này
                </Typography>
                <Button variant="contained" href="/login" sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: "#d97706" } }}>
                  Đăng nhập
                </Button>
              </Stack>
            ) : showForm ? (
              <>
                <Typography sx={{ fontWeight: 750, fontSize: 16, color: "var(--pk-text-strong)", mb: 1 }}>
                  {mine ? "Sửa đánh giá của bạn" : "Viết đánh giá"}
                </Typography>
                <Box sx={{ textAlign: "center", my: 1 }}>
                  <Rating value={rating} onChange={(_, v) => setRating(v || 0)} size="large" />
                </Box>
                <Stack spacing={0.5} sx={{ mb: 1 }}>
                  {ASPECTS.map((a) => (
                    <Stack key={a.key} direction="row" alignItems="center" justifyContent="space-between">
                      <Typography sx={{ fontSize: 13, color: "var(--pk-text)", opacity: 0.8 }}>{a.label}</Typography>
                      <Rating
                        value={aspects[a.key]}
                        onChange={(_, v) => setAspects((p) => ({ ...p, [a.key]: v || 0 }))}
                        size="small"
                      />
                    </Stack>
                  ))}
                </Stack>
                <TextField
                  fullWidth
                  multiline
                  minRows={3}
                  placeholder="Chia sẻ trải nghiệm của bạn…"
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, 1000))}
                  size="small"
                  sx={{ mb: 1.5 }}
                />
                <Stack direction="row" spacing={1}>
                  {mine && (
                    <Button variant="outlined" onClick={() => setEditing(false)} fullWidth>
                      Huỷ
                    </Button>
                  )}
                  <Button
                    variant="contained"
                    onClick={submit}
                    disabled={saving || !rating}
                    fullWidth
                    sx={{ bgcolor: ACCENT, "&:hover": { bgcolor: "#d97706" } }}
                  >
                    {saving ? "Đang gửi…" : "Gửi đánh giá"}
                  </Button>
                </Stack>
              </>
            ) : (
              <>
                <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography sx={{ fontWeight: 750, fontSize: 16, color: "var(--pk-text-strong)" }}>
                    Đánh giá của bạn
                  </Typography>
                  <Box>
                    <IconButton size="small" onClick={() => setEditing(true)}>
                      <EditRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={onDelete} sx={{ color: "#ef4444" }}>
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </Stack>
                <Rating value={mine.rating} readOnly />
                {!!mine.comment && (
                  <Typography sx={{ mt: 1, color: "var(--pk-text)", fontSize: 14 }}>
                    {mine.comment}
                  </Typography>
                )}
              </>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
