// Quản lý widget overlay cho app live native (tournament.overlay.widgets).
// Preview 16:9 kéo-thả vị trí; lưu qua PATCH /api/tournaments/:id/overlay { widgets }.
// App native nhận realtime qua socket rebroadcast — không cần build lại app.
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import SaveIcon from "@mui/icons-material/Save";
import { toast } from "react-toastify";
import { useUpdateOverlayMutation } from "../../slices/tournamentsApiSlice";

const MAX_WIDGETS = 6;

const TYPE_OPTIONS = [
  { value: "image", label: "Ảnh PNG (thiết kế sẵn, nền trong suốt)" },
  { value: "text", label: "Chữ / caption" },
  { value: "stats", label: "Bảng set (app tự vẽ)" },
];

const TYPE_DEFAULTS = {
  image: { url: "", x: 0.03, y: 0.6, w: 0.28, opacity: 1 },
  text: {
    text: "",
    x: 0.35,
    y: 0.05,
    w: 0.3,
    size: 0.045,
    opacity: 1,
    color: "#FFFFFF",
    bg: "#000000B3",
  },
  stats: { x: 0.03, y: 0.72, w: 0.34, opacity: 1 },
};

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v) || 0));
const round3 = (v) => Math.round((Number(v) || 0) * 1000) / 1000;

const makeId = () =>
  `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

const normalizeWidget = (raw) => {
  const type = ["image", "text", "stats"].includes(raw?.type)
    ? raw.type
    : "image";
  const defaults = TYPE_DEFAULTS[type];
  return {
    id: raw?.id || makeId(),
    type,
    enabled: raw?.enabled !== false,
    url: typeof raw?.url === "string" ? raw.url : defaults.url || "",
    text: typeof raw?.text === "string" ? raw.text : defaults.text || "",
    x: clamp01(raw?.x ?? defaults.x),
    y: clamp01(raw?.y ?? defaults.y),
    w: Math.min(1, Math.max(0.02, Number(raw?.w ?? defaults.w) || defaults.w)),
    size: Math.min(
      0.2,
      Math.max(0.01, Number(raw?.size ?? defaults.size ?? 0.045) || 0.045),
    ),
    opacity: clamp01(raw?.opacity ?? 1),
    color: typeof raw?.color === "string" ? raw.color : defaults.color || "",
    bg: typeof raw?.bg === "string" ? raw.bg : defaults.bg || "",
  };
};

const toPayload = (widgets) =>
  widgets.map((w) => ({
    id: w.id,
    type: w.type,
    enabled: !!w.enabled,
    ...(w.type === "image" ? { url: (w.url || "").trim() } : {}),
    ...(w.type === "text"
      ? {
          text: (w.text || "").trim(),
          size: round3(w.size),
          color: (w.color || "").trim() || undefined,
          bg: (w.bg || "").trim() || undefined,
        }
      : {}),
    x: round3(w.x),
    y: round3(w.y),
    w: round3(w.w),
    opacity: round3(w.opacity),
  }));

/* ---------- Preview widget box (draggable) ---------- */
function PreviewBox({ widget, selected, disabled, onSelect, onMove }) {
  const dragRef = useRef(null);

  const handlePointerDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    onSelect?.(widget.id);
    const surface = e.currentTarget.parentElement;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const origin = { x: widget.x, y: widget.y };
    dragRef.current = { rect, startX, startY, origin };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / drag.rect.width;
    const dy = (e.clientY - drag.startY) / drag.rect.height;
    onMove?.(widget.id, clamp01(drag.origin.x + dx), clamp01(drag.origin.y + dy));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const width = `${widget.w * 100}%`;

  let body = null;
  if (widget.type === "image") {
    body = widget.url ? (
      <img
        src={widget.url}
        alt=""
        draggable={false}
        style={{ width: "100%", display: "block", pointerEvents: "none" }}
        onError={(e) => {
          e.currentTarget.style.opacity = 0.25;
        }}
      />
    ) : (
      <Box sx={{ p: 0.5, fontSize: 10, color: "grey.400" }}>Chưa có URL ảnh</Box>
    );
  } else if (widget.type === "text") {
    body = (
      <Box
        sx={{
          px: 0.75,
          py: 0.25,
          fontWeight: 700,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          fontSize: `${Math.max(8, widget.size * 160)}px`,
          color: widget.color || "#fff",
          bgcolor: widget.bg || "transparent",
          borderRadius: 0.5,
        }}
      >
        {widget.text || "Nội dung chữ…"}
      </Box>
    );
  } else {
    body = (
      <Box
        sx={{
          p: 0.5,
          bgcolor: "rgba(15,23,42,0.85)",
          borderRadius: 0.5,
          color: "#fff",
          fontSize: 9,
          lineHeight: 1.5,
        }}
      >
        <div>Đội A&nbsp;&nbsp;11&nbsp;&nbsp;5&nbsp;&nbsp;• 7</div>
        <div>Đội B&nbsp;&nbsp;&nbsp;8&nbsp;&nbsp;11&nbsp;&nbsp;&nbsp;4</div>
      </Box>
    );
  }

  return (
    <Box
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      sx={{
        position: "absolute",
        left: `${widget.x * 100}%`,
        top: `${widget.y * 100}%`,
        width,
        cursor: disabled ? "default" : "grab",
        opacity: widget.enabled ? widget.opacity : 0.3,
        outline: selected ? "2px solid #38bdf8" : "1px dashed rgba(255,255,255,0.35)",
        outlineOffset: 1,
        touchAction: "none",
        userSelect: "none",
      }}
    >
      {body}
    </Box>
  );
}

/* ---------- Main panel ---------- */
export default function OverlayWidgetsPanel({
  tournamentId,
  overlay,
  canManage = false,
  onSaved,
}) {
  const [updateOverlay, { isLoading: saving }] = useUpdateOverlayMutation();
  const [widgets, setWidgets] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [dirty, setDirty] = useState(false);

  const serverWidgets = useMemo(
    () => (Array.isArray(overlay?.widgets) ? overlay.widgets : []),
    [overlay?.widgets],
  );

  useEffect(() => {
    if (dirty) return;
    setWidgets(serverWidgets.map(normalizeWidget));
  }, [serverWidgets, dirty]);

  const mutate = useCallback((updater) => {
    setWidgets((prev) => updater(prev));
    setDirty(true);
  }, []);

  const patchWidget = useCallback(
    (id, patch) => {
      mutate((prev) =>
        prev.map((w) => (w.id === id ? { ...w, ...patch } : w)),
      );
    },
    [mutate],
  );

  const handleAdd = (type) => {
    mutate((prev) => {
      if (prev.length >= MAX_WIDGETS) return prev;
      const widget = normalizeWidget({ ...TYPE_DEFAULTS[type], type });
      setSelectedId(widget.id);
      return [...prev, widget];
    });
  };

  const handleDelete = (id) => {
    mutate((prev) => prev.filter((w) => w.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleMove = useCallback(
    (id, x, y) => patchWidget(id, { x, y }),
    [patchWidget],
  );

  const handleSave = async () => {
    try {
      await updateOverlay({
        id: tournamentId,
        body: { widgets: toPayload(widgets) },
      }).unwrap();
      setDirty(false);
      toast.success("Đã lưu widget — app live đang stream cập nhật ngay.");
      onSaved?.();
    } catch (error) {
      toast.error(error?.data?.message || "Không lưu được widget overlay");
    }
  };

  const selected = widgets.find((w) => w.id === selectedId) || null;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h6">Widget overlay (app live)</Typography>
        <Typography variant="body2" color="text.secondary">
          Thêm ảnh PNG thiết kế sẵn, chữ hoặc bảng set lên hình live/record của
          app native. Kéo thả trong khung để đặt vị trí — lưu là app đang stream
          nhận ngay.
        </Typography>
      </Box>

      {/* Preview 16:9 */}
      <Paper
        variant="outlined"
        sx={{
          position: "relative",
          width: "100%",
          aspectRatio: "16 / 9",
          bgcolor: "#10151c",
          overflow: "hidden",
        }}
      >
        {/* Gợi ý vị trí scoreboard sẵn có của app */}
        <Box
          sx={{
            position: "absolute",
            left: "1.5%",
            top: "2.5%",
            width: "30%",
            height: "12%",
            border: "1px dashed rgba(148,163,184,0.5)",
            borderRadius: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(148,163,184,0.7)",
            fontSize: 11,
            pointerEvents: "none",
          }}
        >
          Scoreboard app
        </Box>
        {widgets.map((widget) => (
          <PreviewBox
            key={widget.id}
            widget={widget}
            selected={widget.id === selectedId}
            disabled={!canManage}
            onSelect={setSelectedId}
            onMove={handleMove}
          />
        ))}
      </Paper>

      {/* Add buttons */}
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        {TYPE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            size="small"
            variant="outlined"
            startIcon={<AddIcon />}
            disabled={!canManage || widgets.length >= MAX_WIDGETS}
            onClick={() => handleAdd(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
        <Chip
          size="small"
          label={`${widgets.length}/${MAX_WIDGETS}`}
          sx={{ alignSelf: "center" }}
        />
      </Stack>

      {/* Widget list */}
      <Stack spacing={1}>
        {widgets.map((widget) => {
          const isSelected = widget.id === selectedId;
          return (
            <Paper
              key={widget.id}
              variant="outlined"
              onClick={() => setSelectedId(widget.id)}
              sx={{
                p: 1.5,
                borderColor: isSelected ? "primary.main" : undefined,
                cursor: "pointer",
              }}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Switch
                  size="small"
                  checked={widget.enabled}
                  disabled={!canManage}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    patchWidget(widget.id, { enabled: e.target.checked })
                  }
                />
                <TextField
                  select
                  size="small"
                  value={widget.type}
                  disabled={!canManage}
                  onChange={(e) =>
                    patchWidget(
                      widget.id,
                      normalizeWidget({ ...widget, type: e.target.value }),
                    )
                  }
                  sx={{ minWidth: 170 }}
                >
                  {TYPE_OPTIONS.map((opt) => (
                    <MenuItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Box flex={1} />
                <Tooltip title="Xoá widget">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={!canManage}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(widget.id);
                      }}
                    >
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              {isSelected ? (
                <Stack spacing={1.5} mt={1.5}>
                  {widget.type === "image" ? (
                    <TextField
                      size="small"
                      fullWidth
                      label="URL ảnh PNG (nền trong suốt)"
                      value={widget.url}
                      disabled={!canManage}
                      onChange={(e) =>
                        patchWidget(widget.id, { url: e.target.value })
                      }
                      helperText="Thiết kế trong Overlay Studio / Canva… rồi xuất PNG, dán link tại đây."
                    />
                  ) : null}

                  {widget.type === "text" ? (
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={1.5}
                    >
                      <TextField
                        size="small"
                        fullWidth
                        label="Nội dung"
                        value={widget.text}
                        disabled={!canManage}
                        onChange={(e) =>
                          patchWidget(widget.id, { text: e.target.value })
                        }
                      />
                      <TextField
                        size="small"
                        label="Màu chữ"
                        value={widget.color}
                        disabled={!canManage}
                        onChange={(e) =>
                          patchWidget(widget.id, { color: e.target.value })
                        }
                        sx={{ width: 120 }}
                      />
                      <TextField
                        size="small"
                        label="Màu nền"
                        value={widget.bg}
                        disabled={!canManage}
                        onChange={(e) =>
                          patchWidget(widget.id, { bg: e.target.value })
                        }
                        sx={{ width: 130 }}
                        helperText="#RRGGBBAA"
                      />
                    </Stack>
                  ) : null}

                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={2}
                    alignItems={{ sm: "center" }}
                  >
                    <Box sx={{ minWidth: 180, flex: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Độ rộng: {(widget.w * 100).toFixed(0)}%
                      </Typography>
                      <Slider
                        size="small"
                        min={0.05}
                        max={1}
                        step={0.01}
                        value={widget.w}
                        disabled={!canManage}
                        onChange={(_, v) => patchWidget(widget.id, { w: v })}
                      />
                    </Box>
                    {widget.type === "text" ? (
                      <Box sx={{ minWidth: 180, flex: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Cỡ chữ: {(widget.size * 100).toFixed(1)}
                        </Typography>
                        <Slider
                          size="small"
                          min={0.015}
                          max={0.12}
                          step={0.005}
                          value={widget.size}
                          disabled={!canManage}
                          onChange={(_, v) =>
                            patchWidget(widget.id, { size: v })
                          }
                        />
                      </Box>
                    ) : null}
                    <Box sx={{ minWidth: 180, flex: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        Độ mờ: {(widget.opacity * 100).toFixed(0)}%
                      </Typography>
                      <Slider
                        size="small"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={widget.opacity}
                        disabled={!canManage}
                        onChange={(_, v) =>
                          patchWidget(widget.id, { opacity: v })
                        }
                      />
                    </Box>
                  </Stack>
                </Stack>
              ) : null}
            </Paper>
          );
        })}
        {!widgets.length ? (
          <Typography variant="body2" color="text.secondary">
            Chưa có widget nào — bấm nút thêm ở trên.
          </Typography>
        ) : null}
      </Stack>

      <Divider />
      <Stack direction="row" spacing={1} alignItems="center">
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={!canManage || saving || !dirty}
          onClick={handleSave}
        >
          {saving ? "Đang lưu…" : "Lưu widget"}
        </Button>
        {dirty ? (
          <Chip size="small" color="warning" label="Chưa lưu thay đổi" />
        ) : null}
      </Stack>
    </Stack>
  );
}
