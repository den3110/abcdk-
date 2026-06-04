/* eslint-disable react/prop-types */
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Stack,
  Button,
  Paper,
  Grid,
  TextField,
  Skeleton,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Divider,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import { useGetVenueRevenueQuery } from "../../../slices/bookingsApiSlice";
import { fmtVND, toDateInput, addDays, monthStart, fmtDateLabel } from "../courtShared";

function Kpi({ label, value, sub, color = "text.primary" }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, height: "100%" }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h5" fontWeight={900} sx={{ color, mt: 0.5, lineHeight: 1.1 }}>
        {value}
      </Typography>
      {sub ? (
        <Typography variant="caption" color="text.secondary">
          {sub}
        </Typography>
      ) : null}
    </Paper>
  );
}

export default function VenueRevenuePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const today = toDateInput();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const { data, isFetching } = useGetVenueRevenueQuery(
    { venueId: id, from, to },
    { skip: !id },
  );

  const totals = data?.totals || {};
  const byCourt = data?.byCourt || [];
  const byDay = data?.byDay || [];
  const maxPaid = Math.max(1, ...byDay.map((d) => d.paid));

  const preset = (key) => {
    if (key === "today") {
      setFrom(today);
      setTo(today);
    } else if (key === "7d") {
      setFrom(addDays(today, -6));
      setTo(today);
    } else if (key === "month") {
      setFrom(monthStart(today));
      setTo(today);
    }
  };

  const exportCsv = () => {
    const rows = [["San", "Luot", "Da thu", "Du kien"]];
    byCourt.forEach((c) => rows.push([c.courtName, c.count, c.paid, c.expected]));
    rows.push([]);
    rows.push(["Tong da thu", totals.paidRevenue || 0]);
    rows.push(["Tong du kien", totals.expectedRevenue || 0]);
    rows.push(["Chua thu", totals.unpaidAmount || 0]);
    rows.push(["So luot", totals.activeCount || 0]);
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `doanh-thu_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, md: 3 } }}>
      <Button startIcon={<ArrowBackIcon />} onClick={() => navigate(`/owner/venues/${id}`)} sx={{ mb: 1 }}>
        Quản lý cụm sân
      </Button>
      <Typography variant="h4" fontWeight={900} sx={{ mb: 2 }}>
        Doanh thu — {data?.venueName || ""}
      </Typography>

      {/* Bộ lọc thời gian */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mb: 1.5 }}>
          <Button size="small" variant="outlined" onClick={() => preset("today")}>
            Hôm nay
          </Button>
          <Button size="small" variant="outlined" onClick={() => preset("7d")}>
            7 ngày
          </Button>
          <Button size="small" variant="outlined" onClick={() => preset("month")}>
            Tháng này
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<FileDownloadIcon />} onClick={exportCsv}>
            Xuất CSV
          </Button>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center" flexWrap="wrap" useFlexGap>
          <TextField size="small" type="date" label="Từ ngày" InputLabelProps={{ shrink: true }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <TextField size="small" type="date" label="Đến ngày" InputLabelProps={{ shrink: true }} value={to} onChange={(e) => setTo(e.target.value)} />
          <Typography variant="body2" color="text.secondary">
            {from === to ? fmtDateLabel(from) : `${from} → ${to}`}
          </Typography>
        </Stack>
      </Paper>

      {isFetching && !data ? (
        <Skeleton variant="rounded" height={300} sx={{ borderRadius: 3 }} />
      ) : (
        <>
          {/* KPI */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6} md={3}>
              <Kpi label="Đã thu" value={fmtVND(totals.paidRevenue || 0)} sub={`${totals.paidCount || 0} lượt`} color="success.main" />
            </Grid>
            <Grid item xs={6} md={3}>
              <Kpi label="Dự kiến" value={fmtVND(totals.expectedRevenue || 0)} sub={`${totals.activeCount || 0} lượt`} color="primary.main" />
            </Grid>
            <Grid item xs={6} md={3}>
              <Kpi label="Chưa thu" value={fmtVND(totals.unpaidAmount || 0)} sub={`${totals.unpaidCount || 0} lượt`} color="warning.main" />
            </Grid>
            <Grid item xs={6} md={3}>
              <Kpi label="Đã huỷ" value={totals.cancelledCount || 0} sub="lượt" color="text.secondary" />
            </Grid>
          </Grid>

          {/* Biểu đồ theo ngày */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1.5 }}>
              Doanh thu đã thu theo ngày
            </Typography>
            {byDay.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Chưa có dữ liệu trong khoảng này.
              </Typography>
            ) : (
              <Box sx={{ overflowX: "auto" }}>
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="flex-end"
                  sx={{ minHeight: 160, pt: 2 }}
                >
                  {byDay.map((d) => (
                    <Stack key={d.date} alignItems="center" spacing={0.5} sx={{ minWidth: 44 }}>
                      <Typography variant="caption" sx={{ fontSize: 10 }}>
                        {Math.round((d.paid || 0) / 1000)}k
                      </Typography>
                      <Box
                        title={`${d.date}: ${fmtVND(d.paid)}`}
                        sx={{
                          width: 28,
                          height: `${Math.max(4, (d.paid / maxPaid) * 120)}px`,
                          borderRadius: 1,
                          background: "linear-gradient(180deg,#42a5f5,#1976d2)",
                        }}
                      />
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                        {d.date.slice(8, 10)}/{d.date.slice(5, 7)}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
          </Paper>

          {/* Theo sân */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
              Theo sân
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Sân</TableCell>
                  <TableCell align="right">Lượt</TableCell>
                  <TableCell align="right">Đã thu</TableCell>
                  <TableCell align="right">Dự kiến</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {byCourt.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} align="center" sx={{ fontStyle: "italic" }}>
                      Không có dữ liệu
                    </TableCell>
                  </TableRow>
                ) : (
                  byCourt.map((c) => (
                    <TableRow key={c.courtId} hover>
                      <TableCell>{c.courtName}</TableCell>
                      <TableCell align="right">{c.count}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, color: "success.main" }}>
                        {fmtVND(c.paid)}
                      </TableCell>
                      <TableCell align="right">{fmtVND(c.expected)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Paper>

          {/* Chốt số */}
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, bgcolor: "action.hover" }}>
            <Typography variant="subtitle1" fontWeight={800} sx={{ mb: 1 }}>
              Chốt số kỳ {from === to ? fmtDateLabel(from) : `${from} → ${to}`}
            </Typography>
            <Stack spacing={0.5}>
              <Row label="Số lượt (không tính huỷ)" value={String(totals.activeCount || 0)} />
              <Row label="Đã thu" value={fmtVND(totals.paidRevenue || 0)} strong color="success.main" />
              <Row label="Chưa thu" value={fmtVND(totals.unpaidAmount || 0)} color="warning.main" />
              <Divider sx={{ my: 0.5 }} />
              <Row label="Tổng dự kiến" value={fmtVND(totals.expectedRevenue || 0)} strong />
            </Stack>
          </Paper>
        </>
      )}
    </Container>
  );
}

function Row({ label, value, strong, color }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant={strong ? "subtitle1" : "body2"} fontWeight={strong ? 800 : 600} sx={{ color: color || "text.primary" }}>
        {value}
      </Typography>
    </Stack>
  );
}
