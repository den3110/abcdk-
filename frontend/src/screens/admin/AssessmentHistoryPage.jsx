import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  Chip,
  CircularProgress,
  Grid,
  MenuItem,
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

const scoreByOptions = [
  { value: "", label: "Tất cả người chấm" },
  { value: "staff", label: "BQT / staff" },
  { value: "admin", label: "Admin" },
  { value: "mod", label: "Mod" },
  { value: "moderator", label: "Moderator" },
  { value: "self", label: "Tự chấm" },
  { value: "unknown", label: "Không rõ" },
];

const sourceTypeOptions = [
  { value: "", label: "Tất cả nguồn" },
  { value: "staff", label: "Chấm chính thức" },
  { value: "self", label: "Tự chấm" },
  { value: "unknown", label: "Không rõ" },
];

const scorerRoleOptions = [
  { value: "", label: "Tất cả vai trò" },
  { value: "admin", label: "Admin" },
  { value: "mod", label: "Mod" },
  { value: "moderator", label: "Moderator" },
  { value: "evaluator", label: "Người chấm trình" },
  { value: "user", label: "User" },
  { value: "referee", label: "Referee" },
];

const sortOptions = [
  { value: "scoredAt", label: "Ngày chấm" },
  { value: "createdAt", label: "Ngày tạo" },
  { value: "singleLevel", label: "Điểm đơn" },
  { value: "doubleLevel", label: "Điểm đôi" },
  { value: "targetName", label: "Tên VĐV" },
  { value: "scorerName", label: "Tên người chấm" },
  { value: "province", label: "Tỉnh" },
  { value: "scoreBy", label: "Nguồn chấm" },
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
    <Stack spacing={3}>
      <Grid container spacing={2}>
        {summaryCards.map((item) => (
          <Grid item xs={12} sm={6} lg={3} key={item.label}>
            <Card sx={{ p: 2, height: "100%" }}>
              <Typography variant="overline" color="text.secondary">
                {item.label}
              </Typography>
              <Typography variant="h4">{item.value}</Typography>
            </Card>
          </Grid>
        ))}
      </Grid>

      <Card>
        <Box sx={{ p: { xs: 1.5, md: 3 } }}>
          <Stack spacing={2.5}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              justifyContent="space-between"
              alignItems={{ xs: "stretch", md: "center" }}
              spacing={2}
            >
              <Box>
                <Typography variant="h5">Lịch sử chấm trình</Typography>
                <Typography variant="body2" color="text.secondary">
                  Tổng hợp các lần admin, mod và người dùng tự chấm. Tất cả bộ lọc chạy ở backend.
                </Typography>
              </Box>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                <Button variant="outlined" onClick={() => refetch()} disabled={isFetching}>
                  Tải lại
                </Button>
                <Button variant="outlined" color="secondary" onClick={clearFilters}>
                  Xóa lọc
                </Button>
              </Stack>
            </Stack>

            <Grid container spacing={1.5}>
              <Grid item xs={12} md={4}>
                <TextField
                  fullWidth
                  size="small"
                  label="Tìm kiếm"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Tên, nick, SĐT, email, ghi chú"
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Người chấm"
                  value={filters.scoreBy}
                  onChange={(e) => setFilter("scoreBy", e.target.value)}
                >
                  {scoreByOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Loại nguồn"
                  value={filters.sourceType}
                  onChange={(e) => setFilter("sourceType", e.target.value)}
                >
                  {sourceTypeOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Vai trò scorer"
                  value={filters.scorerRole}
                  onChange={(e) => setFilter("scorerRole", e.target.value)}
                >
                  {scorerRoleOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  label="Tỉnh VĐV"
                  value={filters.province}
                  onChange={(e) => setFilter("province", e.target.value)}
                />
              </Grid>

              <Grid item xs={6} sm={3} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Từ ngày"
                  value={filters.dateFrom}
                  onChange={(e) => setFilter("dateFrom", e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={2}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="Đến ngày"
                  value={filters.dateTo}
                  onChange={(e) => setFilter("dateTo", e.target.value)}
                  InputLabelProps={{ shrink: true }}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Đơn từ"
                  value={filters.singleMin}
                  onChange={(e) => setFilter("singleMin", e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Đơn đến"
                  value={filters.singleMax}
                  onChange={(e) => setFilter("singleMax", e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Đôi từ"
                  value={filters.doubleMin}
                  onChange={(e) => setFilter("doubleMin", e.target.value)}
                />
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="Đôi đến"
                  value={filters.doubleMax}
                  onChange={(e) => setFilter("doubleMax", e.target.value)}
                />
              </Grid>
              <Grid item xs={12} sm={6} md={2}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Sắp xếp"
                  value={filters.sortBy}
                  onChange={(e) => setFilter("sortBy", e.target.value)}
                >
                  {sortOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Chiều"
                  value={filters.sortDir}
                  onChange={(e) => setFilter("sortDir", e.target.value)}
                >
                  <MenuItem value="desc">Giảm dần</MenuItem>
                  <MenuItem value="asc">Tăng dần</MenuItem>
                </TextField>
              </Grid>
              <Grid item xs={6} sm={3} md={1.5}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  label="Số dòng"
                  value={filters.pageSize}
                  onChange={(e) => setFilter("pageSize", Number(e.target.value))}
                >
                  {[10, 25, 50, 100].map((value) => (
                    <MenuItem key={value} value={value}>
                      {value}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="ID VĐV"
                  value={filters.targetUserId}
                  onChange={(e) => setFilter("targetUserId", e.target.value)}
                />
              </Grid>
              <Grid item xs={12} md={3}>
                <TextField
                  fullWidth
                  size="small"
                  label="ID người chấm"
                  value={filters.scorerId}
                  onChange={(e) => setFilter("scorerId", e.target.value)}
                />
              </Grid>
            </Grid>

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

            <Grid container alignItems="center" justifyContent="space-between" spacing={2}>
              <Grid item>
                <Typography variant="caption" color="text.secondary">
                  Tổng {total} bản ghi • Trang {page}/{totalPages}
                </Typography>
              </Grid>
              <Grid item>
                <Pagination
                  page={page}
                  count={totalPages}
                  color="primary"
                  onChange={(_, nextPage) => setPage(nextPage)}
                />
              </Grid>
            </Grid>
          </Stack>
        </Box>
      </Card>
    </Stack>
  );
}
