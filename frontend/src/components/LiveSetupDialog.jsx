/* eslint-disable react/prop-types */
import React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  Checkbox,
  LinearProgress,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import {
  Stadium as StadiumIcon,
  LinkOff as LinkOffIcon,
  Movie as MovieIcon,
  OpenInNew as OpenInNewIcon,
} from "@mui/icons-material";
import { Link as RouterLink } from "react-router-dom";
import { toast } from "react-toastify";

/* 👉 chỉnh path cho khớp dự án của bạn */
import ResponsiveModal from "./ResponsiveModal";

/* RTK hooks – dialog tự xử lý dữ liệu */
import {
  useAdminListCourtsByTournamentQuery,
  useAdminSetCourtLiveConfigMutation,
  useAdminBulkSetCourtLiveConfigMutation,
} from "../slices/courtsApiSlice";
import { useAdminListMatchesByTournamentQuery } from "../slices/tournamentsApiSlice";

/* ===== Helpers ===== */
const isMongoId = (s) => typeof s === "string" && /^[a-f0-9]{24}$/i.test(s);

const extractCourtId = (cObj) => {
  if (!cObj) return null;
  if (typeof cObj === "string") return isMongoId(cObj) ? cObj : null;
  if (typeof cObj === "object")
    return cObj._id ? String(cObj._id) : cObj.id ? String(cObj.id) : null;
  return null;
};

const courtLabelFromMatch = (m) => {
  const c = m?.courtAssigned || m?.assignedCourt || m?.court || null;
  const directName =
    m?.courtName || m?.courtLabel || m?.courtCode || m?.courtTitle || null;
  if (directName && String(directName).trim()) return String(directName).trim();
  if (!c) return "—";
  if (typeof c === "string") {
    if (!c.trim() || isMongoId(c)) return "—";
    return c.trim();
  }
  if (c?.name) return c.name;
  if (c?.label) return c.label;
  if (c?.code) return c.code;
  if (Number.isFinite(c?.number)) return `Sân ${c.number}`;
  if (Number.isFinite(c?.no)) return `Sân ${c.no}`;
  return "—";
};

const matchBelongsToCourt = (m, court) => {
  const mid = extractCourtId(m?.courtAssigned || m?.assignedCourt || m?.court);
  if (mid && String(mid) === String(court._id)) return true;
  const mLabel = courtLabelFromMatch(m);
  const cLabel =
    court?.name ||
    court?.label ||
    court?.code ||
    (Number.isFinite(court?.number) ? `Sân ${court.number}` : "");
  return (
    String(mLabel || "")
      .trim()
      .toLowerCase() ===
    String(cLabel || "")
      .trim()
      .toLowerCase()
  );
};

const countByStatus = (matches) => {
  let total = matches.length,
    live = 0,
    notFinished = 0;
  for (const m of matches) {
    const st = String(m?.status || "").toLowerCase();
    if (st === "live") live++;
    if (st !== "finished") notFinished++;
  }
  return { total, live, notFinished };
};

const mostCommonUrl = (ms = []) => {
  const freq = new Map();
  for (const m of ms) {
    const v = (m?.video || "").trim();
    if (!v) continue;
    freq.set(v, (freq.get(v) || 0) + 1);
  }
  if (!freq.size) return "";
  return Array.from(freq.entries()).sort((a, b) => b[1] - a[1])[0][0];
};

/* ===== Component ===== */
export default function LiveSetupDialog({
  open,
  onClose,
  tournamentId, // REQUIRED
  bracketId, // OPTIONAL
  buildCourtLiveUrl,
}) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));

  const buildLiveUrl = React.useCallback(
    (tid, bid, court) =>
      buildCourtLiveUrl
        ? buildCourtLiveUrl.length >= 3
          ? buildCourtLiveUrl(tid, bid ?? null, court)
          : buildCourtLiveUrl(tid, court)
        : `/streaming/${court._id}`,
    [buildCourtLiveUrl],
  );

  /* 1) Courts theo giải */
  const {
    data: courtsResp,
    isLoading: courtsLoading,
    isError: courtsErr,
    refetch: refetchCourts,
  } = useAdminListCourtsByTournamentQuery(
    { tid: tournamentId },
    { skip: !open || !tournamentId },
  );

  const courts = React.useMemo(() => {
    const items = Array.isArray(courtsResp)
      ? courtsResp
      : Array.isArray(courtsResp?.items)
        ? courtsResp.items
        : [];
    return items.map((c) => ({
      ...c,
      _id: String(c._id),
      displayLabel:
        c.name ||
        c.label ||
        c.code ||
        (Number.isFinite(c.number)
          ? `Sân ${c.number}`
          : `Sân #${String(c._id).slice(-4)}`),
      liveConfig: {
        enabled: !!c?.liveConfig?.enabled,
        videoUrl: (c?.liveConfig?.videoUrl || "").trim(),
        overrideExisting: !!c?.liveConfig?.overrideExisting,
      },
    }));
  }, [courtsResp]);

  /* 2) Matches theo giải */
  const {
    data: matchPage,
    isLoading: matchesLoading,
    refetch: refetchMatches,
  } = useAdminListMatchesByTournamentQuery(
    { tid: tournamentId, page: 1, pageSize: 1000 },
    { skip: !open || !tournamentId },
  );

  // 🔁 GỌI API MỖI LẦN MỞ
  React.useEffect(() => {
    if (open && tournamentId) {
      refetchCourts?.();
      refetchMatches?.();
    }
  }, [open, tournamentId, refetchCourts, refetchMatches]);

  const matchesAll = React.useMemo(
    () => (Array.isArray(matchPage?.list) ? matchPage.list : []),
    [matchPage],
  );

  const matchesByCourtId = React.useMemo(() => {
    const map = new Map();
    for (const c of courts) map.set(String(c._id), []);
    for (const m of matchesAll) {
      let assigned = false;
      const mid = extractCourtId(
        m?.courtAssigned || m?.assignedCourt || m?.court,
      );
      if (mid && map.has(String(mid))) {
        map.get(String(mid)).push(m);
        assigned = true;
      }
      if (!assigned) {
        for (const c of courts) {
          if (matchBelongsToCourt(m, c)) {
            map.get(String(c._id))?.push(m);
            break;
          }
        }
      }
    }
    return map;
  }, [courts, matchesAll]);

  /* 3) Form state */
  const [form, setForm] = React.useState({});
  const [overrideExisting, setOverrideExisting] = React.useState(false);
  const [busy, setBusy] = React.useState(new Set());
  const initialFormRef = React.useRef({});

  React.useEffect(() => {
    if (!open) return;
    const next = {};
    for (const c of courts) {
      next[c._id] = {
        enabled: !!c.liveConfig.enabled,
        videoUrl: c.liveConfig.videoUrl || "",
      };
    }
    setForm(next);
    setOverrideExisting(false);
    initialFormRef.current = next;
  }, [open, courts]);

  /* 4) Mutations */
  const [setCourtCfg, { isLoading: saving }] =
    useAdminSetCourtLiveConfigMutation();
  const [bulkSetCourtCfg, { isLoading: bulkSaving }] =
    useAdminBulkSetCourtLiveConfigMutation();

  const onChangeCourtField = (courtId, patch) => {
    setForm((s) => ({ ...s, [courtId]: { ...(s[courtId] || {}), ...patch } }));
  };

  const saveCourt = async (courtId) => {
    const v = form[courtId] || { enabled: false, videoUrl: "" };
    const work = new Set(busy);
    work.add(courtId);
    setBusy(work);
    try {
      await setCourtCfg({
        courtId,
        enabled: !!v.enabled,
        videoUrl: (v.videoUrl || "").trim(),
        overrideExisting,
      }).unwrap();
      toast.success("Đã lưu cấu hình LIVE cho sân");
      await refetchCourts?.();
      initialFormRef.current = {
        ...initialFormRef.current,
        [courtId]: {
          enabled: !!v.enabled,
          videoUrl: (v.videoUrl || "").trim(),
        },
      };
    } catch (e) {
      toast.error(e?.data?.message || "Lưu cấu hình LIVE thất bại");
    } finally {
      const done = new Set(busy);
      done.delete(courtId);
      setBusy(done);
    }
  };

  const saveAll = async () => {
    const items = courts
      .map((c) => {
        const cur = form[c._id] || { enabled: false, videoUrl: "" };
        const prev = initialFormRef.current[c._id] || {
          enabled: false,
          videoUrl: "",
        };
        const changed =
          !!cur.enabled !== !!prev.enabled ||
          String((cur.videoUrl || "").trim()) !==
            String((prev.videoUrl || "").trim());
        if (!changed) return null;
        return {
          courtId: c._id,
          enabled: !!cur.enabled,
          videoUrl: (cur.videoUrl || "").trim(),
          overrideExisting: !!overrideExisting,
        };
      })
      .filter(Boolean);

    if (items.length === 0) {
      toast.info("Không có thay đổi nào để lưu.");
      return;
    }

    try {
      await bulkSetCourtCfg({ tid: tournamentId, items }).unwrap();
      toast.success(`Đã lưu cấu hình LIVE cho ${items.length} sân`);
      const newSnap = { ...initialFormRef.current };
      for (const it of items) {
        newSnap[it.courtId] = {
          enabled: it.enabled,
          videoUrl: it.videoUrl,
        };
      }
      initialFormRef.current = newSnap;
      await refetchCourts?.();
    } catch (e) {
      toast.error(e?.data?.message || "Lưu cấu hình LIVE (bulk) thất bại");
    }
  };

  const loadingAny = courtsLoading || matchesLoading;

  return (
    <ResponsiveModal
      open={open}
      onClose={onClose}
      maxWidth="xl"
      icon={<MovieIcon />}
      title="Thiết lập LIVE — Toàn giải"
      paperSx={{
        width: { xs: "100%", sm: "96vw" },
        maxWidth: 1500,
        height: { xs: "100%", md: "90vh" },
      }}
      contentProps={{ sx: { pt: 1 } }}
      actions={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="contained"
            onClick={saveAll}
            startIcon={<MovieIcon />}
            disabled={bulkSaving || saving || courts.length === 0}
          >
            Lưu tất cả sân
          </Button>
        </>
      }
    >
      {loadingAny && <LinearProgress sx={{ mb: 2 }} />}

      <Stack spacing={2}>
        <Alert severity="info">
          Cấu hình LIVE <b>theo SÂN</b>. Khi trọng tài bắt đầu trận (hoặc khi
          server áp dụng), URL LIVE mặc định của sân sẽ tự gán cho trận thuộc
          sân đó.
        </Alert>

        {courtsErr ? (
          <Alert severity="error">Không tải được danh sách sân.</Alert>
        ) : courts.length === 0 ? (
          <Alert severity="warning">Chưa có sân trong giải này.</Alert>
        ) : (
          <>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Checkbox
                size="small"
                checked={overrideExisting}
                onChange={(e) => setOverrideExisting(e.target.checked)}
              />
              <Typography variant="body2">
                Cho phép <b>ghi đè</b> link LIVE đã có trong trận
              </Typography>
            </Stack>

            {/* Desktop */}
            <TableContainer
              component={Paper}
              variant="outlined"
              sx={{ display: { xs: "none", md: "block" } }}
            >
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Sân</TableCell>
                    <TableCell>Trận (tổng / live / chưa kết thúc)</TableCell>
                    <TableCell>LIVE hiện tại (mẫu từ trận)</TableCell>
                    <TableCell sx={{ width: 80 }}>Bật</TableCell>
                    <TableCell>URL LIVE mặc định</TableCell>
                    <TableCell align="right">Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {courts.map((c) => {
                    const cMatches = matchesByCourtId.get(c._id) || [];
                    const cnt = countByStatus(cMatches);
                    const sample = mostCommonUrl(cMatches);
                    const v = form[c._id] || {
                      enabled: false,
                      videoUrl: "",
                    };
                    const isBusy = busy.has(c._id);

                    return (
                      <TableRow key={c._id}>
                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          <Chip
                            size="small"
                            icon={<StadiumIcon />}
                            label={c.displayLabel}
                          />
                        </TableCell>

                        <TableCell sx={{ whiteSpace: "nowrap" }}>
                          {cnt.total} / {cnt.live} / {cnt.notFinished}
                        </TableCell>

                        <TableCell sx={{ maxWidth: 320 }}>
                          {sample ? (
                            <Tooltip title={sample} arrow>
                              <Typography variant="body2" noWrap>
                                {sample}
                              </Typography>
                            </Tooltip>
                          ) : (
                            <Typography variant="body2" color="text.secondary">
                              (chưa có)
                            </Typography>
                          )}
                        </TableCell>

                        <TableCell sx={{ width: 80 }}>
                          <Checkbox
                            size="small"
                            checked={!!v.enabled}
                            sx={{ mx: 0.5 }}
                            onChange={(e) =>
                              onChangeCourtField(c._id, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                        </TableCell>

                        <TableCell sx={{ minWidth: 320 }}>
                          <TextField
                            size="small"
                            fullWidth
                            placeholder="https://… (để trống nếu muốn tắt/xoá)"
                            value={v.videoUrl}
                            onChange={(e) =>
                              onChangeCourtField(c._id, {
                                videoUrl: e.target.value,
                              })
                            }
                          />
                        </TableCell>

                        <TableCell align="right">
                          <Stack direction="row" spacing={1}>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<MovieIcon />}
                              disabled={isBusy || saving || bulkSaving}
                              onClick={() => saveCourt(c._id)}
                            >
                              Lưu sân
                            </Button>
                            <Button
                              size="small"
                              color="error"
                              variant="outlined"
                              startIcon={<LinkOffIcon />}
                              disabled={isBusy || saving || bulkSaving}
                              onClick={() => {
                                onChangeCourtField(c._id, {
                                  enabled: false,
                                  videoUrl: "",
                                });
                                saveCourt(c._id);
                              }}
                            >
                              Tắt
                            </Button>
                            {v.enabled && (
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<OpenInNewIcon />}
                                component={RouterLink}
                                to={buildLiveUrl(
                                  tournamentId,
                                  bracketId ?? null,
                                  c,
                                )}
                                target="_blank"
                                rel="noopener"
                              >
                                Mở studio LIVE
                              </Button>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>

            {/* Mobile */}
            <Stack spacing={1} sx={{ display: { xs: "flex", md: "none" } }}>
              {courts.map((c) => {
                const cMatches = matchesByCourtId.get(c._id) || [];
                const cnt = countByStatus(cMatches);
                const sample = mostCommonUrl(cMatches);
                const v = form[c._id] || {
                  enabled: false,
                  videoUrl: "",
                };
                const isBusy = busy.has(c._id);

                return (
                  <Paper
                    key={c._id}
                    variant="outlined"
                    sx={{ p: 1.25, borderRadius: 2 }}
                  >
                    <Stack spacing={1.25}>
                      <Stack
                        direction="row"
                        alignItems="center"
                        spacing={1}
                        flexWrap="wrap"
                      >
                        <Chip
                          size="small"
                          icon={<StadiumIcon />}
                          label={c.displayLabel}
                        />
                        <Typography variant="body2" color="text.secondary">
                          {cnt.total} / {cnt.live} / {cnt.notFinished}
                        </Typography>
                        <Box sx={{ flex: 1 }} />
                        <Stack
                          direction="row"
                          alignItems="center"
                          spacing={0.5}
                        >
                          <Typography variant="caption">Bật</Typography>
                          <Checkbox
                            size="small"
                            checked={!!v.enabled}
                            sx={{ p: 0.5 }}
                            onChange={(e) =>
                              onChangeCourtField(c._id, {
                                enabled: e.target.checked,
                              })
                            }
                          />
                        </Stack>
                      </Stack>

                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block", mb: 0.5 }}
                        >
                          LIVE hiện tại (mẫu từ trận)
                        </Typography>
                        {sample ? (
                          <Tooltip title={sample} arrow>
                            <Typography
                              variant="body2"
                              noWrap
                              sx={{ maxWidth: "100%" }}
                            >
                              {sample}
                            </Typography>
                          </Tooltip>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            (chưa có)
                          </Typography>
                        )}
                      </Box>

                      <TextField
                        size="small"
                        fullWidth
                        placeholder="URL LIVE mặc định https://…"
                        value={v.videoUrl}
                        onChange={(e) =>
                          onChangeCourtField(c._id, {
                            videoUrl: e.target.value,
                          })
                        }
                      />

                      <Stack
                        direction="row"
                        spacing={1}
                        flexWrap="wrap"
                        useFlexGap
                      >
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<MovieIcon />}
                          disabled={isBusy || saving || bulkSaving}
                          onClick={() => saveCourt(c._id)}
                        >
                          Lưu sân
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          variant="outlined"
                          startIcon={<LinkOffIcon />}
                          disabled={isBusy || saving || bulkSaving}
                          onClick={() => {
                            onChangeCourtField(c._id, {
                              enabled: false,
                              videoUrl: "",
                            });
                            saveCourt(c._id);
                          }}
                        >
                          Tắt
                        </Button>
                        {v.enabled && (
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<OpenInNewIcon />}
                            component={RouterLink}
                            to={buildLiveUrl(
                              tournamentId,
                              bracketId ?? null,
                              c,
                            )}
                            target="_blank"
                            rel="noopener"
                          >
                            Mở studio LIVE
                          </Button>
                        )}
                      </Stack>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </>
        )}
      </Stack>
    </ResponsiveModal>
  );
}
