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
import { alpha } from "@mui/material/styles";
import { toast } from "react-toastify";

import TemplateOverlayRenderer from "../../components/overlay/TemplateOverlayRenderer.jsx";
import { overlayTemplateBindingOptions } from "../../utils/overlayTemplateBindings.js";
import { overlaySystemTemplates } from "../../utils/overlayTemplateSystemTemplates.js";
import {
  useCloneOverlayTemplateMutation,
  useListOverlayTemplateLibraryQuery,
  useListOverlayTemplatesQuery,
  usePublishOverlayTemplateMutation,
  useUpdateOverlayTemplateMutation,
} from "../../slices/overlayTemplateApiSlice.js";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

const editorRootSx = {
  minHeight: "100vh",
  bgcolor: (theme) => (theme.palette.mode === "dark" ? "#080b12" : "#f4f6fb"),
  p: { xs: 1, md: 1.5 },
};

const topBarSx = (theme) => ({
  px: { xs: 1.25, md: 1.5 },
  py: 1.25,
  borderRadius: 2,
  border: `1px solid ${alpha(theme.palette.divider, 0.78)}`,
  bgcolor:
    theme.palette.mode === "dark"
      ? alpha("#111827", 0.96)
      : alpha(theme.palette.background.paper, 0.96),
});

const panelSx = (theme) => ({
  borderRadius: 2,
  border: `1px solid ${alpha(theme.palette.divider, 0.82)}`,
  bgcolor:
    theme.palette.mode === "dark"
      ? alpha("#10141d", 0.96)
      : theme.palette.background.paper,
  overflow: "hidden",
});

const panelHeaderSx = {
  px: 1.5,
  py: 1.25,
  borderBottom: "1px solid",
  borderColor: "divider",
};

const panelBodySx = {
  p: 1.25,
};

const templateButtonSx = (active) => (theme) => ({
  width: "100%",
  justifyContent: "flex-start",
  alignItems: "stretch",
  textAlign: "left",
  textTransform: "none",
  borderRadius: 1.5,
  p: 1.1,
  color: "text.primary",
  border: `1px solid ${
    active
      ? alpha(theme.palette.primary.main, 0.62)
      : alpha(theme.palette.divider, 0.85)
  }`,
  bgcolor: active
    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.1)
    : alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.035 : 0.025),
  "&:hover": {
    borderColor: alpha(theme.palette.primary.main, 0.72),
    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.2 : 0.12),
  },
});

const layerButtonSx = (active) => (theme) => ({
  width: "100%",
  justifyContent: "space-between",
  textAlign: "left",
  textTransform: "none",
  borderRadius: 1.5,
  px: 1,
  py: 0.75,
  color: "text.primary",
  border: `1px solid ${
    active
      ? alpha(theme.palette.primary.main, 0.58)
      : alpha(theme.palette.divider, 0.75)
  }`,
  bgcolor: active
    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.1)
    : "transparent",
  "&:hover": {
    borderColor: alpha(theme.palette.primary.main, 0.62),
    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.18 : 0.08),
  },
});

const canvasSurfaceSx = {
  backgroundColor: "#111827",
  backgroundImage: `
    linear-gradient(45deg, rgba(255,255,255,0.055) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255,255,255,0.055) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255,255,255,0.055) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255,255,255,0.055) 75%)
  `,
  backgroundSize: "32px 32px",
  backgroundPosition: "0 0, 0 16px, 16px -16px, -16px 0",
};

const fieldGridSx = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 1,
};

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

  const {
    data: remoteLibrary = [],
    isLoading: loadingLibrary,
    isError: libraryError,
  } = useListOverlayTemplateLibraryQuery();
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
  const library = remoteLibrary.length ? remoteLibrary : overlaySystemTemplates;
  const usingLocalLibrary = !remoteLibrary.length;
  const hasLayers = Array.isArray(document.layers) && document.layers.length > 0;
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
    <Box sx={editorRootSx}>
      <Stack spacing={1.5}>
        <Paper elevation={0} sx={topBarSx}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.25}
            alignItems={{ xs: "stretch", md: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
              <Box
                sx={(theme) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 1.5,
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 900,
                  color: theme.palette.primary.main,
                  bgcolor: alpha(theme.palette.primary.main, 0.14),
                  border: `1px solid ${alpha(theme.palette.primary.main, 0.24)}`,
                  flex: "0 0 auto",
                })}
              >
                OS
              </Box>
              <Box minWidth={0}>
                <Typography variant="h6" fontWeight={900} lineHeight={1.15}>
                  Overlay Studio
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.75}
                  alignItems="center"
                  flexWrap="wrap"
                  sx={{ mt: 0.5 }}
                >
                  <Chip
                    size="small"
                    label={
                      scopeType === "match"
                        ? "Trận"
                        : scopeType === "bracket"
                          ? "Bracket"
                          : "Giải"
                    }
                    variant="outlined"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {canvas.width} x {canvas.height}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {document.layers.length} layer
                  </Typography>
                </Stack>
              </Box>
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              justifyContent={{ xs: "flex-start", md: "flex-end" }}
              useFlexGap
            >
              {livePreviewUrl ? (
                <Button
                  component={Link}
                  to={livePreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  size="small"
                  variant="outlined"
                  startIcon={<OpenInNewIcon />}
                >
                  Preview live
                </Button>
              ) : null}
              <Button
                size="small"
                variant="outlined"
                startIcon={<SaveIcon />}
                disabled={busy || !tournamentId}
                onClick={saveDraft}
              >
                Lưu draft
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<PublishIcon />}
                disabled={busy || !tournamentId}
                onClick={publishCurrent}
              >
                Publish
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {!tournamentId ? (
          <Alert severity="warning">
            Thiếu tournamentId. Hãy mở Studio từ trang quản lý giải.
          </Alert>
        ) : null}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", lg: "300px minmax(0,1fr) 344px" },
            gap: 1.5,
            alignItems: "stretch",
          }}
        >
          <Paper elevation={0} sx={panelSx}>
            <Box sx={panelHeaderSx}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="overline" fontWeight={900} color="text.secondary">
                  Template hệ thống
                </Typography>
                <Chip size="small" label={library.length} variant="outlined" />
              </Stack>
            </Box>
            <Box sx={panelBodySx}>
              {usingLocalLibrary && (loadingLibrary || libraryError) ? (
                <Alert severity={libraryError ? "warning" : "info"} sx={{ mb: 1.25 }}>
                  Đang dùng template mẫu cục bộ. Nếu không lưu được, hãy khởi động lại backend.
                </Alert>
              ) : null}
              <Stack spacing={0.9}>
                {library.map((template) => {
                  const templateId = template.id || template.key;
                  const active = selectedTemplateId === templateId;
                  return (
                    <Button
                      key={templateId}
                      variant="text"
                      onClick={() => applyTemplate(template, false)}
                      sx={templateButtonSx(active)}
                    >
                      <Stack spacing={0.35} sx={{ width: "100%", minWidth: 0 }}>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                          justifyContent="space-between"
                          sx={{ minWidth: 0 }}
                        >
                          <Typography
                            variant="body2"
                            fontWeight={800}
                            noWrap
                            sx={{ minWidth: 0 }}
                          >
                            {template.name}
                          </Typography>
                          {active ? (
                            <Chip size="small" color="primary" label="Chọn" />
                          ) : null}
                        </Stack>
                        {template.description ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ whiteSpace: "normal" }}
                          >
                            {template.description}
                          </Typography>
                        ) : null}
                      </Stack>
                    </Button>
                  );
                })}
              </Stack>

              <Divider sx={{ my: 1.5 }} />

              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="overline" fontWeight={900} color="text.secondary">
                  Bản đã lưu
                </Typography>
                <Chip size="small" label={savedTemplates.length} variant="outlined" />
              </Stack>
              <Stack spacing={0.9} sx={{ mt: 0.75 }}>
                {loadingSaved ? (
                  <Typography variant="body2" color="text.secondary">
                    Đang tải bản đã lưu...
                  </Typography>
                ) : savedTemplates.length ? (
                  savedTemplates.map((template) => {
                    const active = savedTemplateId === template.id;
                    return (
                      <Button
                        key={template.id}
                        variant="text"
                        onClick={() => applyTemplate(template, true)}
                        sx={templateButtonSx(active)}
                      >
                        <Stack
                          direction="row"
                          spacing={0.75}
                          alignItems="center"
                          justifyContent="space-between"
                          sx={{ width: "100%", minWidth: 0 }}
                        >
                          <Typography variant="body2" fontWeight={800} noWrap>
                            {template.name}
                          </Typography>
                          {template.status === "published" ? (
                            <Chip size="small" label="Live" color="success" />
                          ) : null}
                        </Stack>
                      </Button>
                    );
                  })
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có draft nào.
                  </Typography>
                )}
              </Stack>
            </Box>
          </Paper>

          <Paper elevation={0} sx={(theme) => ({ ...panelSx(theme), minWidth: 0 })}>
            <Box sx={panelHeaderSx}>
              <Stack
                direction={{ xs: "column", md: "row" }}
                spacing={1}
                alignItems={{ xs: "stretch", md: "center" }}
                justifyContent="space-between"
              >
                <TextField
                  size="small"
                  label="Tên template"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  sx={{ minWidth: { xs: "100%", md: 340 }, flex: 1 }}
                />
                <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("teamA.name")}
                  >
                    Text
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("scoreA")}
                  >
                    Điểm
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("rect")}
                  >
                    Nền
                  </Button>
                </Stack>
              </Stack>
            </Box>

            <Box
              sx={(theme) => ({
                p: { xs: 1, md: 2 },
                minHeight: { xs: 320, lg: "calc(100vh - 164px)" },
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: theme.palette.mode === "dark" ? "#090d15" : "#e9edf5",
              })}
            >
              <Box
                ref={canvasWrapRef}
                onPointerDown={() => setSelectedLayerId("")}
                sx={(theme) => ({
                  ...canvasSurfaceSx,
                  position: "relative",
                  width: "100%",
                  maxWidth: 1280,
                  aspectRatio: `${canvas.width} / ${canvas.height}`,
                  border: `1px solid ${alpha(theme.palette.common.white, 0.14)}`,
                  borderRadius: 1.5,
                  overflow: "hidden",
                  boxShadow:
                    theme.palette.mode === "dark"
                      ? `0 24px 72px ${alpha(theme.palette.common.black, 0.48)}`
                      : `0 18px 48px ${alpha(theme.palette.common.black, 0.16)}`,
                })}
              >
                {hasLayers ? (
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
                    style={canvasSurfaceSx}
                  />
                ) : (
                  <Box
                    sx={{
                      position: "absolute",
                      inset: 0,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      p: 3,
                      textAlign: "center",
                      color: "rgba(255,255,255,0.82)",
                    }}
                  >
                    <Typography variant="body2">Chưa có layer trong template này.</Typography>
                  </Box>
                )}
              </Box>
            </Box>
          </Paper>

          <Paper elevation={0} sx={panelSx}>
            <Box sx={panelHeaderSx}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="overline" fontWeight={900} color="text.secondary">
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
            </Box>

            <Box
              sx={{
                ...panelBodySx,
                maxHeight: { lg: "calc(100vh - 112px)" },
                overflowY: "auto",
              }}
            >
              <Stack spacing={0.75}>
                {document.layers.map((layer) => {
                  const active = selectedLayerId === layer.id;
                  return (
                    <Button
                      key={layer.id}
                      variant="text"
                      size="small"
                      onClick={() => setSelectedLayerId(layer.id)}
                      sx={layerButtonSx(active)}
                    >
                      <Typography variant="body2" fontWeight={800} noWrap>
                        {layer.label || layer.id}
                      </Typography>
                      <Chip
                        size="small"
                        label={layer.type === "rect" ? "Nền" : "Text"}
                        variant="outlined"
                      />
                    </Button>
                  );
                })}
              </Stack>

              <Divider sx={{ my: 1.5 }} />

              <Typography
                variant="overline"
                fontWeight={900}
                color="text.secondary"
                sx={{ display: "block", mb: 1 }}
              >
                Thuộc tính
              </Typography>

              {selectedLayer ? (
                <Stack spacing={1.15}>
                  <TextField
                    size="small"
                    label="Tên layer"
                    value={selectedLayer.label || ""}
                    onChange={(event) =>
                      patchSelectedLayer({ label: event.target.value })
                    }
                    fullWidth
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
                      fullWidth
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
                      label="Text dự phòng"
                      value={selectedLayer.text || ""}
                      onChange={(event) =>
                        patchSelectedLayer({ text: event.target.value })
                      }
                      fullWidth
                    />
                  ) : null}
                  <Box sx={fieldGridSx}>
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
                    <Box sx={fieldGridSx}>
                      <TextField
                        size="small"
                        type="number"
                        label="Cỡ chữ"
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
                        label="Độ đậm"
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
                    fullWidth
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
                    fullWidth
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
                    fullWidth
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
                    fullWidth
                  >
                    <MenuItem value="left">Trái</MenuItem>
                    <MenuItem value="center">Giữa</MenuItem>
                    <MenuItem value="right">Phải</MenuItem>
                  </TextField>
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Chưa chọn layer.
                </Typography>
              )}
            </Box>
          </Paper>
        </Box>
      </Stack>
    </Box>
  );
}
