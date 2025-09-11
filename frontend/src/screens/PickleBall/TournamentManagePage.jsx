// src/pages/admin/TournamentManagePage.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
  Grid,
  Card,
  CardHeader,
  CardContent,
  Divider,
} from "@mui/material";
import {
  Edit as EditIcon,
  LinkOff as LinkOffIcon,
  OpenInNew as OpenInNewIcon,
  Search as SearchIcon,
  Sort as SortIcon,
  Sports as SportsIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useGetTournamentQuery,
  useAdminGetBracketsQuery,
  useAdminListMatchesByTournamentQuery,
  useAdminSetMatchLiveUrlMutation,
} from "../../slices/tournamentsApiSlice";

import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";

/* ---------- helpers ---------- */
const TYPE_LABEL = (t) => {
  const key = String(t || "").toLowerCase();
  if (key === "group") return "Vòng bảng";
  if (key === "po" || key === "playoff") return "Playoff";
  if (key === "knockout" || key === "ko") return "Knockout";
  if (key === "double_elim" || key === "doubleelim") return "Double Elim";
  if (key === "swiss") return "Swiss";
  if (key === "gsl") return "GSL";
  return t || "Khác";
};

// Ưu tiên nickname
const personNickname = (p) =>
  p?.nickname ||
  p?.nickName ||
  p?.nick ||
  p?.displayName ||
  p?.fullName ||
  p?.name ||
  "—";

const pairLabel = (pair) => {
  if (!pair) return "—";
  if (pair.name) return pair.name;
  const ps = [pair.player1, pair.player2].filter(Boolean).map(personNickname);
  return ps.join(" / ") || "—";
};

const matchCode = (m) => m?.code || `R${m?.round ?? "?"}-${m?.order ?? "?"}`;

const statusChip = (st) => {
  const map = {
    scheduled: { color: "default", label: "Chưa xếp" },
    queued: { color: "info", label: "Trong hàng chờ" },
    assigned: { color: "secondary", label: "Đã gán sân" },
    live: { color: "warning", label: "Đang thi đấu" },
    finished: { color: "success", label: "Đã kết thúc" },
  };
  const v = map[st] || { color: "default", label: st || "—" };
  return <Chip size="small" color={v.color} label={v.label} />;
};

export default function TournamentManagePage() {
  const { id } = useParams();
  const me = useSelector((s) => s.auth?.userInfo || null);

  // Tournament + Brackets + Matches
  const {
    data: tour,
    isLoading: tourLoading,
    error: tourErr,
  } = useGetTournamentQuery(id);
  const {
    data: brackets = [],
    isLoading: brLoading,
    error: brErr,
  } = useAdminGetBracketsQuery(id);
  const {
    data: matchPage,
    isLoading: mLoading,
    error: mErr,
  } = useAdminListMatchesByTournamentQuery({
    tid: id,
    page: 1,
    pageSize: 1000,
  });

  const [setLiveUrl, { isLoading: savingVideo }] =
    useAdminSetMatchLiveUrlMutation();

  // Quyền
  const isAdmin = !!(
    me?.isAdmin ||
    me?.role === "admin" ||
    (Array.isArray(me?.roles) && me.roles.includes("admin"))
  );
  const isManager = useMemo(() => {
    if (!me?._id || !tour) return false;
    if (String(tour.createdBy) === String(me._id)) return true;
    if (Array.isArray(tour.managers)) {
      return tour.managers.some((m) => String(m?.user ?? m) === String(me._id));
    }
    return !!tour?.isManager;
  }, [tour, me]);
  const canManage = isAdmin || isManager;

  // Tabs theo type
  const typeOrderWeight = (t) => {
    const k = String(t || "").toLowerCase();
    if (k === "group") return 1;
    if (k === "po" || k === "playoff") return 2;
    if (k === "knockout" || k === "ko") return 3;
    return 9;
  };
  const typesAvailable = useMemo(() => {
    const uniq = new Map();
    (brackets || []).forEach((b) => {
      const t = (b?.type || "").toString().toLowerCase();
      if (!t) return;
      if (!uniq.has(t))
        uniq.set(t, {
          type: t,
          label: TYPE_LABEL(t),
          weight: typeOrderWeight(t),
        });
    });
    if (uniq.size === 0)
      uniq.set("group", { type: "group", label: "Vòng bảng", weight: 1 });
    return Array.from(uniq.values()).sort((a, b) => a.weight - b.weight);
  }, [brackets]);

  const [tab, setTab] = useState(typesAvailable[0]?.type || "group");
  useEffect(() => {
    if (!typesAvailable.find((t) => t.type === tab)) {
      setTab(typesAvailable[0]?.type || "group");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typesAvailable]);

  const bracketsOfTab = useMemo(() => {
    const list = (brackets || []).filter(
      (b) => String(b?.type || "").toLowerCase() === String(tab).toLowerCase()
    );
    return list.sort((a, b) => {
      if ((a?.stage ?? 0) !== (b?.stage ?? 0))
        return (a?.stage ?? 0) - (b?.stage ?? 0);
      if ((a?.order ?? 0) !== (b?.order ?? 0))
        return (a?.order ?? 0) - (b?.order ?? 0);
      return new Date(a?.createdAt || 0) - new Date(b?.createdAt || 0);
    });
  }, [brackets, tab]);

  // Lọc/sort
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("round"); // round | order | time
  const [sortDir, setSortDir] = useState("asc"); // asc | desc

  // Viewer
  const [viewer, setViewer] = useState({ open: false, matchId: null });
  const openMatch = (mid) => setViewer({ open: true, matchId: mid });
  const closeMatch = () => setViewer({ open: false, matchId: null });

  const allMatches = matchPage?.list || [];

  const filterSortMatches = (list) => {
    const filtered = list
      .filter((m) => {
        if (!q.trim()) return true;
        const kw = q.trim().toLowerCase();
        const text = [
          matchCode(m),
          pairLabel(m?.pairA),
          pairLabel(m?.pairB),
          m?.status,
          m?.video,
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(kw);
      })
      .sort((a, b) => {
        const dir = sortDir === "asc" ? 1 : -1;
        if (sortKey === "order")
          return ((a?.order ?? 0) - (b?.order ?? 0)) * dir;
        if (sortKey === "time") {
          const ta = new Date(a?.scheduledAt || a?.createdAt || 0).getTime();
          const tb = new Date(b?.scheduledAt || b?.createdAt || 0).getTime();
          return (ta - tb) * dir;
        }
        if ((a?.round ?? 0) !== (b?.round ?? 0))
          return ((a?.round ?? 0) - (b?.round ?? 0)) * dir;
        return ((a?.order ?? 0) - (b?.order ?? 0)) * dir;
      });
    return filtered;
  };

  // Dialog gán video
  const [videoDlg, setVideoDlg] = useState({
    open: false,
    match: null,
    url: "",
  });
  const openVideoDlg = (m) =>
    setVideoDlg({ open: true, match: m, url: m?.video || "" });
  const closeVideoDlg = () =>
    setVideoDlg({ open: false, match: null, url: "" });

  const onSaveVideo = async () => {
    try {
      await setLiveUrl({
        matchId: videoDlg.match._id,
        video: videoDlg.url || "",
      }).unwrap();
      toast.success(videoDlg.url ? "Đã gán link video" : "Đã xoá link video");
      closeVideoDlg();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Không lưu được link video");
    }
  };

  /* ---------- guards ---------- */
  if (tourLoading || brLoading || mLoading) {
    return (
      <Box p={3} textAlign="center">
        <CircularProgress />
      </Box>
    );
  }
  if (tourErr || brErr || mErr) {
    return (
      <Box p={3}>
        <Alert severity="error">
          {tourErr?.data?.message ||
            brErr?.data?.message ||
            mErr?.data?.message ||
            "Lỗi tải dữ liệu"}
        </Alert>
      </Box>
    );
  }
  if (!canManage) {
    return (
      <Box p={3}>
        <Alert severity="warning">Bạn không có quyền truy cập trang này.</Alert>
        <Button component={Link} to={`/tournament/${id}`} sx={{ mt: 2 }}>
          Quay lại trang giải
        </Button>
      </Box>
    );
  }

  /* ---------- UI ---------- */
  return (
    <Box p={{ xs: 2, md: 3 }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        mb={2}
      >
        <Typography variant="h5" noWrap>
          Quản lý giải: {tour?.name}
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button
            component={Link}
            to={`/tournament/${id}`}
            variant="outlined"
            size="small"
          >
            Trang giải
          </Button>
          <Button
            component={Link}
            to={`/tournament/${id}/draw`}
            variant="contained"
            size="small"
          >
            Bốc thăm
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          {typesAvailable.map((t) => (
            <Tab key={t.type} label={TYPE_LABEL(t.type)} value={t.type} />
          ))}
        </Tabs>

        <Box p={2} display="flex" gap={1} flexWrap="wrap" alignItems="center">
          <TextField
            size="small"
            placeholder="Tìm trận, cặp đấu, link…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 240 }}
          />
          <TextField
            select
            size="small"
            label="Sắp xếp"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SortIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{ minWidth: 160 }}
          >
            <MenuItem value="round">Vòng (round → order)</MenuItem>
            <MenuItem value="order">Thứ tự (order)</MenuItem>
            <MenuItem value="time">Thời gian</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Chiều"
            value={sortDir}
            onChange={(e) => setSortDir(e.target.value)}
            sx={{ minWidth: 120 }}
          >
            <MenuItem value="asc">Tăng dần</MenuItem>
            <MenuItem value="desc">Giảm dần</MenuItem>
          </TextField>
          <Chip
            size="small"
            variant="outlined"
            label={`${bracketsOfTab.length} bracket • ${TYPE_LABEL(tab)}`}
            sx={{ ml: 1 }}
          />
        </Box>
      </Paper>

      {bracketsOfTab.length === 0 ? (
        <Alert severity="info">
          Chưa có bracket thuộc loại {TYPE_LABEL(tab)}.
        </Alert>
      ) : (
        bracketsOfTab.map((b) => {
          const bid = String(b?._id);
          const matches = (allMatches || []).filter((m) => {
            const mid = m?.bracket?._id || m?.bracket;
            return String(mid) === bid;
          });
          const list = filterSortMatches(matches);

          return (
            <Paper key={bid} variant="outlined" sx={{ mb: 2 }}>
              <Box p={2} pb={0}>
                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  flexWrap="wrap"
                >
                  <Typography variant="h6" noWrap>
                    {b?.name || "Bracket"}
                  </Typography>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={TYPE_LABEL(b?.type)}
                  />
                  {typeof b?.stage === "number" && (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`Stage ${b.stage}`}
                    />
                  )}
                  <Chip
                    size="small"
                    color="primary"
                    variant="outlined"
                    label={`${list.length} trận`}
                  />
                </Stack>
              </Box>

              {/* ===== Desktop: giữ nguyên bảng ===== */}
              <Box sx={{ display: { xs: "none", md: "block" } }}>
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>Mã</TableCell>
                        <TableCell sx={{ minWidth: 240 }}>Cặp A</TableCell>
                        <TableCell sx={{ minWidth: 240 }}>Cặp B</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Vòng
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Thứ tự
                        </TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Trạng thái
                        </TableCell>
                        <TableCell sx={{ minWidth: 200 }}>Link video</TableCell>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          Hành động
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {list.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={8} align="center">
                            <Typography color="text.secondary">
                              Chưa có trận nào.
                            </Typography>
                          </TableCell>
                        </TableRow>
                      ) : (
                        list.map((m) => (
                          <TableRow
                            key={m._id}
                            hover
                            onClick={() => openMatch(m._id)}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              {matchCode(m)}
                            </TableCell>
                            <TableCell>{pairLabel(m?.pairA)}</TableCell>
                            <TableCell>{pairLabel(m?.pairB)}</TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              {m?.round ?? "—"}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              {m?.order ?? "—"}
                            </TableCell>
                            <TableCell>{statusChip(m?.status)}</TableCell>
                            <TableCell>
                              {m?.video ? (
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  alignItems="center"
                                  flexWrap="wrap"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <Chip
                                    size="small"
                                    color="success"
                                    variant="outlined"
                                    label="đã gắn"
                                  />
                                  <Tooltip title={m.video} arrow>
                                    <IconButton
                                      size="small"
                                      component="a"
                                      href={m.video}
                                      target="_blank"
                                      rel="noopener"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <OpenInNewIcon fontSize="small" />
                                    </IconButton>
                                  </Tooltip>
                                </Stack>
                              ) : (
                                <Chip
                                  size="small"
                                  variant="outlined"
                                  label="chưa có"
                                />
                              )}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              <Tooltip title="Gán / sửa link video" arrow>
                                <span>
                                  <IconButton
                                    size="small"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openVideoDlg(m);
                                    }}
                                  >
                                    <EditIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                              {m?.video && (
                                <Tooltip title="Xoá link video" arrow>
                                  <span>
                                    <IconButton
                                      size="small"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setVideoDlg({
                                          open: true,
                                          match: m,
                                          url: "",
                                        });
                                      }}
                                    >
                                      <LinkOffIcon fontSize="small" />
                                    </IconButton>
                                  </span>
                                </Tooltip>
                              )}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>

              {/* ===== Mobile: Card Grid 2 cột (xs=6) – không full width ===== */}
              <Box sx={{ display: { xs: "block", md: "none" } }}>
                <Box p={2} pt={1}>
                  {list.length === 0 ? (
                    <Typography color="text.secondary" align="center" py={2}>
                      Chưa có trận nào.
                    </Typography>
                  ) : (
                    <Grid container spacing={1.2}>
                      {list.map((m) => {
                        const code = matchCode(m);
                        return (
                          <Grid key={m._id} item width={"100%"} xs={6}>
                            <Card
                              variant="outlined"
                              sx={{
                                height: "100%",
                                cursor: "pointer",
                                "&:hover": { boxShadow: 2 },
                              }}
                              onClick={() => openMatch(m._id)}
                            >
                              <CardHeader
                                sx={{ py: 1.2 }}
                                avatar={<SportsIcon fontSize="small" />}
                                titleTypographyProps={{
                                  variant: "subtitle2",
                                  noWrap: true,
                                }}
                                title={
                                  <Stack
                                    direction="row"
                                    spacing={0.5}
                                    alignItems="center"
                                    flexWrap="wrap"
                                  >
                                    <Typography variant="subtitle2" noWrap>
                                      {code}
                                    </Typography>
                                    {statusChip(m?.status)}
                                  </Stack>
                                }
                                subheader={
                                  <Stack
                                    direction="row"
                                    spacing={0.5}
                                    flexWrap="wrap"
                                  >
                                    {typeof m?.round === "number" && (
                                      <Chip
                                        size="small"
                                        label={`R${m.round}`}
                                      />
                                    )}
                                    {typeof m?.order === "number" && (
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label={`#${m.order}`}
                                      />
                                    )}
                                  </Stack>
                                }
                                action={
                                  <Stack direction="row" spacing={0.25}>
                                    <Tooltip title="Sửa link video" arrow>
                                      <span>
                                        <IconButton
                                          size="small"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openVideoDlg(m);
                                          }}
                                        >
                                          <EditIcon fontSize="small" />
                                        </IconButton>
                                      </span>
                                    </Tooltip>
                                    {m?.video && (
                                      <Tooltip title="Xoá link video" arrow>
                                        <span>
                                          <IconButton
                                            size="small"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setVideoDlg({
                                                open: true,
                                                match: m,
                                                url: "",
                                              });
                                            }}
                                          >
                                            <LinkOffIcon fontSize="small" />
                                          </IconButton>
                                        </span>
                                      </Tooltip>
                                    )}
                                  </Stack>
                                }
                              />
                              <Divider />
                              <CardContent sx={{ py: 1.25 }}>
                                <Stack spacing={0.5}>
                                  <Box>
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      Cặp A
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{ fontWeight: 600 }}
                                      noWrap
                                    >
                                      {pairLabel(m?.pairA)}
                                    </Typography>
                                  </Box>
                                  <Box>
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                    >
                                      Cặp B
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{ fontWeight: 600 }}
                                      noWrap
                                    >
                                      {pairLabel(m?.pairB)}
                                    </Typography>
                                  </Box>
                                  <Box onClick={(e) => e.stopPropagation()}>
                                    {m?.video ? (
                                      <Stack
                                        direction="row"
                                        spacing={0.75}
                                        alignItems="center"
                                        flexWrap="wrap"
                                      >
                                        <Chip
                                          size="small"
                                          color="success"
                                          variant="outlined"
                                          label="Có video"
                                        />
                                        <Tooltip title={m.video} arrow>
                                          <IconButton
                                            size="small"
                                            component="a"
                                            href={m.video}
                                            target="_blank"
                                            rel="noopener"
                                          >
                                            <OpenInNewIcon fontSize="small" />
                                          </IconButton>
                                        </Tooltip>
                                      </Stack>
                                    ) : (
                                      <Chip
                                        size="small"
                                        variant="outlined"
                                        label="Chưa có video"
                                      />
                                    )}
                                  </Box>
                                </Stack>
                              </CardContent>
                            </Card>
                          </Grid>
                        );
                      })}
                    </Grid>
                  )}
                </Box>
              </Box>
            </Paper>
          );
        })
      )}

      {/* Dialog gán link video */}
      <Dialog
        open={videoDlg.open}
        onClose={closeVideoDlg}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {videoDlg?.match
            ? videoDlg.match.code || matchCode(videoDlg.match)
            : ""}{" "}
          — Link video
        </DialogTitle>
        <DialogContent dividers>
          <TextField
            label="URL video (YouTube/Facebook/TikTok/M3U8…)"
            value={videoDlg.url}
            onChange={(e) =>
              setVideoDlg((s) => ({ ...s, url: e.target.value }))
            }
            fullWidth
            placeholder="https://…"
          />
          <Typography variant="caption" color="text.secondary">
            Dán link live hoặc VOD. Để trống rồi Lưu để xoá link.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeVideoDlg}>Huỷ</Button>
          <Button
            onClick={onSaveVideo}
            variant="contained"
            disabled={savingVideo}
          >
            {savingVideo ? "Đang lưu…" : videoDlg.url ? "Lưu link" : "Xoá link"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Popup xem/tracking trận */}
      <ResponsiveMatchViewer
        open={viewer.open}
        matchId={viewer.matchId}
        onClose={closeMatch}
      />
    </Box>
  );
}
