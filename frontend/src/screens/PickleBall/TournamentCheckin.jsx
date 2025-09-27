// src/pages/TournamentCheckin.jsx (with Skeleton loaders)
/* eslint-disable react/prop-types */
import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { Container, Row, Col } from "react-bootstrap";
import {
  TextField,
  Button as MuiButton,
  InputAdornment,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
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
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { toast } from "react-toastify";

import {
  useGetRegistrationsQuery,
  useCheckinMutation,
  useGetTournamentQuery,
  useGetTournamentMatchesForCheckinQuery,
  useSearchUserMatchesQuery,
  useUserCheckinRegistrationMutation,
  useListTournamentBracketsQuery,
} from "../../slices/tournamentsApiSlice";

import { useSocket } from "../../context/SocketContext";
import ResponsiveMatchViewer from "./match/ResponsiveMatchViewer";

/* ---------- Utils ---------- */
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString() : "—");
const fmtTime = (s) => (s && s.length ? s : "—");
const normType = (t) => {
  const s = String(t || "").toLowerCase();
  if (s === "single" || s === "singles") return "single";
  if (s === "double" || s === "doubles") return "double";
  return s || "double";
};

/* ---------- Referee helpers (nickname-only) ---------- */
const toArr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const nickOf = (u) => {
  if (!u) return "";
  if (typeof u === "string") return u;
  const nick =
    u.nickName || u.nickname || u.userName || u.username || u.displayName || "";
  const name = u.fullName || u.name || "";
  return String(nick || name || "").trim();
};

const buildRefIndexFromMatches = (matches, regResults) => {
  const map = new Map();
  const add = (r) => {
    if (!r || typeof r !== "object") return;
    const id = String(
      r._id || r.id || r.nickname || r.nickName || r.name || ""
    );
    if (!id) return;
    map.set(id, r);
    if (r.nickname) map.set(`nick:${String(r.nickname).toLowerCase()}`, r);
    if (r.nickName) map.set(`nick:${String(r.nickName).toLowerCase()}`, r);
    if (r.name) map.set(`name:${String(r.name).toLowerCase()}`, r);
  };
  const scan = (m) => {
    if (!m) return;
    [
      ...toArr(m.referees),
      ...toArr(m.referee),
      ...toArr(m.refereeIds),
      ...toArr(m.refereeId),
    ]
      .flat()
      .forEach((x) => typeof x === "object" && add(x));
  };
  (matches || []).forEach(scan);
  (regResults || []).forEach((reg) => (reg.matches || []).forEach(scan));
  return map;
};

const makeRenderRefs = (refIndex) => (m) => {
  const raw =
    m?.referees ?? m?.referee ?? m?.refereeIds ?? m?.refereeId ?? null;
  const arr = toArr(raw);
  const labels = arr
    .map((x) => {
      if (!x) return "";
      if (typeof x === "object") return nickOf(x);
      const id = String(x);
      const byId = refIndex.get(id);
      if (byId) return nickOf(byId);
      const byNick = refIndex.get(`nick:${id.toLowerCase()}`);
      if (byNick) return nickOf(byNick);
      const byName = refIndex.get(`name:${id.toLowerCase()}`);
      if (byName) return nickOf(byName);
      return id;
    })
    .filter(Boolean);
  return labels.length ? labels.join(", ") : "—";
};

export default function TournamentCheckin() {
  const { id } = useParams();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  /* fetch tournament / registrations / matches */
  const { data: tour, isLoading: tourLoading } = useGetTournamentQuery(id);

  const {
    data: regs = [],
    isLoading: regsLoading,
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

  /* (Cũ) Check-in theo SĐT */
  const [phone, setPhone] = useState("");
  const [busyId, setBusy] = useState(null);
  const [checkin] = useCheckinMutation();

  const handlePhone = async () => {
    const reg = regs.find(
      (r) => r.player1?.phone === phone || r.player2?.phone === phone
    );
    if (!reg)
      return toast.error("Không tìm thấy số ĐT trong danh sách đăng ký");
    if (reg.payment?.status !== "Paid")
      return toast.error("Chưa thanh toán lệ phí — không thể check-in");
    if (reg.checkinAt) return toast.info("Đã check-in rồi");

    setBusy(reg._id);
    try {
      await checkin({ regId: reg._id }).unwrap();
      toast.success("Check-in thành công");
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Lỗi check-in");
    } finally {
      setBusy(null);
      setPhone("");
    }
  };

  /* (Mới) Tìm & check-in theo SĐT/Nickname */
  const [q, setQ] = useState("");
  const [submittedQ, setSubmittedQ] = useState("");
  const {
    data: searchRes,
    isFetching: searching,
    isError: searchError,
    error: searchErrObj,
    refetch: refetchSearch,
  } = useSearchUserMatchesQuery(
    { tournamentId: id, q: submittedQ },
    { skip: !submittedQ }
  );
  const [userCheckin, { isLoading: checkingUser }] =
    useUserCheckinRegistrationMutation();

  const onSubmitSearch = useCallback(() => {
    const key = q.trim();
    if (!key) return toast.info("Nhập SĐT hoặc nickname để tìm");
    setSubmittedQ(key);
  }, [q]);

  const onKeyDownSearch = (e) => {
    if (e.key === "Enter") onSubmitSearch();
  };

  const results = searchRes?.results || [];

  const handleUserCheckin = async (regId) => {
    try {
      const res = await userCheckin({
        tournamentId: id,
        q: submittedQ,
        regId,
      }).unwrap();
      toast.success(res?.message || "Check-in thành công");
      try {
        socket?.emit?.("registration:checkin", {
          tournamentId: id,
          regId,
          keyword: submittedQ,
        });
      } catch {}
      refetchSearch();
      refetchRegs();
    } catch (e) {
      toast.error(e?.data?.message || e?.error || "Check-in thất bại");
    }
  };

  /* ===== Realtime (ổn định deps) ===== */
  const socket = useSocket();
  const liveMapRef = useRef(new Map()); // id → match
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

  /* Chữ ký dữ liệu API để tránh setState lặp */
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

  /* Tạo chữ ký ID ổn định cho socket deps */
  const matchIds = useMemo(
    () => (matchesResp || []).map((m) => String(m._id)).filter(Boolean),
    [matchesResp]
  );
  const bracketIds = useMemo(
    () => (brackets || []).map((b) => String(b._id)).filter(Boolean),
    [brackets]
  );
  const matchIdsSig = useMemo(() => {
    const s = Array.from(new Set(matchIds)).sort().join("|");
    return s;
  }, [matchIds]);
  const bracketIdsSig = useMemo(() => {
    const s = Array.from(new Set(bracketIds)).sort().join("|");
    return s;
  }, [bracketIds]);

  /* Giữ ref cho các hàm refetch để tránh effect re-run vì identity */
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

  /* Tham gia phòng socket — deps ổn định theo chữ ký id */
  const joinedRef = useRef(new Set()); // giữ qua nhiều renders
  useEffect(() => {
    if (!socket) return;

    const subscribeDrawRooms = () => {
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:subscribe", { bracketId: bid })
        );
      } catch {}
    };
    const unsubscribeDrawRooms = () => {
      try {
        bracketIds.forEach((bid) =>
          socket.emit("draw:unsubscribe", { bracketId: bid })
        );
      } catch {}
    };

    const joinAllMatches = () => {
      try {
        matchIds.forEach((mid) => {
          if (!joinedRef.current.has(mid)) {
            socket.emit("match:join", { matchId: mid });
            socket.emit("match:snapshot:request", { matchId: mid });
            joinedRef.current.add(mid);
          }
        });
      } catch {}
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

    // Nếu socket đã kết nối sẵn thì thực hiện ngay (1 lần)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, id, bracketIdsSig, matchIdsSig]);

  /* ===== Dữ liệu đã merge realtime ===== */
  const matches = useMemo(
    () =>
      Array.from(liveMapRef.current.values()).filter(
        (m) => String(m?.tournament?._id || m?.tournament) === String(id)
      ),
    [id, liveBump]
  );

  /* ===== Referee index + renderer (nickname) ===== */
  const refIndex = useMemo(
    () => buildRefIndexFromMatches(matches, results),
    [matches, results]
  );
  const renderRefs = useMemo(() => makeRenderRefs(refIndex), [refIndex]);

  /* --------- Filter danh sách TRẬN của GIẢI --------- */
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

  /* --------- Match viewer state --------- */
  const [viewerOpen, setViewerOpen] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState(null);
  const openViewer = useCallback(
    (mid) => {
      if (!mid) return;
      setSelectedMatchId(String(mid));
      setViewerOpen(true);
      try {
        socket?.emit?.("match:join", { matchId: String(mid) });
        socket?.emit?.("match:snapshot:request", { matchId: String(mid) });
      } catch {}
    },
    [socket]
  );
  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    setSelectedMatchId(null);
  }, []);

  /* ---------- Skeleton helpers ---------- */
  const SkeletonChip = () => (
    <Skeleton
      variant="rectangular"
      width={90}
      height={28}
      sx={{ borderRadius: 14 }}
    />
  );
  const SkeletonBtn = ({ w = 140 }) => (
    <Skeleton
      variant="rectangular"
      width={w}
      height={36}
      sx={{ borderRadius: 8 }}
    />
  );
  const SkeletonLine = ({ w = "100%" }) => (
    <Skeleton variant="text" width={w} height={22} />
  );

  const MobileMatchCardSkeleton = () => (
    <Paper elevation={1} sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <SkeletonLine w={100} />
        <SkeletonChip />
      </Stack>
      <SkeletonLine w={220} />
      <Divider sx={{ my: 1 }} />
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <SkeletonLine w={120} />
        <SkeletonLine w={40} />
        <SkeletonLine w={120} />
      </Stack>
      <SkeletonLine w={180} />
    </Paper>
  );

  const DesktopTableSkeleton = () => (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <Table size="small" stickyHeader>
        <TableHead>
          <TableRow>
            <TableCell>Mã trận</TableCell>
            <TableCell>Ngày</TableCell>
            <TableCell>Giờ</TableCell>
            <TableCell>Đội 1</TableCell>
            <TableCell>Tỷ số</TableCell>
            <TableCell>Đội 2</TableCell>
            <TableCell>Sân</TableCell>
            <TableCell>Trọng tài</TableCell>
            <TableCell>Tình trạng</TableCell>
            <TableCell>Bracket</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {Array.from({ length: 8 }).map((_, i) => (
            <TableRow key={`sk-${i}`}>
              <TableCell>
                <SkeletonLine w={80} />
              </TableCell>
              <TableCell>
                <SkeletonLine w={90} />
              </TableCell>
              <TableCell>
                <SkeletonLine w={60} />
              </TableCell>
              <TableCell>
                <SkeletonLine w={160} />
              </TableCell>
              <TableCell align="center">
                <SkeletonLine w={40} />
              </TableCell>
              <TableCell>
                <SkeletonLine w={160} />
              </TableCell>
              <TableCell>
                <SkeletonLine w={100} />
              </TableCell>
              <TableCell>
                <SkeletonLine w={120} />
              </TableCell>
              <TableCell>
                <SkeletonChip />
              </TableCell>
              <TableCell>
                <SkeletonLine w={140} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );

  const SearchResultSkeleton = () => (
    <Stack spacing={2} mt={2}>
      {Array.from({ length: 2 }).map((_, k) => (
        <Paper key={`sr-${k}`} variant="outlined" sx={{ p: 2 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Box>
              <SkeletonLine w={220} />
              <Stack direction="row" spacing={1} mt={0.5}>
                <SkeletonChip />
                <SkeletonChip />
              </Stack>
            </Box>
            <SkeletonBtn />
          </Stack>
          <Divider sx={{ my: 1.5 }} />
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Mã trận</TableCell>
                <TableCell>Ngày</TableCell>
                <TableCell>Giờ</TableCell>
                <TableCell align="center">Tỷ số</TableCell>
                <TableCell>Sân</TableCell>
                <TableCell>Trọng tài</TableCell>
                <TableCell>Tình trạng</TableCell>
                <TableCell>Bracket</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {Array.from({ length: 3 }).map((__, r) => (
                <TableRow key={`srr-${r}`}>
                  <TableCell>
                    <SkeletonLine w={80} />
                  </TableCell>
                  <TableCell>
                    <SkeletonLine w={90} />
                  </TableCell>
                  <TableCell>
                    <SkeletonLine w={60} />
                  </TableCell>
                  <TableCell align="center">
                    <SkeletonLine w={40} />
                  </TableCell>
                  <TableCell>
                    <SkeletonLine w={100} />
                  </TableCell>
                  <TableCell>
                    <SkeletonLine w={120} />
                  </TableCell>
                  <TableCell>
                    <SkeletonChip />
                  </TableCell>
                  <TableCell>
                    <SkeletonLine w={140} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      ))}
    </Stack>
  );

  /* ---------- RENDER ---------- */
  return (
    <Container fluid className="py-4">
      {/* HEADER */}
      <Stack
        direction={isMobile ? "column" : "row"}
        justifyContent="space-between"
        alignItems={isMobile ? "flex-start" : "center"}
        spacing={1}
        mb={2}
      >
        <Typography variant="h5" fontWeight={700}>
          {tourLoading ? (
            <SkeletonLine w={320} />
          ) : (
            <>
              Chào mừng đến với giải đấu:&nbsp;
              <span style={{ textTransform: "uppercase", color: "#1976d2" }}>
                {tour?.name || "—"}
              </span>
            </>
          )}
        </Typography>
        {tourLoading ? (
          <SkeletonChip />
        ) : (
          tour?.eventType && (
            <Chip
              size="small"
              label={isSingles ? "Giải đơn" : "Giải đôi"}
              color={isSingles ? "default" : "primary"}
              variant="outlined"
            />
          )
        )}
      </Stack>

      {/* ACTIONS */}
      <Stack
        direction={isMobile ? "column" : "row"}
        spacing={2}
        alignItems={isMobile ? "stretch" : "center"}
        mb={3}
      >
        {tourLoading ? (
          <SkeletonBtn w={180} />
        ) : (
          <MuiButton
            component={Link}
            to={`/tournament/${id}/bracket`}
            variant="contained"
            color="warning"
            size="small"
            fullWidth={isMobile}
          >
            Sơ đồ giải đấu
          </MuiButton>
        )}

        {tourLoading ? (
          <SkeletonBtn w={180} />
        ) : (
          <MuiButton
            component={Link}
            to={`/tournament/${id}/register`}
            variant="contained"
            color="info"
            size="small"
            fullWidth={isMobile}
          >
            Danh sách đăng ký
          </MuiButton>
        )}
      </Stack>

      {/* ====== Tìm & check-in theo SĐT/Nickname ====== */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle1" fontWeight={700} mb={1}>
          Check-in theo SĐT / Nickname
        </Typography>
        <Stack
          direction={isMobile ? "column" : "row"}
          spacing={1}
          alignItems="center"
        >
          <TextField
            fullWidth
            size="small"
            placeholder="Nhập SĐT hoặc nickname đã đăng ký…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDownSearch}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
          <MuiButton
            variant="contained"
            onClick={onSubmitSearch}
            disabled={searching}
          >
            {searching ? "Đang tìm…" : "Tìm"}
          </MuiButton>
        </Stack>

        {/* Kết quả tìm */}
        {searching && (
          <>
            <Box py={2} textAlign="center">
              <CircularProgress size={22} />
            </Box>
            <SearchResultSkeleton />
          </>
        )}
        {submittedQ && !searching && results.length === 0 && !searchError && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Không tìm thấy đăng ký nào khớp với <strong>{submittedQ}</strong>.
          </Alert>
        )}
        {searchError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {searchErrObj?.data?.message ||
              searchErrObj?.error ||
              "Lỗi tìm kiếm"}
          </Alert>
        )}

        {/* Danh sách registration khớp */}
        {!searching && (
          <Stack spacing={2} mt={results.length ? 2 : 0}>
            {results.map((reg) => {
              const canCheckin = reg.paid && !reg.checkinAt;
              const disabledReason = !reg.paid
                ? "Chưa thanh toán lệ phí"
                : reg.checkinAt
                ? "Đã check-in"
                : "";
              const teamLabel = isSingles
                ? fmtSide(reg.teamLabel)
                : reg.teamLabel;

              return (
                <Paper
                  key={reg.regId || reg._id}
                  variant="outlined"
                  sx={{ p: 2 }}
                >
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems={{ xs: "flex-start", sm: "center" }}
                    spacing={2}
                    flexWrap="wrap"
                  >
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>
                        {teamLabel || "—"}
                      </Typography>
                      <Stack
                        direction="row"
                        spacing={1}
                        mt={0.5}
                        flexWrap="wrap"
                      >
                        <Chip
                          size="small"
                          label={reg.paid ? "Đã thanh toán" : "Chưa thanh toán"}
                          color={reg.paid ? "success" : "default"}
                        />
                        {reg.checkinAt ? (
                          <Chip
                            size="small"
                            label={`Đã check-in • ${new Date(
                              reg.checkinAt
                            ).toLocaleString()}`}
                            color="success"
                            variant="outlined"
                          />
                        ) : (
                          <Chip
                            size="small"
                            label="Chưa check-in"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </Box>
                    <Stack alignItems="flex-end" spacing={0.5}>
                      <MuiButton
                        variant="contained"
                        disabled={!canCheckin || checkingUser}
                        onClick={() => handleUserCheckin(reg.regId || reg._id)}
                      >
                        {checkingUser ? "Đang check-in…" : "Check-in"}
                      </MuiButton>
                      {!canCheckin && disabledReason && (
                        <Typography variant="caption" color="text.secondary">
                          * {disabledReason}
                        </Typography>
                      )}
                    </Stack>
                  </Stack>

                  {/* Danh sách trận của registration này */}
                  <Divider sx={{ my: 1.5 }} />
                  {Array.isArray(reg.matches) && reg.matches.length ? (
                    <Box sx={{ width: "100%", overflowX: "auto" }}>
                      <Table size="small" stickyHeader>
                        <TableHead>
                          <TableRow>
                            <TableCell>Mã trận</TableCell>
                            <TableCell>Ngày</TableCell>
                            <TableCell>Giờ</TableCell>
                            <TableCell align="center">Tỷ số</TableCell>
                            <TableCell>Sân</TableCell>
                            <TableCell sx={{ width: 140, maxWidth: 140 }}>
                              Trọng tài
                            </TableCell>
                            <TableCell>Tình trạng</TableCell>
                            <TableCell>Bracket</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {reg.matches.map((mm) => {
                            const m =
                              liveMapRef.current.get(String(mm._id)) || mm;
                            return (
                              <TableRow
                                key={m._id || m.code}
                                hover
                                onClick={() => m?._id && openViewer(m._id)}
                                sx={{ cursor: m?._id ? "pointer" : "default" }}
                              >
                                <TableCell>{m.code}</TableCell>
                                <TableCell>{fmtDate(m.date)}</TableCell>
                                <TableCell>{fmtTime(m.time)}</TableCell>
                                <TableCell align="center">
                                  <strong>
                                    {m.score1} - {m.score2}
                                  </strong>
                                </TableCell>
                                <TableCell>
                                  {m.field || m?.court?.name || "Chưa xác định"}
                                </TableCell>
                                <TableCell
                                  sx={{
                                    width: 140,
                                    maxWidth: 140,
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace: "nowrap",
                                  }}
                                  title={makeRenderRefs(refIndex)(m)}
                                >
                                  {makeRenderRefs(refIndex)(m)}
                                </TableCell>
                                <TableCell>
                                  <Chip
                                    label={m.status}
                                    size="small"
                                    color={m.statusColor || "default"}
                                  />
                                </TableCell>
                                <TableCell>{m?.bracket?.name || "—"}</TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Chưa có trận nào được xếp cho {isSingles ? "VĐV" : "đôi"}{" "}
                      này.
                    </Typography>
                  )}
                </Paper>
              );
            })}
          </Stack>
        )}
      </Paper>

      {/* ====== (Cũ) SEARCH BOX cho danh sách TRẬN của GIẢI ====== */}
      <Row className="mb-3">
        <Col md={4}>
          <TextField
            fullWidth
            size="small"
            placeholder="Tìm: Tên VĐV/đội, mã trận, tình trạng, bracket…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            }}
          />
        </Col>
      </Row>

      {/* ====== DANH SÁCH TRẬN CỦA GIẢI ====== */}
      {regsError ? (
        <Alert severity="error">
          {regsError?.data?.message || regsError.error}
        </Alert>
      ) : isMobile ? (
        matchesLoading || bracketsLoading ? (
          <Stack spacing={2}>
            {Array.from({ length: 5 }).map((_, i) => (
              <MobileMatchCardSkeleton key={`mbsk-${i}`} />
            ))}
          </Stack>
        ) : (
          /* MOBILE cards */
          <Stack spacing={2}>
            {filtered.map((m) => (
              <Paper
                key={m._id}
                elevation={1}
                sx={{ p: 2, cursor: m?._id ? "pointer" : "default" }}
                onClick={() => m?._id && openViewer(m._id)}
              >
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Typography variant="subtitle2" fontWeight={600}>
                    {m.code}
                  </Typography>
                  <Chip
                    label={m.status}
                    size="small"
                    color={m.statusColor || "default"}
                  />
                </Stack>

                <Typography variant="caption" color="text.secondary">
                  {fmtDate(m.date)} • {fmtTime(m.time)} • {m.field || "—"}
                  {m.bracketName || m?.bracket?.name
                    ? ` • ${m.bracketName || m?.bracket?.name}`
                    : ""}
                </Typography>

                <Divider sx={{ my: 1 }} />

                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                >
                  <Typography variant="body2" fontWeight={500}>
                    {fmtSide(m.team1)}
                  </Typography>
                  <Typography variant="subtitle1" fontWeight={700}>
                    {m.score1}-{m.score2}
                  </Typography>
                  <Typography
                    variant="body2"
                    fontWeight={500}
                    textAlign="right"
                    sx={{ minWidth: 80 }}
                  >
                    {fmtSide(m.team2)}
                  </Typography>
                </Stack>

                <Typography
                  variant="caption"
                  color="text.secondary"
                  mt={0.5}
                  display="block"
                  sx={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={makeRenderRefs(refIndex)(m)}
                >
                  Trọng tài: {makeRenderRefs(refIndex)(m)}
                </Typography>
              </Paper>
            ))}
          </Stack>
        )
      ) : matchesLoading || bracketsLoading ? (
        <DesktopTableSkeleton />
      ) : (
        /* DESKTOP table */
        <Box sx={{ width: "100%", overflowX: "auto" }}>
          <Table
            size="small"
            stickyHeader
            sx={{
              "& thead th": { fontWeight: 600 },
              "& tbody td": { whiteSpace: "nowrap" },
            }}
          >
            <TableHead>
              <TableRow>
                <TableCell>Mã trận</TableCell>
                <TableCell>Ngày</TableCell>
                <TableCell>Giờ</TableCell>
                <TableCell>Đội&nbsp;1</TableCell>
                <TableCell>Tỷ số</TableCell>
                <TableCell>Đội&nbsp;2</TableCell>
                <TableCell>Sân</TableCell>
                <TableCell sx={{ width: 140, maxWidth: 140 }}>
                  Trọng tài
                </TableCell>
                <TableCell>Tình trạng</TableCell>
                <TableCell>Bracket</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((m) => (
                <TableRow
                  key={m._id}
                  hover
                  onClick={() => m?._id && openViewer(m._id)}
                  sx={{ cursor: m?._id ? "pointer" : "default" }}
                >
                  <TableCell>{m.code}</TableCell>
                  <TableCell>{fmtDate(m.date)}</TableCell>
                  <TableCell>{fmtTime(m.time)}</TableCell>
                  <TableCell>{fmtSide(m.team1)}</TableCell>
                  <TableCell align="center">
                    <strong>
                      {m.score1} - {m.score2}
                    </strong>
                  </TableCell>
                  <TableCell>{fmtSide(m.team2)}</TableCell>
                  <TableCell>{m.field || m?.court?.name}</TableCell>
                  <TableCell
                    sx={{
                      width: 140,
                      maxWidth: 140,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={renderRefs(m)}
                  >
                    {renderRefs(m)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      label={m.status}
                      size="small"
                      color={m.statusColor || "default"}
                    />
                  </TableCell>
                  <TableCell>
                    {m.bracketName || m?.bracket?.name || "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {/* Match Viewer */}
      <ResponsiveMatchViewer
        open={viewerOpen}
        matchId={selectedMatchId}
        onClose={closeViewer}
      />
    </Container>
  );
}
