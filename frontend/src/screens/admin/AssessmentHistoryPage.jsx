import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Pagination,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";
import { useGetAssessmentHistoryQuery } from "../../slices/adminApiSlice";

const DEFAULT_PAGE_SIZE = 25;

const sourceLabels = {
  admin: { label: "Admin", color: "info" },
  mod: { label: "Mod", color: "primary" },
  moderator: { label: "Moderator", color: "primary" },
  self: { label: "Tự chấm", color: "error" },
  unknown: { label: "Không rõ", color: "default" },
};

const sourceQuickOptions = [
  { value: "", label: "Tất cả" },
  { value: "staff", label: "Chính thức" },
  { value: "self", label: "Tự chấm" },
  { value: "unknown", label: "Không rõ" },
];

const fmtScore = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(3) : "-";
};

const fmtDate = (value) => {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("vi-VN");
};

const displayName = (user = {}) =>
  user.nickname || user.name || user.phone || user.email || "Chưa có tên";

const compactId = (value) => {
  const raw = String(value || "");
  if (raw.length <= 10) return raw || "-";
  return `${raw.slice(0, 6)}…${raw.slice(-4)}`;
};

const cellSx = {
  py: 1.35,
  px: 1.5,
  verticalAlign: "middle",
  whiteSpace: "normal",
  wordBreak: "break-word",
};

const ellipsisSx = {
  display: "block",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const initialFilters = {
  scoreBy: "",
  sourceType: "",
  scorerRole: "",
  province: "",
  dateFrom: "",
  dateTo: "",
  singleMin: "",
  singleMax: "",
  doubleMin: "",
  doubleMax: "",
  targetUserId: "",
  scorerId: "",
  sortBy: "scoredAt",
  sortDir: "desc",
  pageSize: DEFAULT_PAGE_SIZE,
};

export default function AssessmentHistoryPage() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [filters, setFilters] = useState(initialFilters);

  useEffect(() => {
    const timer = setTimeout(() => {
      setKeyword(searchInput.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const queryArgs = useMemo(
    () => ({
      page,
      keyword,
      ...filters,
    }),
    [filters, keyword, page],
  );

  const { data, isFetching, refetch } = useGetAssessmentHistoryQuery(queryArgs);
  const rows = data?.rows || [];
  const total = Number(data?.total || 0);
  const totalPages = Math.max(
    1,
    Number(data?.totalPages || Math.ceil(total / filters.pageSize)),
  );
  const summary = data?.summary || {};

  const setFilter = (key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setKeyword("");
    setFilters(initialFilters);
    setPage(1);
  };

  const summaryCards = [
    { label: "Tổng bản ghi", value: total },
    { label: "Chấm chính thức", value: summary.staff || 0 },
    { label: "Tự chấm", value: summary.self || 0 },
    {
      label: "TB đơn / đôi",
      value: `${fmtScore(summary.avgSingle)} / ${fmtScore(summary.avgDouble)}`,
    },
  ];

  return (
    <Stack spacing={1.5}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            lg: "repeat(4, minmax(0, 1fr))",
          },
          gap: 1,
        }}
      >
        {summaryCards.map((item) => (
          <Box
            key={item.label}
            sx={{
              p: { xs: 1.25, md: 1.5 },
              border: "1px solid",
              borderColor: "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
              minWidth: 0,
            }}
          >
            <Typography
              variant="overline"
              color="text.secondary"
              sx={{ display: "block", letterSpacing: 0, lineHeight: 1.2 }}
            >
              {item.label}
            </Typography>
            <Typography
              variant="h6"
              sx={{
                mt: 0.4,
                fontWeight: 600,
                lineHeight: 1.15,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.value}
            </Typography>
          </Box>
        ))}
      </Box>

      <Card
        sx={{
          border: "1px solid",
          borderColor: "divider",
          boxShadow: "none",
        }}
      >
        <Box sx={{ p: { xs: 1.5, md: 2 } }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              spacing={1.5}
            >
              <Box>
                <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                  Lịch sử chấm trình
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Tổng {total} bản ghi • Trang {page}/{totalPages}
                </Typography>
              </Box>
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  flexShrink: 0,
                  "& .MuiButton-root": { flex: { xs: 1, sm: "0 0 auto" } },
                }}
              >
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  Tải lại
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  color="secondary"
                  onClick={clearFilters}
                >
                  Xóa lọc
                </Button>
              </Stack>
            </Stack>

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", md: "minmax(260px, 360px) 1fr" },
                gap: 1,
                alignItems: "center",
              }}
            >
              <TextField
                fullWidth
                size="small"
                label="Tìm kiếm"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Tên, nick, SĐT, email, ghi chú"
              />
              <Stack
                direction="row"
                spacing={0.75}
                useFlexGap
                flexWrap="wrap"
                alignItems="center"
              >
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.25 }}>
                  Nguồn
                </Typography>
                {sourceQuickOptions.map((option) => {
                  const active = filters.sourceType === option.value;
                  return (
                    <Chip
                      key={option.value || "all"}
                      size="small"
                      label={option.label}
                      color={active ? "primary" : "default"}
                      variant={active ? "filled" : "outlined"}
                      onClick={() => setFilter("sourceType", option.value)}
                      sx={{ borderRadius: 1 }}
                    />
                  );
                })}
              </Stack>
            </Box>

            {isFetching ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary">
                  Đang tải lịch sử...
                </Typography>
              </Stack>
            ) : null}

            <TableContainer sx={{ overflowX: "auto" }}>
              <Table size="small" sx={{ minWidth: 1120, "& .MuiTableCell-root": cellSx }}>
                <TableHead sx={{ display: "table-header-group" }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 700 }}>VĐV</TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Người chấm</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700 }}>
                      Nguồn
                    </TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700 }}>
                      Điểm
                    </TableCell>
                    <TableCell sx={{ fontWeight: 700 }}>Ghi chú</TableCell>
                    <TableCell align="center" sx={{ fontWeight: 700 }}>
                      Thời gian
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row) => {
                    const source = sourceLabels[row.sourceKey] || sourceLabels.unknown;
                    const user = row.user || {};
                    const scorer = row.scorer || {};
                    return (
                      <TableRow key={row._id}>
                        <TableCell>
                          <Stack direction="row" spacing={1.25} alignItems="center">
                            <Avatar src={user.avatar || ""} sx={{ width: 34, height: 34 }}>
                              {displayName(user).charAt(0).toUpperCase()}
                            </Avatar>
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="button" sx={ellipsisSx}>
                                {displayName(user)}
                              </Typography>
                              <Typography variant="caption" color="text.secondary" display="block">
                                {user.province || "-"} • {compactId(user._id)}
                              </Typography>
                            </Box>
                          </Stack>
                        </TableCell>
                        <TableCell>
                          <Typography variant="button" sx={ellipsisSx}>
                            {scorer._id ? displayName(scorer) : "Không rõ"}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" display="block">
                            {scorer.role || (scorer.evaluatorEnabled ? "evaluator" : "-")} •{" "}
                            {compactId(scorer._id)}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            size="small"
                            color={source.color}
                            variant={row.isStaff ? "filled" : "outlined"}
                            label={source.label}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2">Đơn {fmtScore(row.singleLevel)}</Typography>
                          <Typography variant="body2">Đôi {fmtScore(row.doubleLevel)}</Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 320 }}>
                          <Typography variant="body2" sx={ellipsisSx}>
                            {row.note || "-"}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2">{fmtDate(row.scoredAt)}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            tạo {fmtDate(row.createdAt)}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!rows.length ? (
                    <TableRow>
                      <TableCell colSpan={6}>
                        <Alert severity="info">
                          Không có bản ghi chấm trình nào trong bộ lọc hiện tại.
                        </Alert>
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </TableContainer>

            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "stretch", sm: "center" }}
              justifyContent="space-between"
              spacing={2}
            >
              <Typography variant="caption" color="text.secondary">
                Tổng {total} bản ghi • Trang {page}/{totalPages}
              </Typography>
              <Pagination
                page={page}
                count={totalPages}
                color="primary"
                onChange={(_, nextPage) => setPage(nextPage)}
              />
            </Stack>
          </Stack>
        </Box>
      </Card>
    </Stack>
  );
}
