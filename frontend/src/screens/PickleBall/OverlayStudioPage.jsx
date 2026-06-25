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
  Menu,
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

const SNAP_THRESHOLD_PX = 8;
const EMPTY_SNAP_GUIDES = { vertical: [], horizontal: [] };
const MIN_LAYER_SIZE = 16;
const EDITOR_CHROME_Z_INDEX = 10000;
const RESIZE_HANDLES = [
  { key: "nw", cursor: "nwse-resize", left: "0%", top: "0%" },
  { key: "n", cursor: "ns-resize", left: "50%", top: "0%" },
  { key: "ne", cursor: "nesw-resize", left: "100%", top: "0%" },
  { key: "e", cursor: "ew-resize", left: "100%", top: "50%" },
  { key: "se", cursor: "nwse-resize", left: "100%", top: "100%" },
  { key: "s", cursor: "ns-resize", left: "50%", top: "100%" },
  { key: "sw", cursor: "nesw-resize", left: "0%", top: "100%" },
  { key: "w", cursor: "ew-resize", left: "0%", top: "50%" },
];
const OVERLAY_FONT_OPTIONS = [
  { label: "Montserrat", value: "Montserrat Variable, Montserrat, Arial, sans-serif" },
  { label: "Inter", value: "Inter, Segoe UI, Arial, sans-serif" },
  { label: "Segoe UI", value: "Segoe UI, Arial, sans-serif" },
  { label: "Aptos", value: "Aptos, Segoe UI, Arial, sans-serif" },
  { label: "Aptos Display", value: "Aptos Display, Aptos, Segoe UI, Arial, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Roboto", value: "Roboto, Arial, sans-serif" },
  { label: "Open Sans", value: "Open Sans, Arial, sans-serif" },
  { label: "Poppins", value: "Poppins, Arial, sans-serif" },
  { label: "Nunito", value: "Nunito, Arial, sans-serif" },
  { label: "Lato", value: "Lato, Arial, sans-serif" },
  { label: "Raleway", value: "Raleway, Arial, sans-serif" },
  { label: "Manrope", value: "Manrope, Arial, sans-serif" },
  { label: "DM Sans", value: "DM Sans, Arial, sans-serif" },
  { label: "IBM Plex Sans", value: "IBM Plex Sans, Arial, sans-serif" },
  { label: "Noto Sans", value: "Noto Sans, Arial, sans-serif" },
  { label: "Be Vietnam Pro", value: "Be Vietnam Pro, Arial, sans-serif" },
  { label: "SVN-Gilroy", value: "SVN-Gilroy, Arial, sans-serif" },
  { label: "Tahoma", value: "Tahoma, Arial, sans-serif" },
  { label: "Verdana", value: "Verdana, Arial, sans-serif" },
  { label: "Trebuchet MS", value: "Trebuchet MS, Arial, sans-serif" },
  { label: "Calibri", value: "Calibri, Arial, sans-serif" },
  { label: "Bahnschrift", value: "Bahnschrift, Arial, sans-serif" },
  { label: "Candara", value: "Candara, Arial, sans-serif" },
  { label: "Corbel", value: "Corbel, Arial, sans-serif" },
  { label: "Century Gothic", value: "Century Gothic, Arial, sans-serif" },
  { label: "Gill Sans", value: "Gill Sans, Calibri, Arial, sans-serif" },
  { label: "Lucida Sans", value: "Lucida Sans Unicode, Lucida Grande, Arial, sans-serif" },
  { label: "Microsoft Sans Serif", value: "Microsoft Sans Serif, Arial, sans-serif" },
  { label: "Franklin Gothic", value: "Franklin Gothic Medium, Arial, sans-serif" },
  { label: "Impact", value: "Impact, Haettenschweiler, Arial Narrow Bold, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Cambria", value: "Cambria, Georgia, serif" },
  { label: "Palatino", value: "Palatino Linotype, Palatino, serif" },
  { label: "Times New Roman", value: "Times New Roman, Times, serif" },
  { label: "Courier New", value: "Courier New, Courier, monospace" },
  { label: "Consolas", value: "Consolas, monospace" },
  { label: "Source Code Pro", value: "Source Code Pro, Consolas, monospace" },
];
const DEFAULT_TEXT_FONT = OVERLAY_FONT_OPTIONS[0].value;
const normalizeFontFamilyValue = (value) =>
  String(value || DEFAULT_TEXT_FONT)
    .replace(/["']/g, "")
    .replace(/\s+/g, " ")
    .trim();
const clampLayerZIndex = (value) =>
  Math.min(1000, Math.max(-100, Math.round(numberOr(value, 0))));
const isEditableEventTarget = (target) => {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="spinbutton"]',
    ),
  );
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
  "serve.count": 1,
};

const numberOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const layerBounds = (layer) => {
  const x = numberOr(layer?.x, 0);
  const y = numberOr(layer?.y, 0);
  const width = Math.max(1, numberOr(layer?.width, 1));
  const height = Math.max(1, numberOr(layer?.height, 1));

  return {
    x,
    y,
    width,
    height,
    right: x + width,
    bottom: y + height,
    centerX: x + width / 2,
    centerY: y + height / 2,
  };
};

const makeSnapTargets = (layers, activeLayerIds, canvas) => {
  const activeIds = new Set(
    Array.isArray(activeLayerIds) ? activeLayerIds : [activeLayerIds],
  );
  const vertical = [0, canvas.width / 2, canvas.width];
  const horizontal = [0, canvas.height / 2, canvas.height];

  (layers || []).forEach((layer) => {
    if (!layer || activeIds.has(layer.id) || layer.visible === false) return;
    const bounds = layerBounds(layer);
    vertical.push(bounds.x, bounds.centerX, bounds.right);
    horizontal.push(bounds.y, bounds.centerY, bounds.bottom);
  });

  return {
    vertical,
    horizontal,
  };
};

const findSnap = (position, size, targets, threshold) => {
  const points = [
    { value: position, offset: 0 },
    { value: position + size / 2, offset: size / 2 },
    { value: position + size, offset: size },
  ];
  let best = null;

  points.forEach((point) => {
    targets.forEach((target) => {
      const distance = Math.abs(point.value - target);
      if (distance > threshold) return;
      if (best && distance >= best.distance) return;
      best = {
        distance,
        guide: target,
        position: target - point.offset,
      };
    });
  });

  return best;
};

const snapLayerPosition = ({
  x,
  y,
  width,
  height,
  targets,
  thresholdX,
  thresholdY,
}) => {
  const snapX = findSnap(x, width, targets.vertical, thresholdX);
  const snapY = findSnap(y, height, targets.horizontal, thresholdY);

  return {
    x: Math.round(snapX ? snapX.position : x),
    y: Math.round(snapY ? snapY.position : y),
    guides: {
      vertical: snapX ? [snapX.guide] : [],
      horizontal: snapY ? [snapY.guide] : [],
    },
  };
};

const getSelectionBounds = (layers) => {
  if (!layers.length) return null;
  const bounds = layers.map(layerBounds);
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.right));
  const bottom = Math.max(...bounds.map((item) => item.bottom));

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    right,
    bottom,
    centerX: x + (right - x) / 2,
    centerY: y + (bottom - y) / 2,
  };
};

const resizeBounds = (bounds, handle, dx, dy) => {
  let x = bounds.x;
  let y = bounds.y;
  let right = bounds.right;
  let bottom = bounds.bottom;

  if (handle.includes("w")) x += dx;
  if (handle.includes("e")) right += dx;
  if (handle.includes("n")) y += dy;
  if (handle.includes("s")) bottom += dy;

  if (right - x < MIN_LAYER_SIZE) {
    if (handle.includes("w")) x = right - MIN_LAYER_SIZE;
    else right = x + MIN_LAYER_SIZE;
  }

  if (bottom - y < MIN_LAYER_SIZE) {
    if (handle.includes("n")) y = bottom - MIN_LAYER_SIZE;
    else bottom = y + MIN_LAYER_SIZE;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    right,
    bottom,
  };
};

const resizeLayerFromGroup = (layer, startGroupBounds, nextGroupBounds) => {
  const bounds = layerBounds(layer);
  const scaleX = nextGroupBounds.width / Math.max(1, startGroupBounds.width);
  const scaleY = nextGroupBounds.height / Math.max(1, startGroupBounds.height);

  return {
    ...layer,
    x: Math.round(nextGroupBounds.x + (bounds.x - startGroupBounds.x) * scaleX),
    y: Math.round(nextGroupBounds.y + (bounds.y - startGroupBounds.y) * scaleY),
    width: Math.max(MIN_LAYER_SIZE, Math.round(bounds.width * scaleX)),
    height: Math.max(MIN_LAYER_SIZE, Math.round(bounds.height * scaleY)),
  };
};

const cloneDocument = (document) => ({
  background: document?.background || "transparent",
  layers: Array.isArray(document?.layers)
    ? document.layers.map((layer) => ({
        ...layer,
        style: { ...(layer.style || {}) },
        visibleWhen: layer.visibleWhen ? { ...layer.visibleWhen } : undefined,
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
      fontFamily: DEFAULT_TEXT_FONT,
      fontSize: 42,
      fontWeight: 800,
      color: "#ffffff",
      background: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      borderRadius: 0,
      textAlign: "left",
      lineHeight: 1.18,
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

function makeShapeLayer() {
  return {
    id: makeLayerId("shape"),
    type: "rect",
    label: "Shape",
    binding: "static",
    text: "",
    x: 180,
    y: 180,
    width: 280,
    height: 160,
    zIndex: 5,
    visible: true,
    style: {
      background: "rgba(37,99,235,0.72)",
      borderColor: "rgba(255,255,255,0.22)",
      borderWidth: 1,
      borderRadius: 28,
    },
  };
}

function makeFrameLayer() {
  return {
    id: makeLayerId("frame"),
    type: "rect",
    label: "Khung",
    binding: "static",
    text: "",
    x: 160,
    y: 160,
    width: 540,
    height: 260,
    zIndex: 6,
    visible: true,
    style: {
      background: "transparent",
      borderColor: "rgba(255,255,255,0.9)",
      borderWidth: 5,
      borderRadius: 26,
    },
  };
}

function makeImageLayer() {
  return {
    id: makeLayerId("image"),
    type: "image",
    label: "Ảnh",
    binding: "static",
    text: "",
    src: "",
    x: 180,
    y: 180,
    width: 360,
    height: 220,
    zIndex: 15,
    visible: true,
    style: {
      background: "rgba(15,23,42,0.42)",
      borderColor: "rgba(255,255,255,0.24)",
      borderWidth: 1,
      borderRadius: 18,
    },
  };
}

function makeServeIndicatorLayer(side = "A") {
  const normalizedSide = String(side).toUpperCase() === "B" ? "B" : "A";
  return {
    id: makeLayerId(`serve_${normalizedSide.toLowerCase()}`),
    type: "serveIndicator",
    label: `Bóng giao ${normalizedSide}`,
    binding: "serve.side",
    text: "",
    x: normalizedSide === "A" ? 650 : 650,
    y: normalizedSide === "A" ? 140 : 204,
    width: 30,
    height: 30,
    zIndex: 30,
    visible: true,
    visibleWhen: { binding: "serve.side", equals: normalizedSide },
    style: {
      color: "#22c55e",
      background: "transparent",
      borderColor: "transparent",
      borderWidth: 0,
      borderRadius: 999,
    },
  };
}

function getLayer(document, selectedLayerId) {
  return (document?.layers || []).find((layer) => layer.id === selectedLayerId);
}

function layerTypeLabel(layer) {
  if (layer?.type === "serveIndicator") return "Bóng giao";
  if (layer?.type === "image") return "Ảnh";
  if (layer?.type !== "rect") return "Text";
  const label = String(layer?.label || "").toLowerCase();
  if (label.includes("khung")) return "Khung";
  if (label.includes("nền")) return "Nền";
  return "Shape";
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
  const [selectedLayerIds, setSelectedLayerIds] = useState([]);
  const [layerMenu, setLayerMenu] = useState(null);
  const [snapGuides, setSnapGuides] = useState(EMPTY_SNAP_GUIDES);
  const selectedLayerIdsRef = useRef([]);

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
  const selectedLayers = useMemo(
    () =>
      document.layers.filter((layer) => selectedLayerIds.includes(layer.id)),
    [document.layers, selectedLayerIds],
  );
  const selectedBounds = useMemo(
    () => getSelectionBounds(selectedLayers),
    [selectedLayers],
  );

  const setSingleSelection = (layerId) => {
    const next = layerId ? [layerId] : [];
    selectedLayerIdsRef.current = next;
    setSelectedLayerId(layerId || "");
    setSelectedLayerIds(next);
  };

  const toggleLayerSelection = (layerId) => {
    setSelectedLayerIds((prev) => {
      const exists = prev.includes(layerId);
      const next = exists
        ? prev.filter((id) => id !== layerId)
        : [...prev, layerId];
      selectedLayerIdsRef.current = next;
      setSelectedLayerId(next[next.length - 1] || "");
      return next;
    });
  };

  useEffect(() => {
    selectedLayerIdsRef.current = selectedLayerIds;
  }, [selectedLayerIds]);

  const getTargetLayerIds = (layerIds) => {
    const source = Array.isArray(layerIds) ? layerIds : selectedLayerIdsRef.current;
    return Array.from(new Set(source.filter(Boolean)));
  };

  const selectLayerForEvent = (layerId, event) => {
    if (event?.shiftKey || event?.ctrlKey || event?.metaKey) {
      toggleLayerSelection(layerId);
      return;
    }
    setSingleSelection(layerId);
  };

  useEffect(() => {
    if (document.layers.length || !library.length) return;
    const first = library[0];
    setSelectedTemplateId(first.id || first.key);
    setSavedTemplateId("");
    setName(first.name || "Overlay template");
    setCanvas(first.canvas || DEFAULT_CANVAS);
    setDocument(cloneDocument(first.document));
    setSingleSelection(first.document?.layers?.[0]?.id || "");
  }, [document.layers.length, library]);

  const applyTemplate = (template, saved = false) => {
    setSelectedTemplateId(template.id || template.key || "");
    setSavedTemplateId(saved ? template.id : "");
    setName(template.name || "Overlay template");
    setCanvas(template.canvas || DEFAULT_CANVAS);
    const nextDocument = cloneDocument(template.document);
    setDocument(nextDocument);
    setSingleSelection(nextDocument.layers?.[0]?.id || "");
    setSnapGuides(EMPTY_SNAP_GUIDES);
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

  const patchSelectedLayers = (patcher, layerIds) => {
    const targetLayerIds = getTargetLayerIds(layerIds);
    if (!targetLayerIds.length) return;
    const selectedIdSet = new Set(targetLayerIds);
    patchDocument((draft) => ({
      ...draft,
      layers: draft.layers.map((layer) => {
        if (!selectedIdSet.has(layer.id)) return layer;
        const patch =
          typeof patcher === "function" ? patcher(layer, draft.layers) : patcher || {};
        return {
          ...layer,
          ...patch,
          style: { ...(layer.style || {}), ...(patch.style || {}) },
        };
      }),
    }));
  };

  const addLayer = (kind) => {
    if (kind === "serve") {
      const layers = [makeServeIndicatorLayer("A"), makeServeIndicatorLayer("B")];
      patchDocument((draft) => ({
        ...draft,
        layers: [...draft.layers, ...layers],
      }));
      const nextLayerIds = layers.map((layer) => layer.id);
      selectedLayerIdsRef.current = nextLayerIds;
      setSelectedLayerIds(nextLayerIds);
      setSelectedLayerId(layers[layers.length - 1]?.id || "");
      return;
    }

    const layer =
      kind === "rect"
        ? makeRectLayer()
        : kind === "shape"
          ? makeShapeLayer()
          : kind === "frame"
            ? makeFrameLayer()
            : kind === "image"
              ? makeImageLayer()
              : makeTextLayer(kind, kind === "scoreA" ? "Điểm A" : "Text");
    patchDocument((draft) => ({
      ...draft,
      layers: [...draft.layers, layer],
    }));
    setSingleSelection(layer.id);
  };

  const duplicateSelectedLayer = (layerIds) => {
    const targetLayerIds = getTargetLayerIds(layerIds);
    const targetIdSet = new Set(targetLayerIds);
    const sourceLayers = document.layers.filter((layer) => targetIdSet.has(layer.id));
    if (!sourceLayers.length) return;
    const copies = sourceLayers.map((layer) => ({
      ...layer,
      id: makeLayerId(layer.type || "layer"),
      label: `${layer.label || "Layer"} copy`,
      x: numberOr(layer.x, 0) + 32,
      y: numberOr(layer.y, 0) + 32,
      zIndex: numberOr(layer.zIndex, 0) + 1,
      style: { ...(layer.style || {}) },
      visibleWhen: layer.visibleWhen ? { ...layer.visibleWhen } : undefined,
    }));
    patchDocument((draft) => ({ ...draft, layers: [...draft.layers, ...copies] }));
    const nextLayerIds = copies.map((layer) => layer.id);
    selectedLayerIdsRef.current = nextLayerIds;
    setSelectedLayerIds(nextLayerIds);
    setSelectedLayerId(copies[copies.length - 1]?.id || "");
  };

  const deleteSelectedLayer = (layerIds) => {
    const targetLayerIds = getTargetLayerIds(layerIds);
    if (!targetLayerIds.length) return;
    const selectedIdSet = new Set(targetLayerIds);
    patchDocument((draft) => ({
      ...draft,
      layers: draft.layers.filter((layer) => !selectedIdSet.has(layer.id)),
    }));
    setSingleSelection("");
  };

  const shiftSelectedZIndex = (delta, layerIds) => {
    patchSelectedLayers((layer) => ({
      zIndex: clampLayerZIndex(numberOr(layer.zIndex, 0) + delta),
    }), layerIds);
  };

  const bringSelectedToFront = (layerIds) => {
    const targetLayerIds = getTargetLayerIds(layerIds);
    const maxZ = document.layers.reduce(
      (max, layer) => Math.max(max, numberOr(layer.zIndex, 0)),
      0,
    );
    patchSelectedLayers((layer) => ({
      zIndex: clampLayerZIndex(maxZ + targetLayerIds.indexOf(layer.id) + 1),
    }), targetLayerIds);
  };

  const sendSelectedToBack = (layerIds) => {
    const targetLayerIds = getTargetLayerIds(layerIds);
    const minZ = document.layers.reduce(
      (min, layer) => Math.min(min, numberOr(layer.zIndex, 0)),
      0,
    );
    patchSelectedLayers((layer) => ({
      zIndex: clampLayerZIndex(minZ - targetLayerIds.length + targetLayerIds.indexOf(layer.id)),
    }), targetLayerIds);
  };

  const openLayerContextMenu = (event, layerId) => {
    event.preventDefault();
    event.stopPropagation();
    const currentLayerIds = selectedLayerIdsRef.current;
    const nextLayerIds = currentLayerIds.includes(layerId)
      ? currentLayerIds
      : [layerId];
    if (currentLayerIds.includes(layerId)) {
      setSelectedLayerId(layerId);
    } else {
      setSingleSelection(layerId);
    }
    setLayerMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      layerIds: nextLayerIds,
    });
  };

  const closeLayerContextMenu = () => {
    setLayerMenu(null);
  };

  const runLayerMenuAction = (action) => {
    const targetLayerIds = getTargetLayerIds(layerMenu?.layerIds);
    closeLayerContextMenu();
    action(targetLayerIds);
  };

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented) return;
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (isEditableEventTarget(event.target)) return;
      const targetLayerIds = getTargetLayerIds();
      if (!targetLayerIds.length) return;

      event.preventDefault();
      deleteSelectedLayer(targetLayerIds);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [deleteSelectedLayer, getTargetLayerIds]);

  const startGroupDrag = (event, dragLayerIds) => {
    const dragIds = Array.from(new Set(dragLayerIds || []));
    if (!dragIds.length) return;

    event.preventDefault();
    event.stopPropagation();

    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    const dragIdSet = new Set(dragIds);
    const dragLayers = document.layers.filter(
      (item) => dragIdSet.has(item.id) && !item.locked,
    );
    const groupBounds = getSelectionBounds(dragLayers);
    if (!groupBounds) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startLayers = new Map(
      dragLayers.map((item) => [item.id, layerBounds(item)]),
    );
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const thresholdX = SNAP_THRESHOLD_PX * scaleX;
    const thresholdY = SNAP_THRESHOLD_PX * scaleY;
    const snapTargets = makeSnapTargets(
      document.layers,
      dragLayers.map((item) => item.id),
      canvas,
    );

    const move = (moveEvent) => {
      const nextX = Math.round(
        groupBounds.x + (moveEvent.clientX - startX) * scaleX,
      );
      const nextY = Math.round(
        groupBounds.y + (moveEvent.clientY - startY) * scaleY,
      );
      const snapped = snapLayerPosition({
        x: nextX,
        y: nextY,
        width: groupBounds.width,
        height: groupBounds.height,
        targets: snapTargets,
        thresholdX,
        thresholdY,
      });
      const dx = snapped.x - groupBounds.x;
      const dy = snapped.y - groupBounds.y;
      setSnapGuides(snapped.guides);
      patchDocument((draft) => ({
        ...draft,
        layers: draft.layers.map((item) => {
          const start = startLayers.get(item.id);
          if (!start) return item;
          return {
            ...item,
            x: Math.round(start.x + dx),
            y: Math.round(start.y + dy),
          };
        }),
      }));
    };

    const up = () => {
      setSnapGuides(EMPTY_SNAP_GUIDES);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const handleLayerPointerDown = (event, layer) => {
    if (!layer || layer.locked) return;

    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      toggleLayerSelection(layer.id);
      return;
    }

    const dragLayerIds = selectedLayerIds.includes(layer.id)
      ? selectedLayerIds
      : [layer.id];
    if (!selectedLayerIds.includes(layer.id)) {
      setSingleSelection(layer.id);
    } else {
      setSelectedLayerId(layer.id);
    }

    startGroupDrag(event, dragLayerIds);
  };

  const handleSelectionMovePointerDown = (event) => {
    if (!selectedLayerIds.length) return;
    startGroupDrag(event, selectedLayerIds);
  };

  const handleSelectionResizePointerDown = (event, handle) => {
    if (!selectedBounds || !selectedLayers.length) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = canvasWrapRef.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startBounds = { ...selectedBounds };
    const startLayers = new Map(
      selectedLayers.map((layer) => [layer.id, { ...layer, style: { ...(layer.style || {}) } }]),
    );
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - startX) * scaleX;
      const dy = (moveEvent.clientY - startY) * scaleY;
      const nextBounds = resizeBounds(startBounds, handle, dx, dy);

      patchDocument((draft) => ({
        ...draft,
        layers: draft.layers.map((item) => {
          const startLayer = startLayers.get(item.id);
          if (!startLayer) return item;
          return resizeLayerFromGroup(startLayer, startBounds, nextBounds);
        }),
      }));
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
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
  const selectedLayerIsText =
    selectedLayer &&
    selectedLayer.type !== "rect" &&
    selectedLayer.type !== "image" &&
    selectedLayer.type !== "serveIndicator";
  const selectedLayerUsesColor =
    selectedLayer &&
    selectedLayer.type !== "rect" &&
    selectedLayer.type !== "image";
  const hasGroupSelection = selectedLayerIds.length > 1;
  const selectedFontFamily = selectedLayerIsText
    ? normalizeFontFamilyValue(selectedLayer.style?.fontFamily)
    : DEFAULT_TEXT_FONT;
  const selectedFontFamilyKnown = OVERLAY_FONT_OPTIONS.some(
    (option) => option.value === selectedFontFamily,
  );

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
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("shape")}
                  >
                    Shape
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("frame")}
                  >
                    Khung
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("image")}
                  >
                    Ảnh
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AddIcon />}
                    onClick={() => addLayer("serve")}
                  >
                    Bóng giao
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
                onPointerDown={() => setSingleSelection("")}
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
                    onLayerClick={(event) => {
                      event.stopPropagation();
                    }}
                    onLayerContextMenu={(event, layer) =>
                      openLayerContextMenu(event, layer.id)
                    }
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
                {selectedBounds ? (
                  <Box
                    data-selection-bounds=""
                    onPointerDown={
                      hasGroupSelection ? handleSelectionMovePointerDown : undefined
                    }
                    sx={{
                      position: "absolute",
                      left: `${(selectedBounds.x / canvas.width) * 100}%`,
                      top: `${(selectedBounds.y / canvas.height) * 100}%`,
                      width: `${(selectedBounds.width / canvas.width) * 100}%`,
                      height: `${(selectedBounds.height / canvas.height) * 100}%`,
                      border: "1px solid #38bdf8",
                      boxShadow: "0 0 0 1px rgba(56,189,248,0.22)",
                      cursor: hasGroupSelection ? "move" : "default",
                      pointerEvents: hasGroupSelection ? "auto" : "none",
                      zIndex: EDITOR_CHROME_Z_INDEX,
                      bgcolor: hasGroupSelection
                        ? "rgba(56,189,248,0.035)"
                        : "transparent",
                    }}
                  >
                    {RESIZE_HANDLES.map((handle) => (
                      <Box
                        key={handle.key}
                        data-resize-handle={handle.key}
                        onPointerDown={(event) =>
                          handleSelectionResizePointerDown(event, handle.key)
                        }
                        sx={{
                          position: "absolute",
                          left: handle.left,
                          top: handle.top,
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          border: "2px solid #07111f",
                          bgcolor: "#38bdf8",
                          transform: "translate(-50%, -50%)",
                          cursor: handle.cursor,
                          pointerEvents: "auto",
                          zIndex: EDITOR_CHROME_Z_INDEX + 1,
                        }}
                      />
                    ))}
                  </Box>
                ) : null}
                {snapGuides.vertical.map((guide) => (
                  <Box
                    key={`snap-v-${guide}`}
                    sx={{
                      position: "absolute",
                      top: 0,
                      bottom: 0,
                      left: `${(guide / canvas.width) * 100}%`,
                      width: 2,
                      transform: "translateX(-1px)",
                      bgcolor: "#38bdf8",
                      boxShadow: "0 0 0 1px rgba(56,189,248,0.24)",
                      pointerEvents: "none",
                      zIndex: EDITOR_CHROME_Z_INDEX + 2,
                    }}
                  />
                ))}
                {snapGuides.horizontal.map((guide) => (
                  <Box
                    key={`snap-h-${guide}`}
                    sx={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: `${(guide / canvas.height) * 100}%`,
                      height: 2,
                      transform: "translateY(-1px)",
                      bgcolor: "#38bdf8",
                      boxShadow: "0 0 0 1px rgba(56,189,248,0.24)",
                      pointerEvents: "none",
                      zIndex: EDITOR_CHROME_Z_INDEX + 2,
                    }}
                  />
                ))}
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
                        disabled={!selectedLayerIds.length}
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
                        disabled={!selectedLayerIds.length}
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
                  const active = selectedLayerIds.includes(layer.id);
                  return (
                    <Button
                      key={layer.id}
                      variant="text"
                      size="small"
                      onClick={(event) => selectLayerForEvent(layer.id, event)}
                      onContextMenu={(event) => openLayerContextMenu(event, layer.id)}
                      sx={layerButtonSx(active)}
                    >
                      <Typography variant="body2" fontWeight={800} noWrap>
                        {layer.label || layer.id}
                      </Typography>
                      <Chip
                        size="small"
                        label={layerTypeLabel(layer)}
                        variant="outlined"
                      />
                    </Button>
                  );
                })}
              </Stack>
              <Menu
                open={Boolean(layerMenu)}
                onClose={closeLayerContextMenu}
                anchorReference="anchorPosition"
                anchorPosition={
                  layerMenu
                    ? { top: layerMenu.mouseY, left: layerMenu.mouseX }
                    : undefined
                }
              >
                <MenuItem onClick={() => runLayerMenuAction(bringSelectedToFront)}>
                  Đưa lên trên cùng
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    runLayerMenuAction((layerIds) => shiftSelectedZIndex(1, layerIds))
                  }
                >
                  Đưa lên 1 lớp
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    runLayerMenuAction((layerIds) => shiftSelectedZIndex(-1, layerIds))
                  }
                >
                  Đưa xuống 1 lớp
                </MenuItem>
                <MenuItem onClick={() => runLayerMenuAction(sendSelectedToBack)}>
                  Đưa xuống dưới cùng
                </MenuItem>
                <Divider />
                <MenuItem onClick={() => runLayerMenuAction(duplicateSelectedLayer)}>
                  Nhân bản
                </MenuItem>
                <MenuItem
                  onClick={() => runLayerMenuAction(deleteSelectedLayer)}
                  sx={{ color: "error.main" }}
                >
                  Xóa
                </MenuItem>
              </Menu>

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
                  {selectedLayerIsText ? (
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
                  {selectedLayerIsText ? (
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
                  {selectedLayer.type === "image" ? (
                    <TextField
                      size="small"
                      label="URL ảnh"
                      value={selectedLayer.src || ""}
                      onChange={(event) =>
                        patchSelectedLayer({ src: event.target.value })
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
                  <Box sx={fieldGridSx}>
                    <TextField
                      size="small"
                      type="number"
                      label="Z-index"
                      value={selectedLayer.zIndex ?? 0}
                      onChange={(event) =>
                        patchSelectedLayer({
                          zIndex: clampLayerZIndex(event.target.value),
                        })
                      }
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Opacity"
                      value={selectedLayer.opacity ?? 1}
                      inputProps={{ step: 0.05, min: 0, max: 1 }}
                      onChange={(event) =>
                        patchSelectedLayer({
                          opacity: Math.min(1, Math.max(0, Number(event.target.value))),
                        })
                      }
                    />
                  </Box>
                  <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedLayerIds.length}
                      onClick={sendSelectedToBack}
                    >
                      Dưới cùng
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedLayerIds.length}
                      onClick={() => shiftSelectedZIndex(-1)}
                    >
                      Xuống
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedLayerIds.length}
                      onClick={() => shiftSelectedZIndex(1)}
                    >
                      Lên
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!selectedLayerIds.length}
                      onClick={bringSelectedToFront}
                    >
                      Trên cùng
                    </Button>
                  </Stack>
                  {selectedLayerIsText ? (
                    <TextField
                      select
                      size="small"
                      label="Font chữ"
                      value={selectedFontFamily}
                      onChange={(event) =>
                        patchSelectedLayer({
                          style: { fontFamily: event.target.value },
                        })
                      }
                      fullWidth
                    >
                      {!selectedFontFamilyKnown ? (
                        <MenuItem
                          value={selectedFontFamily}
                          sx={{ fontFamily: selectedFontFamily }}
                        >
                          Font hiện tại
                        </MenuItem>
                      ) : null}
                      {OVERLAY_FONT_OPTIONS.map((option) => (
                        <MenuItem
                          key={option.value}
                          value={option.value}
                          sx={{ fontFamily: option.value }}
                        >
                          {option.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ) : null}
                  {selectedLayerIsText ? (
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
                      <TextField
                        size="small"
                        type="number"
                        label="Giãn dòng"
                        value={selectedLayer.style?.lineHeight ?? 1.18}
                        inputProps={{ step: 0.02, min: 0.8, max: 2 }}
                        onChange={(event) =>
                          patchSelectedLayer({
                            style: { lineHeight: Number(event.target.value) },
                          })
                        }
                        sx={{ gridColumn: "1 / -1" }}
                      />
                    </Box>
                  ) : null}
                  <TextField
                    size="small"
                    label={selectedLayer.type === "serveIndicator" ? "Màu bóng" : "Màu chữ"}
                    value={selectedLayer.style?.color || "#ffffff"}
                    onChange={(event) =>
                      patchSelectedLayer({ style: { color: event.target.value } })
                    }
                    disabled={!selectedLayerUsesColor}
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
                  <Box sx={fieldGridSx}>
                    <TextField
                      size="small"
                      label="Màu viền"
                      value={selectedLayer.style?.borderColor || "transparent"}
                      onChange={(event) =>
                        patchSelectedLayer({
                          style: { borderColor: event.target.value },
                        })
                      }
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Độ dày viền"
                      value={selectedLayer.style?.borderWidth ?? 0}
                      onChange={(event) =>
                        patchSelectedLayer({
                          style: { borderWidth: Number(event.target.value) },
                        })
                      }
                    />
                  </Box>
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
                    disabled={!selectedLayerIsText}
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
