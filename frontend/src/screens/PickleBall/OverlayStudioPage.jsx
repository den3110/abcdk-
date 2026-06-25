/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import {
  Add as AddIcon,
  ContentCopy as ContentCopyIcon,
  Delete as DeleteIcon,
  OpenInNew as OpenInNewIcon,
  Save as SaveIcon,
  Send as PublishIcon,
} from "@mui/icons-material";
import { toast } from "react-toastify";

import TemplateOverlayRenderer, {
  overlayTemplateBindingOptions,
} from "../../components/overlay/TemplateOverlayRenderer.jsx";
import {
  useCloneOverlayTemplateMutation,
  useListOverlayTemplateLibraryQuery,
  useListOverlayTemplatesQuery,
  usePublishOverlayTemplateMutation,
  useUpdateOverlayTemplateMutation,
} from "../../slices/overlayTemplateApiSlice.js";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

const previewValues = {
  "tournament.name": "Test giải 4",
  "tournament.logoUrl": "",
  "match.code": "V1-B1-T4",
  "match.round": "1",
  "match.roundLabel": "Vòng bảng",
  "match.stageName": "Group Stage",
  "match.courtName": "Sân T4",
  "teamA.name": "quan.phan / phuc.hoang",
  "teamB.name": "thanh.pham / ngan.nguyen",
  "teamA.seed": "1",
  "teamB.seed": "2",
  scoreA: "8",
  scoreB: "6",
  "sets.teamA": "1",
  "sets.teamB": "0",
  "sets.summary": "11-7, 8-6",
  "serve.side": "A",
};

const numberOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const cloneDocument = (document) => ({
  background: document?.background || "transparent",
  layers: Array.isArray(document?.layers)
    ? document.layers.map((layer) => ({
        ...layer,
        style: { ...(layer.style || {}) },
      }))
    : [],
});

const makeLayerId = (prefix) =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now()
    .toString(36)
    .slice(-3)}`;

function makeTextLayer(binding, label) {
  return {
    id: makeLayerId("text"),
    type: "text",
    label,
    binding,
    text: label,
    x: 140,
    y: 140,
    width: 460,
    height: 70,
    zIndex: 20,
    visible: true,
    style: {
      fontFamily: "Montserrat, Arial, sans-serif",
      fontSize: 42,
      fontWeight: 800,
      color: "#ffffff",
      background: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      textAlign: "left",
      lineHeight: 1.1,
    },
  };
}

function makeRectLayer() {
  return {
    id: makeLayerId("rect"),
    type: "rect",
    label: "Nền",
    binding: "static",
    text: "",
    x: 120,
    y: 120,
    width: 520,
    height: 160,
    zIndex: 0,
    visible: true,
    style: {
      background: "rgba(15,23,42,0.86)",
      borderColor: "rgba(255,255,255,0.18)",
      borderWidth: 1,
      borderRadius: 24,
    },
  };
}

function getLayer(document, selectedLayerId) {
  return (document?.layers || []).find((layer) => layer.id === selectedLayerId);
}

export default function OverlayStudioPage() {
  const { id: routeTournamentId } = useParams();
  const [searchParams] = useSearchParams();
  const tournamentId =
    searchParams.get("tournamentId") || searchParams.get("tid") || routeTournamentId;
  const matchId = searchParams.get("matchId") || "";
  const scopeType = searchParams.get("scopeType") || "tournament";
  const scopeId =
    searchParams.get("scopeId") ||
    (scopeType === "match" ? matchId : tournamentId);

  const canvasWrapRef = useRef(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [savedTemplateId, setSavedTemplateId] = useState("");
  const [name, setName] = useState("Overlay template");
  const [canvas, setCanvas] = useState(DEFAULT_CANVAS);
  const [document, setDocument] = useState({
    background: "transparent",
    layers: [],
  });
  const [selectedLayerId, setSelectedLayerId] = useState("");

  const { data: library = [], isLoading: loadingLibrary } =
    useListOverlayTemplateLibraryQuery();
  const { data: savedTemplates = [], isLoading: loadingSaved } =
    useListOverlayTemplatesQuery(
      { tournamentId },
      { skip: !tournamentId },
    );
  const [cloneTemplate, { isLoading: cloning }] = useCloneOverlayTemplateMutation();
  const [updateTemplate, { isLoading: updating }] =
    useUpdateOverlayTemplateMutation();
  const [publishTemplate, { isLoading: publishing }] =
    usePublishOverlayTemplateMutation();

  const busy = cloning || updating || publishing;
  const selectedLayer = useMemo(
    () => getLayer(document, selectedLayerId),
    [document, selectedLayerId],
  );

  useEffect(() => {
    if (document.layers.length || !library.length) return;
    const first = library[0];
    setSelectedTemplateId(first.id || first.key);
    setSavedTemplateId("");
    setName(first.name || "Overlay template");
    setCanvas(first.canvas || DEFAULT_CANVAS);
    setDocument(cloneDocument(first.document));
    setSelectedLayerId(first.document?.layers?.[0]?.id || "");
  }, [document.layers.length, library]);

  const applyTemplate = (template, saved = false) => {
    setSelectedTemplateId(template.id || template.key || "");
    setSavedTemplateId(saved ? template.id : "");
    setName(template.name || "Overlay template");
    setCanvas(template.canvas || DEFAULT_CANVAS);
    const nextDocument = cloneDocument(template.document);
    setDocument(nextDocument);
    setSelectedLayerId(nextDocument.layers?.[0]?.id || "");
  };

  const patchDocument = (updater) => {
    setDocument((prev) => {
      const next =
        typeof updater === "function" ? updater(cloneDocument(prev)) : updater;
      return cloneDocument(next);
    });
  };

  const patchSelectedLayer = (patcher) => {
    if (!selectedLayerId) return;
    patchDocument((draft) => ({
      ...draft,
      layers: draft.layers.map((layer) => {
        if (layer.id !== selectedLayerId) return layer;
        const patch =
          typeof patcher === "function" ? patcher(layer) : patcher || {};
        return {
          ...layer,
          ...patch,
          style: { ...(layer.style || {}), ...(patch.style || {}) },
        };
      }),
    }));
  };

  const addLayer = (kind) => {
    const layer =
      kind === "rect"
        ? makeRectLayer()
        : makeTextLayer(kind, kind === "scoreA" ? "Điểm A" : "Text");
    patchDocument((draft) => ({
      ...draft,
      layers: [...draft.layers, layer],
    }));
    setSelectedLayerId(layer.id);
  };

  const duplicateSelectedLayer = () => {
    if (!selectedLayer) return;
    const copy = {
      ...selectedLayer,
      id: makeLayerId(selectedLayer.type || "layer"),
      label: `${selectedLayer.label || "Layer"} copy`,
      x: numberOr(selectedLayer.x, 0) + 32,
      y: numberOr(selectedLayer.y, 0) + 32,
      zIndex: numberOr(selectedLayer.zIndex, 0) + 1,
      style: { ...(selectedLayer.style || {}) },
    };
    patchDocument((draft) => ({ ...draft, layers: [...draft.layers, copy] }));
    setSelectedLayerId(copy.id);
  };

  const deleteSelectedLayer = () => {
    if (!selectedLayerId) return;
    patchDocument((draft) => ({
      ...draft,
      layers: draft.layers.filter((layer) => layer.id !== selectedLayerId),
    }));
    setSelectedLayerId("");
  };

  const handleLayerPointerDown = (event, layer) => {
    if (!layer || layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    setSelectedLayerId(layer.id);

    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const originX = numberOr(layer.x, 0);
    const originY = numberOr(layer.y, 0);
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const move = (moveEvent) => {
      const nextX = Math.round(originX + (moveEvent.clientX - startX) * scaleX);
      const nextY = Math.round(originY + (moveEvent.clientY - startY) * scaleY);
      patchDocument((draft) => ({
        ...draft,
        layers: draft.layers.map((item) =>
          item.id === layer.id ? { ...item, x: nextX, y: nextY } : item,
        ),
      }));
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const saveDraft = async () => {
    if (!tournamentId) {
      toast.error("Thiếu tournamentId");
      return null;
    }

    const body = {
      tournamentId,
      scopeType,
      scopeId,
      name,
      canvas,
      document,
    };

    try {
      const response = savedTemplateId
        ? await updateTemplate({ id: savedTemplateId, ...body }).unwrap()
        : await cloneTemplate({
            ...body,
            sourceTemplateKey: selectedTemplateId,
          }).unwrap();
      const template = response?.template;
      if (template?.id) {
        setSavedTemplateId(template.id);
        setSelectedTemplateId(template.id);
      }
      toast.success("Đã lưu draft overlay");
      return template;
    } catch (error) {
      toast.error(error?.data?.message || "Không lưu được overlay");
      return null;
    }
  };

  const publishCurrent = async () => {
    const template = savedTemplateId ? { id: savedTemplateId } : await saveDraft();
    if (!template?.id) return;
    try {
      await publishTemplate({ id: template.id, tournamentId }).unwrap();
      toast.success("Đã publish overlay cho live");
    } catch (error) {
      toast.error(error?.data?.message || "Không publish được overlay");
    }
  };

  const livePreviewUrl = matchId
    ? `/overlay/score?matchId=${encodeURIComponent(matchId)}`
    : "";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: 2 }}>
      <Stack spacing={2}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "stretch", md: "center" }}
          justifyContent="space-between"
        >
          <Box>
            <Typography variant="h5" fontWeight={800}>
              Overlay Studio
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Chọn template có sẵn, chỉnh layer và publish cho live overlay.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {livePreviewUrl ? (
              <Button
                component={Link}
                to={livePreviewUrl}
                target="_blank"
                rel="noreferrer"
                startIcon={<OpenInNewIcon />}
              >
                Preview live
              </Button>
            ) : null}
            <Button
              variant="outlined"
              startIcon={<SaveIcon />}
              disabled={busy || !tournamentId}
              onClick={saveDraft}
            >
              Lưu draft
            </Button>
            <Button
              variant="contained"
              startIcon={<PublishIcon />}
              disabled={busy || !tournamentId}
              onClick={publishCurrent}
            >
              Publish
            </Button>
          </Stack>
        </Stack>

        {!tournamentId ? (
          <Alert severity="warning">
            Thiếu tournamentId. Hãy mở Studio từ trang quản lý giải.
          </Alert>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0,1fr) 320px" },
            gap: 2,
            alignItems: "start",
          }}
        >
          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
              Template hệ thống
            </Typography>
            <Stack spacing={1}>
              {loadingLibrary ? (
                <Typography variant="body2" color="text.secondary">
                  Đang tải template...
                </Typography>
              ) : (
                library.map((template) => (
                  <Button
                    key={template.id || template.key}
                    variant={
                      selectedTemplateId === (template.id || template.key)
                        ? "contained"
                        : "outlined"
                    }
                    onClick={() => applyTemplate(template, false)}
                    sx={{ justifyContent: "flex-start", textAlign: "left" }}
                  >
                    {template.name}
                  </Button>
                ))
              )}
            </Stack>

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2" fontWeight={800} sx={{ mb: 1 }}>
              Bản đã lưu
            </Typography>
            <Stack spacing={1}>
              {loadingSaved ? (
                <Typography variant="body2" color="text.secondary">
                  Đang tải bản đã lưu...
                </Typography>
              ) : savedTemplates.length ? (
                savedTemplates.map((template) => (
                  <Button
                    key={template.id}
                    variant={savedTemplateId === template.id ? "contained" : "outlined"}
                    color={template.status === "published" ? "success" : "primary"}
                    onClick={() => applyTemplate(template, true)}
                    sx={{ justifyContent: "space-between", textAlign: "left" }}
                  >
                    <span>{template.name}</span>
                    {template.status === "published" ? (
                      <Chip size="small" label="Live" color="success" />
                    ) : null}
                  </Button>
                ))
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Chưa có draft nào.
                </Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
            <Stack
              direction={{ xs: "column", md: "row" }}
              spacing={1}
              alignItems={{ xs: "stretch", md: "center" }}
              justifyContent="space-between"
              sx={{ mb: 1.5 }}
            >
              <TextField
                size="small"
                label="Tên template"
                value={name}
                onChange={(event) => setName(event.target.value)}
                sx={{ minWidth: { xs: "100%", md: 320 } }}
              />
              <Stack direction="row" spacing={1}>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => addLayer("teamA.name")}
                >
                  Text
                </Button>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => addLayer("scoreA")}
                >
                  Điểm
                </Button>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => addLayer("rect")}
                >
                  Nền
                </Button>
              </Stack>
            </Stack>

            <Box
              ref={canvasWrapRef}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "#0f172a",
                overflow: "hidden",
              }}
            >
              <TemplateOverlayRenderer
                mode="editor"
                document={document}
                canvas={canvas}
                values={previewValues}
                selectedLayerId={selectedLayerId}
                onLayerPointerDown={handleLayerPointerDown}
                onLayerClick={(event, layer) => {
                  event.stopPropagation();
                  setSelectedLayerId(layer.id);
                }}
                style={{ background: "#101827" }}
              />
            </Box>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1.5 }}>
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              sx={{ mb: 1 }}
            >
              <Typography variant="subtitle2" fontWeight={800}>
                Layer
              </Typography>
              <Stack direction="row" spacing={0.5}>
                <Tooltip title="Nhân bản layer">
                  <span>
                    <IconButton
                      size="small"
                      disabled={!selectedLayer}
                      onClick={duplicateSelectedLayer}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Xóa layer">
                  <span>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={!selectedLayer}
                      onClick={deleteSelectedLayer}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>

            <Stack spacing={1} sx={{ mb: 2 }}>
              {document.layers.map((layer) => (
                <Button
                  key={layer.id}
                  variant={selectedLayerId === layer.id ? "contained" : "outlined"}
                  size="small"
                  onClick={() => setSelectedLayerId(layer.id)}
                  sx={{ justifyContent: "flex-start" }}
                >
                  {layer.label || layer.id}
                </Button>
              ))}
            </Stack>

            {selectedLayer ? (
              <Stack spacing={1.25}>
                <TextField
                  size="small"
                  label="Tên layer"
                  value={selectedLayer.label || ""}
                  onChange={(event) =>
                    patchSelectedLayer({ label: event.target.value })
                  }
                />
                {selectedLayer.type !== "rect" ? (
                  <TextField
                    select
                    size="small"
                    label="Dữ liệu"
                    value={selectedLayer.binding || "static"}
                    onChange={(event) =>
                      patchSelectedLayer({ binding: event.target.value })
                    }
                  >
                    {overlayTemplateBindingOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                {selectedLayer.type !== "rect" ? (
                  <TextField
                    size="small"
                    label="Text fallback"
                    value={selectedLayer.text || ""}
                    onChange={(event) =>
                      patchSelectedLayer({ text: event.target.value })
                    }
                  />
                ) : null}
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 1,
                  }}
                >
                  {["x", "y", "width", "height"].map((field) => (
                    <TextField
                      key={field}
                      size="small"
                      type="number"
                      label={field}
                      value={selectedLayer[field] ?? 0}
                      onChange={(event) =>
                        patchSelectedLayer({ [field]: Number(event.target.value) })
                      }
                    />
                  ))}
                </Box>
                {selectedLayer.type !== "rect" ? (
                  <Box
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: 1,
                    }}
                  >
                    <TextField
                      size="small"
                      type="number"
                      label="Font size"
                      value={selectedLayer.style?.fontSize ?? 36}
                      onChange={(event) =>
                        patchSelectedLayer({
                          style: { fontSize: Number(event.target.value) },
                        })
                      }
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Weight"
                      value={selectedLayer.style?.fontWeight ?? 700}
                      onChange={(event) =>
                        patchSelectedLayer({
                          style: { fontWeight: Number(event.target.value) },
                        })
                      }
                    />
                  </Box>
                ) : null}
                <TextField
                  size="small"
                  label="Màu chữ"
                  value={selectedLayer.style?.color || "#ffffff"}
                  onChange={(event) =>
                    patchSelectedLayer({ style: { color: event.target.value } })
                  }
                  disabled={selectedLayer.type === "rect"}
                />
                <TextField
                  size="small"
                  label="Nền"
                  value={selectedLayer.style?.background || "transparent"}
                  onChange={(event) =>
                    patchSelectedLayer({
                      style: { background: event.target.value },
                    })
                  }
                />
                <TextField
                  size="small"
                  type="number"
                  label="Bo góc"
                  value={selectedLayer.style?.borderRadius ?? 0}
                  onChange={(event) =>
                    patchSelectedLayer({
                      style: { borderRadius: Number(event.target.value) },
                    })
                  }
                />
                <TextField
                  select
                  size="small"
                  label="Căn chữ"
                  value={selectedLayer.style?.textAlign || "left"}
                  onChange={(event) =>
                    patchSelectedLayer({
                      style: { textAlign: event.target.value },
                    })
                  }
                  disabled={selectedLayer.type === "rect"}
                >
                  <MenuItem value="left">Trái</MenuItem>
                  <MenuItem value="center">Giữa</MenuItem>
                  <MenuItem value="right">Phải</MenuItem>
                </TextField>
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Chọn một layer trên canvas hoặc danh sách bên trên để chỉnh.
              </Typography>
            )}
          </Paper>
        </Box>
      </Stack>
    </Box>
  );
}
