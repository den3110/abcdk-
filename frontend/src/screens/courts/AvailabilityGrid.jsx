/* eslint-disable react/prop-types */
import { useMemo, useState, useEffect } from "react";
import { Box, Typography, Stack, Button, useTheme, alpha } from "@mui/material";
import EventAvailableIcon from "@mui/icons-material/EventAvailable";
import CloseIcon from "@mui/icons-material/Close";
import { fmtVND } from "./courtShared";

/**
 * Lưới đặt sân theo giờ.
 * props:
 *  - data: { slotMinutes, courts: [{ _id, name, closed, slots: [{start,end,price,booked,past}] }] }
 *  - disabled: bool
 *  - onConfirm({ courtId, courtName, start, end, total, count })
 */
export default function AvailabilityGrid({ data, disabled = false, onConfirm }) {
  const theme = useTheme();
  const courts = useMemo(
    () => (Array.isArray(data?.courts) ? data.courts : []),
    [data],
  );

  // Cột thời gian = sân có nhiều slot nhất
  const columns = useMemo(() => {
    let best = [];
    for (const c of courts) if ((c.slots?.length || 0) > best.length) best = c.slots || [];
    return best.map((s) => s.start);
  }, [courts]);

  const [sel, setSel] = useState(null); // { courtId, lo, hi }
  useEffect(() => setSel(null), [data?.date, data?.venueId]);

  const courtById = useMemo(() => new Map(courts.map((c) => [c._id, c])), [courts]);
  const selCourt = sel ? courtById.get(sel.courtId) : null;

  const summary = useMemo(() => {
    if (!sel || !selCourt) return null;
    const slots = selCourt.slots || [];
    const lo = Math.min(sel.lo, sel.hi);
    const hi = Math.max(sel.lo, sel.hi);
    let total = 0;
    for (let i = lo; i <= hi; i += 1) total += Number(slots[i]?.price || 0);
    return { courtId: selCourt._id, courtName: selCourt.name, start: slots[lo]?.start, end: slots[hi]?.end, total, count: hi - lo + 1 };
  }, [sel, selCourt]);

  function clickSlot(court, idx) {
    if (disabled) return;
    const slots = court.slots || [];
    const s = slots[idx];
    if (!s || s.booked || s.past) return;
    if (!sel || sel.courtId !== court._id) return setSel({ courtId: court._id, lo: idx, hi: idx });
    if (sel.lo === idx && sel.hi === idx) return setSel(null);
    const lo = Math.min(sel.lo, idx);
    const hi = Math.max(sel.hi, idx);
    for (let i = lo; i <= hi; i += 1) {
      const t = slots[i];
      if (!t || t.booked || t.past) return setSel({ courtId: court._id, lo: idx, hi: idx });
    }
    setSel({ courtId: court._id, lo, hi });
  }

  if (!courts.length) {
    return (
      <Box sx={{ py: 6, textAlign: "center", color: "text.secondary" }}>
        <Typography>Chưa có sân nào cho ngày này.</Typography>
      </Box>
    );
  }

  const COURT_COL = 120;
  const CELL_W = 76;
  const noMotion = { "@media (prefers-reduced-motion: reduce)": { transition: "none" } };

  return (
    <Box>
      {/* Chú thích trạng thái */}
      <Stack direction="row" spacing={2.5} sx={{ mb: 1.5, flexWrap: "wrap" }} useFlexGap>
        <Legend swatch={{ bgcolor: "background.paper", border: `1px solid ${theme.palette.divider}` }} label="Còn trống" />
        <Legend swatch={{ bgcolor: "primary.main" }} label="Đang chọn" />
        <Legend swatch={{ bgcolor: alpha(theme.palette.error.main, 0.16), border: `1px solid ${alpha(theme.palette.error.main, 0.3)}` }} label="Đã đặt" />
        <Legend swatch={{ bgcolor: "action.hover" }} label="Đã qua" />
      </Stack>

      <Box
        sx={{
          overflowX: "auto",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 3,
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ minWidth: COURT_COL + columns.length * CELL_W, position: "relative" }}>
          {/* Header giờ */}
          <Box sx={{ display: "flex", position: "sticky", top: 0, zIndex: 3, bgcolor: alpha(theme.palette.background.paper, 0.96), backdropFilter: "blur(6px)", borderBottom: `1px solid ${theme.palette.divider}` }}>
            <Box sx={{ width: COURT_COL, flexShrink: 0, p: 1.25, fontSize: 12, fontWeight: 700, color: "text.secondary", position: "sticky", left: 0, zIndex: 1, bgcolor: alpha(theme.palette.background.paper, 0.96) }}>
              Sân
            </Box>
            {columns.map((start) => (
              <Box key={start} sx={{ width: CELL_W, flexShrink: 0, py: 1, textAlign: "center", fontSize: 11.5, fontWeight: 600, color: "text.secondary" }}>
                {start}
              </Box>
            ))}
          </Box>

          {/* Mỗi sân 1 hàng */}
          {courts.map((court, rowIdx) => {
            const startMap = new Map((court.slots || []).map((s, i) => [s.start, i]));
            const isSel = (i) => sel && sel.courtId === court._id && i >= Math.min(sel.lo, sel.hi) && i <= Math.max(sel.lo, sel.hi);
            return (
              <Box
                key={court._id}
                sx={{
                  display: "flex",
                  alignItems: "stretch",
                  minHeight: 60,
                  bgcolor: rowIdx % 2 ? alpha(theme.palette.text.primary, 0.015) : "transparent",
                  "&:not(:last-of-type)": { borderBottom: `1px solid ${theme.palette.divider}` },
                }}
              >
                {/* Tên sân (sticky trái) */}
                <Box sx={{ width: COURT_COL, flexShrink: 0, px: 1.25, display: "flex", alignItems: "center", gap: 1, position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper", borderRight: `1px solid ${theme.palette.divider}` }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: court.closed ? "text.disabled" : "success.main", flexShrink: 0 }} />
                  <Typography sx={{ fontWeight: 700, fontSize: 13.5 }} noWrap>
                    {court.name}
                  </Typography>
                </Box>

                {court.closed ? (
                  <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "text.disabled", fontSize: 13, fontStyle: "italic" }}>
                    Đóng cửa
                  </Box>
                ) : (
                  columns.map((colStart) => {
                    const idx = startMap.get(colStart);
                    const slot = idx != null ? court.slots[idx] : null;
                    if (!slot) return <Box key={colStart} sx={{ width: CELL_W, flexShrink: 0 }} />;
                    const selected = isSel(idx);
                    const runStart = selected && !isSel(idx - 1);
                    const runEnd = selected && !isSel(idx + 1);
                    const clickable = !slot.booked && !slot.past && !disabled;

                    let sx = {
                      bgcolor: "transparent",
                      color: "text.primary",
                      borderColor: theme.palette.divider,
                    };
                    if (selected) {
                      sx = { bgcolor: "primary.main", color: theme.palette.primary.contrastText, borderColor: theme.palette.primary.main };
                    } else if (slot.booked) {
                      sx = { bgcolor: alpha(theme.palette.error.main, 0.13), color: theme.palette.error.dark, borderColor: alpha(theme.palette.error.main, 0.25) };
                    } else if (slot.past) {
                      sx = { bgcolor: alpha(theme.palette.text.primary, 0.04), color: "text.disabled", borderColor: "transparent" };
                    }

                    return (
                      <Box key={colStart} sx={{ width: CELL_W, flexShrink: 0, p: 0.5 }}>
                        <Box
                          onClick={() => clickSlot(court, idx)}
                          sx={{
                            height: "100%",
                            minHeight: 48,
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 0.25,
                            border: `1px solid ${sx.borderColor}`,
                            bgcolor: sx.bgcolor,
                            color: sx.color,
                            borderTopLeftRadius: selected && !runStart ? 0 : 10,
                            borderBottomLeftRadius: selected && !runStart ? 0 : 10,
                            borderTopRightRadius: selected && !runEnd ? 0 : 10,
                            borderBottomRightRadius: selected && !runEnd ? 0 : 10,
                            cursor: clickable ? "pointer" : "default",
                            userSelect: "none",
                            transition: "background-color .14s ease, border-color .14s ease, transform .14s ease",
                            ...noMotion,
                            ...(clickable && {
                              "&:hover": {
                                borderColor: theme.palette.primary.main,
                                bgcolor: selected ? "primary.dark" : alpha(theme.palette.primary.main, 0.08),
                                transform: "translateY(-1px)",
                              },
                            }),
                          }}
                        >
                          <Typography sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.1 }}>{slot.start}</Typography>
                          <Typography sx={{ fontSize: 10.5, fontWeight: 600, opacity: slot.booked || slot.past ? 0.9 : 0.7, lineHeight: 1.1 }}>
                            {slot.booked ? "Đã đặt" : slot.past ? "—" : fmtVND(slot.price)}
                          </Typography>
                        </Box>
                      </Box>
                    );
                  })
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Thanh tổng kết */}
      {summary ? (
        <Box
          sx={{
            position: "sticky",
            bottom: 12,
            zIndex: 5,
            mt: 2,
            p: { xs: 1.5, sm: 2 },
            borderRadius: 3,
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "center" },
            justifyContent: "space-between",
            gap: 1.5,
            color: theme.palette.primary.contrastText,
            background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark})`,
            boxShadow: `0 10px 30px -8px ${alpha(theme.palette.primary.main, 0.5)}`,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: 12, opacity: 0.85 }}>
              {summary.courtName} · {summary.count} khung giờ
            </Typography>
            <Typography sx={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15 }}>
              {summary.start} – {summary.end}
            </Typography>
          </Box>
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
            <Box sx={{ textAlign: { xs: "left", sm: "right" } }}>
              <Typography sx={{ fontSize: 11, opacity: 0.85 }}>Tạm tính</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: 900, lineHeight: 1.1 }}>{fmtVND(summary.total)}</Typography>
            </Box>
            <Button
              size="large"
              variant="contained"
              startIcon={<EventAvailableIcon />}
              disabled={disabled}
              onClick={() => onConfirm?.(summary)}
              sx={{
                bgcolor: "#fff",
                color: "primary.main",
                fontWeight: 800,
                px: 2.5,
                boxShadow: "none",
                "&:hover": { bgcolor: alpha("#ffffff", 0.9), boxShadow: "none" },
              }}
            >
              Đặt sân
            </Button>
            <Button onClick={() => setSel(null)} sx={{ color: "#fff", minWidth: 0, p: 1, "&:hover": { bgcolor: alpha("#ffffff", 0.15) } }} aria-label="Bỏ chọn">
              <CloseIcon fontSize="small" />
            </Button>
          </Stack>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5, textAlign: "center" }}>
          Chạm vào 1 hoặc nhiều khung giờ liền nhau trên cùng một sân để đặt.
        </Typography>
      )}
    </Box>
  );
}

function Legend({ swatch, label }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center">
      <Box sx={{ width: 16, height: 16, borderRadius: 1, ...swatch }} />
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Stack>
  );
}
