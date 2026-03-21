// src/pages/TournamentCheckin.jsx
/* eslint-disable react/prop-types */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";

import {
  TextField,
  Button as MuiButton,
  InputAdornment,
  Chip,
  CircularProgress,
  Alert,
  Stack,
  Typography,
  Box,
  Paper,
  Divider,
  useTheme,
  useMediaQuery,
  Skeleton,
  Card,
  CardContent,
  Avatar,
  Grid,
  Container,
} from "@mui/material";

import {
  Search as SearchIcon,
  SportsTennis as TennisIcon,
  EmojiEvents as TrophyIcon,
  AccessTime as TimeIcon,
  LocationOn as LocationIcon,
  QrCodeScanner as ScanIcon,
  CheckCircle as CheckCircleIcon,
  Cancel as CancelIcon,
  EventNote as BracketIcon,
  Group as ListIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import {
  useGetRegistrationsQuery,
  useGetTournamentQuery,
  useGetTournamentMatchesForCheckinQuery,
  useSearchUserMatchesQuery,
  useUserCheckinRegistrationMutation,
  useListTournamentBracketsQuery,
} from "../../slices/tournamentsApiSlice";

import { useSocket } from "../../context/SocketContext";
import { useLanguage } from "../../context/LanguageContext";
import { formatTime } from "../../i18n/format";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";

/* ---------- Utils & Config ---------- */
const fmtTimeValue = (s, fallback) => (s && s.length ? s : fallback);
const normType = (t) => {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
};

// Màu sắc chủ đạo (Bạn có thể chỉnh theo brand)
const BRAND_COLOR = "#1976d2";
const ACCENT_COLOR = "#ff9800";

/* ---------- Styled Components (via SX) ---------- */
const cardStyle = {
  borderRadius: 3,
  boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
  border: "none",
  overflow: "visible",
  transition: "transform 0.2s ease-in-out",
};

const gradientText = {
  background: `linear-gradient(45deg, ${BRAND_COLOR}, #9c27b0)`,
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

import SEOHead from "../../components/SEOHead";

export default function TournamentCheckin() {
  const { id } = useParams();
  const theme = useTheme();
  useMediaQuery(theme.breakpoints.down("sm"));
  const { locale, t } = useLanguage();

  /* fetch tournament / registrations / matches */
  const { data: tour, isLoading: tourLoading } = useGetTournamentQuery(id);
  
  // ... existing code ...


  const {
    error: regsError,
    refetch: refetchRegs,
  } = useGetRegistrationsQuery(id);
  const {
    data: matchesResp = [],
    isLoading: matchesLoading,
    refetch: refetchMatchesAll,
  } = useGetTournamentMatchesForCheckinQuery(id);
  const {
    data: brackets = [],
    isLoading: bracketsLoading,
    refetch: refetchBrackets,
  } = useListTournamentBracketsQuery(id, {
    refetchOnMountOrArgChange: true,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const evType = normType(tour?.eventType);
  const isSingles = evType === "single";

  const fmtSide = useCallback(
    (label) => {
      if (!label) return "—";
      const s = String(label).trim();
      if (!isSingles) return s;
      return s.split(/\s*&&\s*|\s*&\s*/)[0].trim();
    },
    [isSingles]
  );

  /* (Cũ) Check-in theo SĐT - Giữ logic nhưng ẩn UI nếu không cần thiết, hoặc tích hợp */

  /* (Mới) Tìm & check-in theo SĐT/Nickname */
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const {
    data: searchRes,
    isFetching: searching,
    isError: searchError,
    refetch: refetchSearch,
  } = useSearchUserMatchesQuery(
    { tournamentId: id, q: submittedQ },
    { skip: !submittedQ }
  );
  const [userCheckin, { isLoading: checkingUser }] =
    useUserCheckinRegistrationMutation();

  const onSubmitSearch = useCallback(() => {
    const key = q.trim();
    if (!key) return toast.info(t("tournaments.checkin.searchHint"));
    setSubmittedQ(key);
  }, [q, t]);

  const onKeyDownSearch = (e) => {
    if (e.key === "Enter") onSubmitSearch();
  };

  const results = useMemo(() => searchRes?.results || [], [searchRes]);

  const handleUserCheckin = async (regId) => {
    try {
      const res = await userCheckin({
        tournamentId: id,
        q: submittedQ,
        regId,
      }).unwrap();
      toast.success(res?.message || t("tournaments.checkin.checkinSuccess"));
      try {
        socket?.emit?.("registration:checkin", {
          tournamentId: id,
          regId,
          keyword: submittedQ,
        });
      } catch {
        // ignore socket sync errors
      }
      refetchSearch();
      refetchRegs();
    } catch (e) {
      toast.error(
        e?.data?.message || e?.error || t("tournaments.checkin.checkinFailed")
      );
    }
  };

  /* ===== Realtime Logic (Giữ nguyên) ===== */
  const socket = useSocket();
  const liveMapRef = useRef(new Map());
  const [liveBump, setLiveBump] = useState(0);
  const pendingRef = useRef(new Map());
  const rafRef = useRef(null);

  const flushPending = useCallback(() => {
    if (!pendingRef.current.size) return;
    const mp = liveMapRef.current;
    for (const [id, inc] of pendingRef.current) {
      const cur = mp.get(id);
      const vNew = Number(inc?.liveVersion ?? inc?.version ?? 0);
      const vOld = Number(cur?.liveVersion ?? cur?.version ?? 0);
      const merged = !cur || vNew >= vOld ? { ...(cur || {}), ...inc } : cur;
      mp.set(id, merged);
    }
    pendingRef.current.clear();
    setLiveBump((x) => x + 1);
  }, []);

  const queueUpsert = useCallback(
    (incRaw) => {
      const inc = incRaw?.data ?? incRaw?.match ?? incRaw;
      if (!inc?._id) return;
      const normalizeEntity = (v) => {
        if (v == null) return v;
        if (typeof v === "string" || typeof v === "number") return v;
        if (typeof v === "object") {
          return {
            _id: v._id ?? (typeof v.id === "string" ? v.id : undefined),
            name:
              (typeof v.name === "string" && v.name) ||
              (typeof v.label === "string" && v.label) ||
              (typeof v.title === "string" && v.title) ||
              "",
          };
        }
        return v;
      };
      if (inc.court) inc.court = normalizeEntity(inc.court);
      if (inc.venue) inc.venue = normalizeEntity(inc.venue);
      if (inc.location) inc.location = normalizeEntity(inc.location);
      pendingRef.current.set(String(inc._id), inc);
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flushPending();
      });
    },
    [flushPending]
  );

  const apiSig = useMemo(() => {
    const arr = (matchesResp || []).map((m) => {
      const id = String(m?._id || "");
      const v =
        m?.liveVersion ??
        m?.version ??
        (m?.updatedAt ? new Date(m.updatedAt).getTime() : 0);
      return `${id}:${v}`;
    });
    arr.sort();
    return arr.join("|");
  }, [matchesResp]);

  const prevApiSigRef = useRef("");
  useEffect(() => {
    if (apiSig === prevApiSigRef.current) return;
    prevApiSigRef.current = apiSig;
    const mp = new Map();
    (matchesResp || []).forEach((m) => m?._id && mp.set(String(m._id), m));
    liveMapRef.current = mp;
    setLiveBump((x) => x + 1);
  }, [apiSig, matchesResp]);

  const matchIds = useMemo(
    () => (matchesResp || []).map((m) => String(m._id)).filter(Boolean),
    [matchesResp]
  );
  const bracketIds = useMemo(
    () => (brackets || []).map((b) => String(b._id)).filter(Boolean),
    [brackets]
  );
  const matchIdsSig = useMemo(
    () => Array.from(new Set(matchIds)).sort().join("|"),
    [matchIds]
  );
  const bracketIdsSig = useMemo(
    () => Array.from(new Set(bracketIds)).sort().join("|"),
    [bracketIds]
  );

  const refetchMatchesAllRef = useRef(refetchMatchesAll);
  const refetchBracketsRef = useRef(refetchBrackets);
  const refetchSearchRef = useRef(refetchSearch);
  const submittedQRef = useRef(submittedQ);

  useEffect(() => {
    refetchMatchesAllRef.current = refetchMatchesAll;
  }, [refetchMatchesAll]);
  useEffect(() => {
    refetchBracketsRef.current = refetchBrackets;
  }, [refetchBrackets]);
  useEffect(() => {
    refetchSearchRef.current = refetchSearch;
  }, [refetchSearch]);
  useEffect(() => {
    submittedQRef.current = submittedQ;
  }, [submittedQ]);

  const joinedRef = useRef(new Set());
  useEffect(() => {
    if (!socket) return;
    const subscribeDrawRooms = () => {
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:subscribe", { bracketId: bid })
        );
      } catch {
        // ignore subscribe errors during reconnect
      }
    };
    const unsubscribeDrawRooms = () => {
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:unsubscribe", { bracketId: bid })
        );
      } catch {
        // ignore unsubscribe errors during teardown
      }
    };
    const joinAllMatches = () => {
      try {
        matchIds.forEach((mid) => {
          if (!joinedRef.current.has(mid)) {
            socket.emit("match:join", { matchId: mid });
            joinedRef.current.add(mid);
          }
        });
      } catch {
        // ignore socket join errors during reconnect
      }
    };

    const onUpsert = (payload) => queueUpsert(payload);
    const onRemove = (payload) => {
      const id = String(payload?.id ?? payload?._id ?? "");
      if (!id) return;
      if (liveMapRef.current.has(id)) {
        liveMapRef.current.delete(id);
        setLiveBump((x) => x + 1);
      }
    };
    const onRefilled = () => {
      refetchMatchesAllRef.current?.();
      refetchBracketsRef.current?.();
      if (submittedQRef.current) refetchSearchRef.current?.();
    };
    const onConnected = () => {
      subscribeDrawRooms();
      joinAllMatches();
    };

    socket.on("connect", onConnected);
    socket.on("match:update", onUpsert);
    socket.on("match:snapshot", onUpsert);
    socket.on("score:updated", onUpsert);
    socket.on("match:deleted", onRemove);
    socket.on("draw:refilled", onRefilled);
    socket.on("bracket:updated", onRefilled);
    if (socket.connected) onConnected();

    return () => {
      socket.off("connect", onConnected);
      socket.off("match:update", onUpsert);
      socket.off("match:snapshot", onUpsert);
      socket.off("score:updated", onUpsert);
      socket.off("match:deleted", onRemove);
      socket.off("draw:refilled", onRefilled);
      socket.off("bracket:updated", onRefilled);
      unsubscribeDrawRooms();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [
    socket,
    id,
    bracketIdsSig,
    matchIdsSig,
    queueUpsert,
    bracketIds,
    matchIds,
  ]);

  const matches = useMemo(
    () =>
      Array.from(liveMapRef.current.values()).filter(
        (m) => String(m?.tournament?._id || m?.tournament) === String(id)
      ),
    [id, liveBump]
  );

  /* Filter matches */
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const key = search.trim().toLowerCase();
    if (!key) return matches;
    return matches.filter((m) => {
      const t1 = (m.team1 || "").toLowerCase();
      const t2 = (m.team2 || "").toLowerCase();
      const code = (m.code || "").toLowerCase();
      const stt = (m.status || "").toLowerCase();
      const bn = (m.bracketName || m?.bracket?.name || "").toLowerCase();
      return (
        code.includes(key) ||
        t1.includes(key) ||
        t2.includes(key) ||
        stt.includes(key) ||
        bn.includes(key)
      );
    });
  }, [matches, search]);

  /* Match viewer */
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const openViewer = useCallback(
    (mid) => {
      if (!mid) return;
      setSelectedMatchId(String(mid));
      setViewerOpen(true);
    },
    []
  );
  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    setSelectedMatchId(null);
  }, []);

  /* ---------- Components UI Helpers ---------- */
  const StatusBadge = ({ status, color }) => {
    const getColor = (st) => {
      if (color) return color;
      const s = String(st || "").toLowerCase();
      if (s === "live" || s === "playing") return "error";
      if (s === "completed" || s === "finished") return "success";
      if (s === "scheduled") return "info";
      return "default";
    };
    return (
      <Chip
        label={status}
        size="small"
        color={getColor(status)}
        sx={{ fontWeight: 600, textTransform: "capitalize" }}
      />
    );
  };

  /* ---------- RENDER ---------- */
  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: "background.default",
        pb: 8,
        fontFamily: "'Inter', sans-serif",
      }}
    >
      <SEOHead
        title={t("tournaments.checkin.seoTitle", {
          name: tour?.name || t("tournaments.checkin.seoFallbackName"),
        })}
        noIndex={true}
      />
      {/* HERO HEADER */}
      <Box
        sx={{
          background: `linear-gradient(135deg, ${BRAND_COLOR} 0%, #0d47a1 100%)`,
          color: "white",
          pt: { xs: 4, md: 6 },
          pb: { xs: 6, md: 8 },
          borderRadius: "0 0 30px 30px",
          boxShadow: "0 10px 30px -10px rgba(25, 118, 210, 0.5)",
          mb: -4, // Pull content up overlap
        }}
      >
        <Container maxWidth="lg">
          <Stack spacing={2}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems="center"
              spacing={2}
            >
              <Box>
                <Stack direction="row" alignItems="center" spacing={1} mb={1}>
                  <TrophyIcon sx={{ fontSize: 32, color: ACCENT_COLOR }} />
                  <Typography
                    variant="overline"
                    sx={{ opacity: 0.9, letterSpacing: 1.5 }}
                  >
                    {t("tournaments.checkin.heroEyebrow")}
                  </Typography>
                </Stack>
                {tourLoading ? (
                  <Skeleton
                    variant="text"
                    width={300}
                    height={60}
                    sx={{ bgcolor: "rgba(255,255,255,0.2)" }}
                  />
                ) : (
                  <Typography
                    variant="h3"
                    fontWeight={800}
                    sx={{
                      textShadow: "0 2px 4px rgba(0,0,0,0.2)",
                      fontSize: { xs: "2rem", md: "3rem" },
                    }}
                  >
                    {tour?.name}
                  </Typography>
                )}
                <Stack direction="row" spacing={2} mt={1} alignItems="center">
                  {!tourLoading && (
                    <Chip
                      icon={<TennisIcon sx={{ fill: "white !important" }} />}
                      label={
                        isSingles
                          ? t("tournaments.checkin.singlesEvent")
                          : t("tournaments.checkin.doublesEvent")
                      }
                      sx={{
                        bgcolor: "rgba(255,255,255,0.2)",
                        color: "white",
                        backdropFilter: "blur(4px)",
                      }}
                    />
                  )}
                </Stack>
              </Box>

              <Stack direction="row" spacing={2}>
                <MuiButton
                  component={Link}
                  to={`/tournament/${id}/bracket`}
                  variant="contained"
                  startIcon={<BracketIcon />}
                  sx={{
                    bgcolor: "background.paper",
                    color: BRAND_COLOR,
                    fontWeight: "bold",
                    "&:hover": { bgcolor: "#e3f2fd" },
                  }}
                >
                  {t("tournaments.checkin.bracketButton")}
                </MuiButton>
                <MuiButton
                  component={Link}
                  to={`/tournament/${id}/register`}
                  variant="outlined"
                  startIcon={<ListIcon />}
                  sx={{
                    color: "white",
                    borderColor: "rgba(255,255,255,0.5)",
                    "&:hover": {
                      borderColor: "rgba(255,255,255,0.9)",
                      bgcolor: "rgba(255,255,255,0.1)",
                    },
                  }}
                >
                  {t("tournaments.checkin.participantsButton")}
                </MuiButton>
              </Stack>
            </Stack>
          </Stack>
        </Container>
      </Box>

      <Container maxWidth="lg" sx={{ maxWidth: 1200, mx: "auto" }}>
        {/* SEARCH & CHECK-IN AREA (Overlapping the header) */}
        <Card sx={{ ...cardStyle, mb: 4, overflow: "visible", mt: 6 }}>
          <Box
            sx={{
              p: 3,
              background: (theme) => theme.palette.background.paper,
              borderRadius: 3,
            }}
          >
            <Typography
              variant="h6"
              fontWeight={700}
              color="text.secondary"
              mb={2}
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
            >
              <ScanIcon color="primary" />
              {t("tournaments.checkin.searchTitle")}
            </Typography>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems="center"
            >
              <TextField
                fullWidth
                placeholder={t("tournaments.checkin.searchPlaceholder")}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDownSearch}
                variant="outlined"
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon color="action" />
                    </InputAdornment>
                  ),
                  sx: { borderRadius: 2, bgcolor: "action.hover" },
                }}
              />
              <MuiButton
                variant="contained"
                size="large"
                onClick={onSubmitSearch}
                disabled={searching}
                sx={{
                  minWidth: 120,
                  height: 56,
                  borderRadius: 2,
                  boxShadow: "0 4px 12px rgba(25, 118, 210, 0.3)",
                  background: `linear-gradient(45deg, ${BRAND_COLOR}, #42a5f5)`,
                }}
              >
                {searching ? (
                  <CircularProgress size={24} color="inherit" />
                ) : (
                  t("tournaments.checkin.searchButton")
                )}
              </MuiButton>
            </Stack>

            {/* Search Messages */}
            {submittedQ &&
              !searching &&
              results.length === 0 &&
              !searchError && (
                <Alert severity="info" sx={{ mt: 3, borderRadius: 2 }}>
                  {t("tournaments.checkin.searchEmpty", {
                    query: submittedQ,
                  })}
                </Alert>
              )}
            {searchError && (
              <Alert severity="error" sx={{ mt: 3, borderRadius: 2 }}>
                {t("tournaments.checkin.searchError")}
              </Alert>
            )}

            {/* RESULTS LIST */}
            {!searching && results.length > 0 && (
              <Stack spacing={3} mt={4}>
                {results.map((reg) => {
                  const canCheckin = reg.paid && !reg.checkinAt;
                  const teamLabel = isSingles
                    ? fmtSide(reg.teamLabel)
                    : reg.teamLabel;

                  return (
                    <Card
                      key={reg.regId || reg._id}
                      variant="outlined"
                      sx={{
                        borderColor: reg.paid
                          ? "success.light"
                          : "warning.light",
                        borderWidth: "1px",
                        borderLeftWidth: "6px",
                      }}
                    >
                      <CardContent>
                        <Stack
                          direction={{ xs: "column", md: "row" }}
                          justifyContent="space-between"
                          alignItems={{ xs: "flex-start", md: "center" }}
                          spacing={2}
                        >
                          <Box>
                            <Stack
                              direction="row"
                              alignItems="center"
                              spacing={1}
                            >
                              <Avatar sx={{ bgcolor: BRAND_COLOR }}>
                                {teamLabel?.charAt(0)?.toUpperCase()}
                              </Avatar>
                              <Typography variant="h5" fontWeight={700}>
                                {teamLabel || t("tournaments.checkin.unnamedTeam")}
                              </Typography>
                            </Stack>
                            <Stack
                              direction="row"
                              spacing={1}
                              mt={1.5}
                              flexWrap="wrap"
                            >
                              <Chip
                                size="small"
                                label={
                                  reg.paid
                                    ? t("tournaments.checkin.feePaid")
                                    : t("tournaments.checkin.feeUnpaid")
                                }
                                color={reg.paid ? "success" : "warning"}
                                variant={reg.paid ? "filled" : "outlined"}
                                icon={
                                  reg.paid ? (
                                    <CheckCircleIcon />
                                  ) : (
                                    <CancelIcon />
                                  )
                                }
                              />
                              {reg.checkinAt ? (
                                <Chip
                                  size="small"
                                  label={t("tournaments.checkin.checkedInAt", {
                                    time: formatTime(reg.checkinAt, locale, {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    }),
                                  })}
                                  color="primary"
                                  sx={{
                                    bgcolor: "#e3f2fd",
                                    color: "#1565c0",
                                    fontWeight: 600,
                                  }}
                                />
                              ) : (
                                <Chip
                                  size="small"
                                  label={t("tournaments.checkin.notCheckedIn")}
                                />
                              )}
                            </Stack>
                          </Box>

                          <MuiButton
                            variant="contained"
                            color={canCheckin ? "primary" : "inherit"}
                            size="large"
                            disabled={!canCheckin || checkingUser}
                            onClick={() =>
                              handleUserCheckin(reg.regId || reg._id)
                            }
                            startIcon={
                              checkingUser ? (
                                <CircularProgress size={20} />
                              ) : (
                                <CheckCircleIcon />
                              )
                            }
                            sx={{
                              px: 4,
                              py: 1.5,
                              borderRadius: 30,
                              fontWeight: 700,
                              opacity: !canCheckin ? 0.6 : 1,
                            }}
                          >
                            {reg.checkinAt
                              ? t("tournaments.checkin.checkedIn")
                              : t("tournaments.checkin.checkinNow")}
                          </MuiButton>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            )}
          </Box>
        </Card>

        {/* TOURNAMENT MATCHES SECTION */}
        <Box>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            justifyContent="space-between"
            alignItems="center"
            mb={3}
            spacing={2}
          >
            <Typography variant="h5" fontWeight={800} sx={gradientText}>
              {t("tournaments.checkin.matchesTitle")}
            </Typography>

            <TextField
              size="small"
              placeholder={t("tournaments.checkin.matchesSearchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                sx: {
                  bgcolor: "background.paper",
                  borderRadius: 2,
                  minWidth: { sm: 300 },
                },
              }}
            />
          </Stack>

          {regsError ? (
            <Alert severity="error">
              {regsError?.data?.message || regsError.error}
            </Alert>
          ) : (
            <Grid container spacing={2}>
              {matchesLoading || bracketsLoading ? (
                // Loading Skeleton
                Array.from({ length: 6 }).map((_, i) => (
                  <Grid key={i} size={{ xs: 12, md: 6, lg: 4 }}>
                    <Skeleton
                      variant="rectangular"
                      height={160}
                      sx={{ borderRadius: 3 }}
                    />
                  </Grid>
                ))
              ) : filtered.length === 0 ? (
                <Box width="100%" textAlign="center" py={5}>
                  <Typography color="text.secondary">
                    {t("tournaments.checkin.noMatches")}
                  </Typography>
                </Box>
              ) : (
                filtered.map((m) => (
                  <Grid key={m._id || m.code} size={{ xs: 12, md: 6, lg: 4 }}>
                    <Paper
                      elevation={0}
                      sx={{
                        ...cardStyle,
                        p: 0,
                        cursor: m?._id ? "pointer" : "default",
                        border: "1px solid #e0e0e0",
                        "&:hover": {
                          transform: "translateY(-4px)",
                          boxShadow: "0 10px 25px rgba(0,0,0,0.1)",
                          borderColor: BRAND_COLOR,
                        },
                        position: "relative",
                        overflow: "hidden",
                      }}
                      onClick={() => m?._id && openViewer(m._id)}
                    >
                      {/* Status Stripe */}
                      <Box
                        sx={{
                          position: "absolute",
                          left: 0,
                          top: 0,
                          bottom: 0,
                          width: 4,
                          bgcolor:
                            m.status === "Live"
                              ? "error.main"
                              : m.status === "Completed"
                              ? "success.main"
                              : "grey.300",
                        }}
                      />

                      <Box p={2.5} pl={3}>
                        <Stack
                          direction="row"
                          justifyContent="space-between"
                          mb={2}
                        >
                          <Stack
                            direction="row"
                            spacing={1}
                            alignItems="center"
                          >
                            <Chip
                              label={m.code}
                              size="small"
                              sx={{
                                fontWeight: "bold",
                                borderRadius: 1,
                                height: 24,
                              }}
                            />
                            {m.status === "Live" && (
                              <span
                                className="badge-pulse"
                                style={{
                                  width: 8,
                                  height: 8,
                                  background: "red",
                                  borderRadius: "50%",
                                }}
                              ></span>
                            )}
                          </Stack>
                          <StatusBadge status={m.status} />
                        </Stack>

                        {/* Teams & Scores */}
                        <Stack spacing={1.5}>
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <Typography
                              variant="body1"
                              fontWeight={600}
                              sx={{
                                color:
                                  m.score1 > m.score2
                                    ? "black"
                                    : "text.secondary",
                              }}
                            >
                              {fmtSide(m.team1)}
                            </Typography>
                            <Typography
                              variant="h5"
                              fontWeight={800}
                              color={
                                m.score1 > m.score2
                                  ? BRAND_COLOR
                                  : "text.primary"
                              }
                            >
                              {m.score1}
                            </Typography>
                          </Stack>
                          <Divider sx={{ borderStyle: "dashed" }} />
                          <Stack
                            direction="row"
                            justifyContent="space-between"
                            alignItems="center"
                          >
                            <Typography
                              variant="body1"
                              fontWeight={600}
                              sx={{
                                color:
                                  m.score2 > m.score1
                                    ? "black"
                                    : "text.secondary",
                              }}
                            >
                              {fmtSide(m.team2)}
                            </Typography>
                            <Typography
                              variant="h5"
                              fontWeight={800}
                              color={
                                m.score2 > m.score1
                                  ? BRAND_COLOR
                                  : "text.primary"
                              }
                            >
                              {m.score2}
                            </Typography>
                          </Stack>
                        </Stack>

                        {/* Footer Info */}
                        <Stack
                          direction="row"
                          spacing={2}
                          mt={2}
                          color="text.secondary"
                          fontSize="0.75rem"
                        >
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                          >
                            <TimeIcon fontSize="inherit" />
                            <Typography variant="caption">
                              {fmtTimeValue(
                                m.time,
                                t("common.unavailable")
                              )}
                            </Typography>
                          </Stack>
                          <Stack
                            direction="row"
                            alignItems="center"
                            spacing={0.5}
                          >
                            <LocationIcon fontSize="inherit" />
                            <Typography variant="caption">
                              {m.field ||
                                m?.court?.name ||
                                t("tournaments.checkin.courtFallback")}
                            </Typography>
                          </Stack>
                          {m?.bracket?.name && (
                            <Typography
                              variant="caption"
                              sx={{
                                ml: "auto !important",
                                fontWeight: 600,
                                color: BRAND_COLOR,
                              }}
                            >
                              {m.bracket.name}
                            </Typography>
                          )}
                        </Stack>
                      </Box>
                    </Paper>
                  </Grid>
                ))
              )}
            </Grid>
          )}
        </Box>

        {/* Match Viewer Modal */}
        <ResponsiveMatchViewer
          open={viewerOpen}
          matchId={selectedMatchId}
          onClose={closeViewer}
        />
      </Container>

      {/* Global Styles for animations */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7); }
          70% { transform: scale(1); box-shadow: 0 0 0 6px rgba(255, 82, 82, 0); }
          100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(255, 82, 82, 0); }
        }
        .badge-pulse {
          animation: pulse 2s infinite;
        }
      `}</style>
    </Box>
  );
}
