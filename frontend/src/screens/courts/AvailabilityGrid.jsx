/* eslint-disable react/prop-types */
import { useMemo, useState, useEffect } from "react";
import {
  Box,
  Typography,
  Stack,
  Button,
  Paper,
  Divider,
} from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import { fmtVND } from "./courtShared";

/**
 * Lưới đặt sân theo giờ.
 * props:
 *  - data: { slotMinutes, courts: [{ _id, name, closed, slots: [{start,end,price,booked,past}] }] }
 *  - disabled: bool
 *  - onConfirm({ courtId, courtName, start, end, total, count })
 */
export default function AvailabilityGrid({ data, disabled = false, onConfirm }) {
  const courts = useMemo(
    () => (Array.isArray(data?.courts) ? data.courts : []),
    [data],
  );

  // Cột thời gian = lấy theo sân có nhiều slot nhất
  const columns = useMemo(() => {
    let best = [];
    for (const c of courts) {
      if ((c.slots?.length || 0) > best.length) best = c.slots || [];
    }
    return best.map((s) => ({ start: s.start, end: s.end }));
  }, [courts]);

  // selection: { courtId, lo, hi } theo index trong slots của sân đó
  const [sel, setSel] = useState(null);

  // Reset khi đổi ngày/dữ liệu
  useEffect(() => {
    setSel(null);
  }, [data?.date, data?.venueId]);

  const courtById = useMemo(() => {
    const m = new Map();
    for (const c of courts) m.set(c._id, c);
    return m;
  }, [courts]);

  const selCourt = sel ? courtById.get(sel.courtId) : null;

  const summary = useMemo(() => {
    if (!sel || !selCourt) return null;
    const slots = selCourt.slots || [];
    const lo = Math.min(sel.lo, sel.hi);
    const hi = Math.max(sel.lo, sel.hi);
    let total = 0;
    for (let i = lo; i <= hi; i += 1) total += Number(slots[i]?.price || 0);
    return {
      courtId: selCourt._id,
      courtName: selCourt.name,
      start: slots[lo]?.start,
      end: slots[hi]?.end,
      total,
      count: hi - lo + 1,
    };
  }, [sel, selCourt]);

  function clickSlot(court, idx) {
    if (disabled) return;
    const slots = court.slots || [];
    const s = slots[idx];
    if (!s || s.booked || s.past) return;

    if (!sel || sel.courtId !== court._id) {
      setSel({ courtId: court._id, lo: idx, hi: idx });
      return;
    }
    if (sel.lo === idx && sel.hi === idx) {
      setSel(null); // bấm lại slot duy nhất => bỏ chọn
      return;
    }
    const lo = Math.min(sel.lo, idx);
    const hi = Math.max(sel.hi, idx);
    // kiểm tra toàn bộ khoảng đều trống
    let ok = true;
    for (let i = lo; i <= hi; i += 1) {
      const t = slots[i];
      if (!t || t.booked || t.past) {
        ok = false;
        break;
      }
    }
    setSel(ok ? { courtId: court._id, lo, hi } : { courtId: court._id, lo: idx, hi: idx });
  }

  const isSelected = (court, idx) =>
    sel &&
    sel.courtId === court._id &&
    idx >= Math.min(sel.lo, sel.hi) &&
    idx <= Math.max(sel.lo, sel.hi);

  if (!courts.length) {
    return (
      <Box sx={{ py: 4, textAlign: "center", color: "text.secondary" }}>
        Chưa có sân nào.
      </Box>
    );
  }

  const COURT_COL = 116;
  const CELL_W = 78;

  return (
    <Box>
      {/* Chú thích */}
      <Stack direction="row" spacing={2} sx={{ mb: 1.5, flexWrap: "wrap" }} useFlexGap>
        <Legend color="background.paper" border label="Trống" />
        <Legend color="primary.main" label="Đang chọn" textColor="#fff" />
        <Legend color="error.light" label="Đã đặt" />
        <Legend color="action.disabledBackground" label="Đã qua" />
      </Stack>

      <Box sx={{ overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
        <Box sx={{ minWidth: COURT_COL + columns.length * CELL_W }}>
          {/* Header thời gian */}
          <Box sx={{ display: "flex", position: "sticky", top: 0, zIndex: 2, bgcolor: "background.default" }}>
            <Box sx={{ width: COURT_COL, flexShrink: 0, p: 1, fontWeight: 700, fontSize: 13 }}>
              Sân \\ Giờ
            </Box>
            {columns.map((c) => (
              <Box
                key={c.start}
                sx={{
                  width: CELL_W,
                  flexShrink: 0,
                  p: 0.5,
                  textAlign: "center",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "text.secondary",
                  borderLeft: "1px dashed",
                  borderColor: "divider",
                }}
              >
                {c.start}
              </Box>
            ))}
          </Box>
          <Divider />

          {/* Mỗi sân 1 hàng */}
          {courts.map((court) => {
            const startMap = new Map((court.slots || []).map((s, i) => [s.start, i]));
            return (
              <Box key={court._id} sx={{ display: "flex", alignItems: "stretch", "&:not(:last-of-type)": { borderBottom: "1px solid", borderColor: "divider" } }}>
                <Box
                  sx={{
                    width: COURT_COL,
                    flexShrink: 0,
                    p: 1,
                    display: "flex",
                    alignItems: "center",
                    fontWeight: 700,
                    fontSize: 13,
                    position: "sticky",
                    left: 0,
                    bgcolor: "background.paper",
                    zIndex: 1,
                    borderRight: "1px solid",
                    borderColor: "divider",
                  }}
                >
                  {court.name}
                </Box>
                {columns.map((col) => {
                  const idx = startMap.get(col.start);
                  const slot = idx != null ? court.slots[idx] : null;
                  if (!slot) {
                    return <Box key={col.start} sx={{ width: CELL_W, flexShrink: 0 }} />;
                  }
                  const selected = isSelected(court, idx);
                  const unavailable = slot.booked || slot.past;
                  let bg = "background.paper";
                  let fg = "text.primary";
                  if (selected) {
                    bg = "primary.main";
                    fg = "#fff";
                  } else if (slot.booked) {
                    bg = "error.light";
                    fg = "#fff";
                  } else if (slot.past) {
                    bg = "action.disabledBackground";
                    fg = "text.disabled";
                  }
                  return (
                    <Box
                      key={col.start}
                      onClick={() => clickSlot(court, idx)}
                      sx={{
                        width: CELL_W,
                        flexShrink: 0,
                        p: 0.5,
                        m: 0.5,
                        borderRadius: 1.5,
                        textAlign: "center",
                        cursor: unavailable || disabled ? "default" : "pointer",
                        bgcolor: bg,
                        color: fg,
                        border: "1px solid",
                        borderColor: selected ? "primary.main" : "divider",
                        userSelect: "none",
                        transition: "background-color .1s",
                        "&:hover": unavailable || disabled
                          ? {}
                          : { borderColor: "primary.main", boxShadow: 1 },
                      }}
                    >
                      <Typography sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}>
                        {slot.start}
                      </Typography>
                      <Typography sx={{ fontSize: 10, opacity: 0.85, lineHeight: 1.3 }}>
                        {slot.booked ? "Đã đặt" : fmtVND(slot.price)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Thanh tổng kết + đặt */}
      {summary ? (
        <Paper
          elevation={3}
          sx={{
            mt: 2,
            p: 2,
            borderRadius: 3,
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 1.5,
            border: "1px solid",
            borderColor: "primary.main",
          }}
        >
          <Box>
            <Typography variant="subtitle2" color="text.secondary">
              {summary.courtName} • {summary.count} khung
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              {summary.start} – {summary.end}
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
            <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
              <Typography variant="caption" color="text.secondary">
                Tạm tính
              </Typography>
              <Typography variant="h6" fontWeight={900} color="primary.main">
                {fmtVND(summary.total)}
              </Typography>
            </Box>
            <Button
              size="large"
              variant="contained"
              startIcon={<EventAvailableIcon />}
              disabled={disabled}
              onClick={() => onConfirm?.(summary)}
            >
              Đặt sân
            </Button>
          </Stack>
        </Paper>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
          Chọn 1 hoặc nhiều khung giờ liền nhau trên cùng một sân để đặt.
        </Typography>
      )}
    </Box>
  );
}

function Legend({ color, label, border = false, textColor }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box
        sx={{
          width: 16,
          height: 16,
          borderRadius: 0.75,
          bgcolor: color,
          border: border ? "1px solid" : "none",
          borderColor: "divider",
          color: textColor,
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Stack>
  );
}
