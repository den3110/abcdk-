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
  Image as ImageIcon,
  OpenInNew as OpenInNewIcon,
  Save as SaveIcon,
  Send as PublishIcon,
  UploadFile as UploadFileIcon,
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

const editorRootSx = (theme) => ({
  minHeight: "100vh",
  bgcolor: theme.palette.mode === "dark" ? "#0b0d12" : "#f4f5f8",
  color: "text.primary",
  overflow: "hidden",
  "& .MuiButton-root": {
    boxShadow: "none",
    letterSpacing: 0,
    fontWeight: 760,
  },
  "& .MuiButton-root:hover": {
    boxShadow: "none",
  },
  "& .MuiChip-root": {
    height: 22,
    borderRadius: 999,
    fontWeight: 760,
  },
  "& .MuiInputBase-root": {
    borderRadius: "8px",
    bgcolor:
      theme.palette.mode === "dark"
        ? alpha("#ffffff", 0.035)
        : alpha("#ffffff", 0.84),
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor:
      theme.palette.mode === "dark"
        ? alpha("#ffffff", 0.1)
        : alpha("#111827", 0.13),
  },
  "& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: alpha(theme.palette.primary.main, 0.55),
  },
  "& .MuiInputLabel-root": {
    fontWeight: 720,
  },
});

const topBarSx = (theme) => ({
  minHeight: 54,
  px: { xs: 1, md: 1.25 },
  py: { xs: 0.75, md: 0 },
  borderRadius: 0,
  borderBottom: `1px solid ${
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1)
  }`,
  bgcolor:
    theme.palette.mode === "dark"
      ? "#10131a"
      : alpha(theme.palette.background.paper, 0.98),
  display: "flex",
  alignItems: "center",
});

const panelSx = (theme) => ({
  borderRadius: 0,
  border: 0,
  bgcolor:
    theme.palette.mode === "dark"
      ? "#10131a"
      : alpha(theme.palette.background.paper, 0.98),
  overflow: "hidden",
  minHeight: 0,
});

const panelHeaderSx = {
  px: 1.2,
  py: 0.8,
  minHeight: 40,
  borderBottom: "1px solid",
  borderColor: (theme) =>
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1),
};

const panelBodySx = {
  p: 0.85,
};

const workspaceSx = {
  display: "grid",
  gridTemplateColumns: { xs: "1fr", lg: "304px minmax(0, 1fr) 352px" },
  height: { xs: "auto", lg: "calc(100vh - 54px)" },
  minHeight: 0,
};

const leftPanelSx = (theme) => ({
  ...panelSx(theme),
  borderRight: `1px solid ${
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1)
  }`,
});

const rightPanelSx = (theme) => ({
  ...panelSx(theme),
  borderLeft: `1px solid ${
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1)
  }`,
});

const centerPanelSx = (theme) => ({
  minWidth: 0,
  minHeight: 0,
  bgcolor: theme.palette.mode === "dark" ? "#0b0d12" : "#eceef3",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
});

const toolStripSx = (theme) => ({
  px: 1.1,
  py: 0.8,
  borderBottom: `1px solid ${
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1)
  }`,
  bgcolor:
    theme.palette.mode === "dark"
      ? "#10131a"
      : alpha(theme.palette.background.paper, 0.97),
});

const toolbarButtonSx = (theme) => ({
  minWidth: 0,
  borderRadius: 1,
  px: 1.05,
  textTransform: "none",
  border: "1px solid",
  borderColor:
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.11) : alpha("#111827", 0.12),
  bgcolor:
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.035) : alpha("#ffffff", 0.7),
  "&:hover": {
    borderColor: alpha(theme.palette.primary.main, 0.7),
    bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.08),
  },
});

const canvasViewportSx = (theme) => ({
  p: { xs: 1.25, md: 2.75 },
  minHeight: { xs: 360, lg: 0 },
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "auto",
  background:
    theme.palette.mode === "dark"
      ? "radial-gradient(circle at 50% 0%, rgba(59,130,246,0.08), transparent 34%), #0b0d12"
      : "radial-gradient(circle at 50% 0%, rgba(37,99,235,0.08), transparent 34%), #e8eaf0",
});

const inspectorGroupSx = (theme) => ({
  border: `1px solid ${
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1)
  }`,
  borderRadius: 1.25,
  p: 1,
  bgcolor:
    theme.palette.mode === "dark"
      ? alpha("#ffffff", 0.025)
      : alpha("#ffffff", 0.78),
});

const imageDropzoneSx = (active) => (theme) => ({
  border: `1px dashed ${
    active ? theme.palette.primary.main : alpha(theme.palette.text.primary, 0.26)
  }`,
  borderRadius: 1,
  p: 1,
  minHeight: 132,
  display: "grid",
  placeItems: "center",
  textAlign: "center",
  color: active ? "primary.main" : "text.secondary",
  bgcolor: active
    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.16 : 0.08)
    : alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.035 : 0.02),
});

const sectionTitleSx = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 1,
  mb: 0.75,
};

const toolClusterSx = (theme) => ({
  display: "flex",
  alignItems: "center",
  gap: 0.75,
  p: 0.35,
  border: `1px solid ${
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.1)
  }`,
  borderRadius: 1.25,
  bgcolor:
    theme.palette.mode === "dark" ? alpha("#ffffff", 0.025) : alpha("#ffffff", 0.62),
});

const templateButtonSx = (active) => (theme) => ({
  width: "100%",
  justifyContent: "flex-start",
  alignItems: "stretch",
  textAlign: "left",
  textTransform: "none",
  borderRadius: 1.1,
  p: 0.9,
  color: "text.primary",
  border: "1px solid transparent",
  bgcolor: active
    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.18 : 0.1)
    : "transparent",
  position: "relative",
  overflow: "hidden",
  "&::before": active
    ? {
        content: '""',
        position: "absolute",
        left: 0,
        top: 8,
        bottom: 8,
        width: 3,
        borderRadius: 999,
        bgcolor: "primary.main",
      }
    : undefined,
  "&:hover": {
    borderColor:
      theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.08),
    bgcolor:
      active
        ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.22 : 0.12)
        : alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.045 : 0.035),
  },
});

const layerButtonSx = (active) => (theme) => ({
  width: "100%",
  justifyContent: "space-between",
  textAlign: "left",
  textTransform: "none",
  borderRadius: 1,
  px: 0.9,
  py: 0.66,
  color: "text.primary",
  border: "1px solid transparent",
  bgcolor: active
    ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.18 : 0.09)
    : "transparent",
  position: "relative",
  overflow: "hidden",
  "&::before": active
    ? {
        content: '""',
        position: "absolute",
        left: 0,
        top: 7,
        bottom: 7,
        width: 3,
        borderRadius: 999,
        bgcolor: "primary.main",
      }
    : undefined,
  "&:hover": {
    borderColor:
      theme.palette.mode === "dark" ? alpha("#ffffff", 0.08) : alpha("#111827", 0.08),
    bgcolor:
      active
        ? alpha(theme.palette.primary.main, theme.palette.mode === "dark" ? 0.22 : 0.11)
        : alpha(theme.palette.text.primary, theme.palette.mode === "dark" ? 0.045 : 0.035),
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
const MAX_IMAGE_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_EMBEDDED_IMAGE_LENGTH = 1900000;
const MAX_EMBEDDED_IMAGE_SIDE = 1600;
const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
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

const basePreviewValues = {
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
  "serve.count": 2,
};

const numberOr = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const isEmbeddedImageSrc = (value) =>
  /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(String(value || ""));

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Không đọc được ảnh"));
    reader.readAsDataURL(file);
  });

const loadImageElement = (src) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Ảnh không hợp lệ"));
    image.src = src;
  });

const compressImageDataUrl = async (src) => {
  const image = await loadImageElement(src);
  const ratio = Math.min(
    1,
    MAX_EMBEDDED_IMAGE_SIDE / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));

  const context = canvas.getContext("2d");
  if (!context) throw new Error("Không xử lý được ảnh");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let quality = 0.88;
  let output = canvas.toDataURL("image/webp", quality);
  while (output.length > MAX_EMBEDDED_IMAGE_LENGTH && quality > 0.56) {
    quality -= 0.08;
    output = canvas.toDataURL("image/webp", quality);
  }
  if (output.length > MAX_EMBEDDED_IMAGE_LENGTH) {
    throw new Error("Ảnh quá lớn, hãy chọn ảnh nhỏ hơn");
  }
  return output;
};

const fileToEmbeddedImageSrc = async (file) => {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error("File được chọn không phải ảnh");
  }
  if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
    throw new Error("Ảnh lớn hơn 8MB");
  }

  const src = await readFileAsDataUrl(file);
  if (src.length <= MAX_EMBEDDED_IMAGE_LENGTH && isEmbeddedImageSrc(src)) {
    return src;
  }
  return compressImageDataUrl(src);
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
  const imageInputRef = useRef(null);
  const imageUploadTargetIdRef = useRef("");
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
  const [imageDropActive, setImageDropActive] = useState(false);
  const [previewServeSide, setPreviewServeSide] = useState("A");
  const [previewServeCount, setPreviewServeCount] = useState(2);
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
  const templatePreviewValues = useMemo(
    () => ({
      ...basePreviewValues,
      "serve.side": previewServeSide,
      "serve.count": previewServeCount,
    }),
    [previewServeCount, previewServeSide],
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

  const patchLayerById = (layerId, patcher) => {
    if (!layerId) return;
    patchDocument((draft) => ({
      ...draft,
      layers: draft.layers.map((layer) => {
        if (layer.id !== layerId) return layer;
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

  const addImageLayer = (openPicker = false) => {
    const layer = makeImageLayer();
    patchDocument((draft) => ({
      ...draft,
      layers: [...draft.layers, layer],
    }));
    setSingleSelection(layer.id);
    if (openPicker) {
      imageUploadTargetIdRef.current = layer.id;
      window.setTimeout(() => imageInputRef.current?.click(), 0);
    }
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
    if (kind === "image") {
      addImageLayer(true);
      return;
    }

    const layer =
      kind === "rect"
        ? makeRectLayer()
        : kind === "shape"
            ? makeShapeLayer()
            : kind === "frame"
              ? makeFrameLayer()
              : makeTextLayer(kind, kind === "scoreA" ? "Điểm A" : "Text");
    patchDocument((draft) => ({
      ...draft,
      layers: [...draft.layers, layer],
    }));
    setSingleSelection(layer.id);
  };

  const applyImageFileToLayer = async (file, layerId) => {
    const targetLayerId = layerId || selectedLayerId;
    if (!targetLayerId) return;
    try {
      const src = await fileToEmbeddedImageSrc(file);
      const rawName = String(file?.name || "Ảnh").replace(/\.[^.]+$/, "");
      patchLayerById(targetLayerId, (layer) => ({
        src,
        label: layer.label && layer.label !== "Ảnh" ? layer.label : rawName,
        style: {
          background: "transparent",
          borderColor: layer.style?.borderColor || "rgba(255,255,255,0.24)",
        },
      }));
      setSingleSelection(targetLayerId);
      toast.success("Đã thêm ảnh vào overlay");
    } catch (error) {
      toast.error(error?.message || "Không thêm được ảnh");
    } finally {
      imageUploadTargetIdRef.current = "";
    }
  };

  const handleImageInputChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    await applyImageFileToLayer(file, imageUploadTargetIdRef.current || selectedLayerId);
  };

  const openImagePicker = (layerId = selectedLayerId) => {
    if (!layerId) return;
    imageUploadTargetIdRef.current = layerId;
    imageInputRef.current?.click();
  };

  const handleImageDrop = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setImageDropActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !selectedLayerId) return;
    await applyImageFileToLayer(file, selectedLayerId);
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
  const selectedLayerIsImage = selectedLayer?.type === "image";
  const selectedImageIsEmbedded = selectedLayerIsImage && isEmbeddedImageSrc(selectedLayer.src);
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
      <input
        ref={imageInputRef}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={handleImageInputChange}
      />
      <Stack spacing={0} sx={{ minHeight: "100vh" }}>
        <Paper elevation={0} sx={topBarSx}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.25}
            alignItems={{ xs: "stretch", md: "center" }}
            justifyContent="space-between"
            sx={{ width: "100%" }}
          >
            <Stack direction="row" spacing={1.25} alignItems="center" minWidth={0}>
              <Box
                sx={(theme) => ({
                  width: 36,
                  height: 36,
                  borderRadius: 1,
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
                <Typography variant="subtitle1" fontWeight={900} lineHeight={1.1}>
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
                  variant="text"
                  startIcon={<OpenInNewIcon />}
                  sx={{ textTransform: "none", borderRadius: 1 }}
                >
                  Preview live
                </Button>
              ) : null}
              <Button
                size="small"
                variant="text"
                startIcon={<SaveIcon />}
                disabled={busy || !tournamentId}
                onClick={saveDraft}
                sx={{ textTransform: "none", borderRadius: 1 }}
              >
                Lưu draft
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<PublishIcon />}
                disabled={busy || !tournamentId}
                onClick={publishCurrent}
                sx={{ textTransform: "none", borderRadius: 1 }}
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
          sx={workspaceSx}
        >
          <Paper elevation={0} sx={leftPanelSx}>
            <Box sx={panelHeaderSx}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="subtitle2" fontWeight={900}>
                  Tài nguyên
                </Typography>
                <Chip size="small" label={library.length} variant="outlined" />
              </Stack>
            </Box>
            <Box
              sx={{
                ...panelBodySx,
                height: { lg: "calc(100vh - 98px)" },
                overflowY: "auto",
              }}
            >
              {usingLocalLibrary && (loadingLibrary || libraryError) ? (
                <Alert severity={libraryError ? "warning" : "info"} sx={{ mb: 1.25 }}>
                  Đang dùng template mẫu cục bộ. Nếu không lưu được, hãy khởi động lại backend.
                </Alert>
              ) : null}
              <Box sx={sectionTitleSx}>
                <Typography variant="caption" fontWeight={900} color="text.secondary">
                  Template hệ thống
                </Typography>
                <Chip size="small" label={library.length} variant="outlined" />
              </Box>
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

              <Box sx={sectionTitleSx}>
                <Typography variant="caption" fontWeight={900} color="text.secondary">
                  Bản đã lưu
                </Typography>
                <Chip size="small" label={savedTemplates.length} variant="outlined" />
              </Box>
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

              <Divider sx={{ my: 1.5 }} />

              <Box sx={sectionTitleSx}>
                <Typography variant="caption" fontWeight={900} color="text.secondary">
                  Layers
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
              </Box>
              <Stack spacing={0.65} sx={{ mt: 0.75 }}>
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
            </Box>
          </Paper>

          <Paper elevation={0} sx={centerPanelSx}>
            <Box sx={toolStripSx}>
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
                  sx={{ minWidth: { xs: "100%", md: 280 }, maxWidth: { md: 420 }, flex: 1 }}
                />
                <Stack direction="row" spacing={0.75} sx={toolClusterSx}>
                  <TextField
                    select
                    size="small"
                    label="Đội giao"
                    value={previewServeSide}
                    onChange={(event) =>
                      setPreviewServeSide(event.target.value === "B" ? "B" : "A")
                    }
                    sx={{ width: 104 }}
                  >
                    <MenuItem value="A">A</MenuItem>
                    <MenuItem value="B">B</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Bóng"
                    value={previewServeCount}
                    onChange={(event) =>
                      setPreviewServeCount(Number(event.target.value) === 2 ? 2 : 1)
                    }
                    sx={{ width: 88 }}
                  >
                    <MenuItem value={1}>1</MenuItem>
                    <MenuItem value={2}>2</MenuItem>
                  </TextField>
                </Stack>
                <Stack direction="row" spacing={0.45} flexWrap="wrap" useFlexGap sx={toolClusterSx}>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("teamA.name")}
                  >
                    Text
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("scoreA")}
                  >
                    Điểm
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("rect")}
                  >
                    Nền
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("shape")}
                  >
                    Shape
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("frame")}
                  >
                    Khung
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<ImageIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("image")}
                  >
                    Ảnh
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    sx={toolbarButtonSx}
                    onClick={() => addLayer("serve")}
                  >
                    Bóng giao
                  </Button>
                </Stack>
              </Stack>
            </Box>

            <Box
              sx={canvasViewportSx}
            >
              <Box
                ref={canvasWrapRef}
                onPointerDown={() => setSingleSelection("")}
                sx={(theme) => ({
                  ...canvasSurfaceSx,
                  position: "relative",
                  width: "100%",
                  maxWidth: 1180,
                  aspectRatio: `${canvas.width} / ${canvas.height}`,
                  border: `1px solid ${
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.common.white, 0.1)
                      : alpha(theme.palette.common.black, 0.1)
                  }`,
                  borderRadius: 1,
                  overflow: "hidden",
                  boxShadow:
                    theme.palette.mode === "dark"
                      ? `0 18px 42px ${alpha(theme.palette.common.black, 0.34)}`
                      : `0 14px 34px ${alpha(theme.palette.common.black, 0.12)}`,
                })}
              >
                {hasLayers ? (
                  <TemplateOverlayRenderer
                    mode="editor"
                    document={document}
                    canvas={canvas}
                    values={templatePreviewValues}
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

          <Paper elevation={0} sx={rightPanelSx}>
            <Box sx={panelHeaderSx}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="overline" fontWeight={900} color="text.secondary">
                  Design
                </Typography>
                {selectedLayer ? (
                  <Chip size="small" label={layerTypeLabel(selectedLayer)} variant="outlined" />
                ) : null}
              </Stack>
            </Box>

            <Box
              sx={{
                ...panelBodySx,
                maxHeight: { lg: "calc(100vh - 98px)" },
                overflowY: "auto",
              }}
            >
              <Typography
                variant="subtitle2"
                fontWeight={900}
                sx={{ display: "block", mb: 1 }}
              >
                {selectedLayer ? selectedLayer.label || selectedLayer.id : "Chưa chọn layer"}
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
                  {selectedLayerIsImage ? (
                    <Box sx={inspectorGroupSx}>
                      <Stack spacing={1}>
                        <Typography variant="caption" fontWeight={900} color="text.secondary">
                          Ảnh
                        </Typography>
                        <Box
                          onDragEnter={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setImageDropActive(true);
                          }}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setImageDropActive(true);
                          }}
                          onDragLeave={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setImageDropActive(false);
                          }}
                          onDrop={handleImageDrop}
                          sx={imageDropzoneSx(imageDropActive)}
                        >
                          {selectedLayer.src ? (
                            <Box
                              component="img"
                              src={selectedLayer.src}
                              alt={selectedLayer.label || "Ảnh"}
                              sx={{
                                maxWidth: "100%",
                                maxHeight: 112,
                                objectFit: "contain",
                                borderRadius: 0.75,
                                display: "block",
                              }}
                            />
                          ) : (
                            <Stack spacing={0.75} alignItems="center">
                              <ImageIcon fontSize="small" />
                              <Typography variant="body2" fontWeight={800}>
                                Kéo thả hoặc chọn ảnh
                              </Typography>
                            </Stack>
                          )}
                        </Box>
                        <Stack direction="row" spacing={0.75}>
                          <Button
                            size="small"
                            variant="contained"
                            startIcon={<UploadFileIcon />}
                            onClick={() => openImagePicker(selectedLayer.id)}
                            sx={{ flex: 1, textTransform: "none" }}
                          >
                            Tải ảnh
                          </Button>
                          <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            disabled={!selectedLayer.src}
                            onClick={() => patchSelectedLayer({ src: "" })}
                            sx={{ textTransform: "none" }}
                          >
                            Xóa
                          </Button>
                        </Stack>
                        <TextField
                          size="small"
                          label="URL ảnh"
                          placeholder={
                            selectedImageIsEmbedded
                              ? "Đang dùng ảnh đã upload"
                              : "https://..."
                          }
                          value={selectedImageIsEmbedded ? "" : selectedLayer.src || ""}
                          onChange={(event) =>
                            patchSelectedLayer({ src: event.target.value })
                          }
                          fullWidth
                        />
                      </Stack>
                    </Box>
                  ) : null}
                  <Box sx={inspectorGroupSx}>
                    <Stack spacing={1}>
                      <Typography variant="caption" fontWeight={900} color="text.secondary">
                        Vị trí
                      </Typography>
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
                    </Stack>
                  </Box>
                  {selectedLayerIsText ? (
                    <Box sx={inspectorGroupSx}>
                      <Stack spacing={1}>
                        <Typography variant="caption" fontWeight={900} color="text.secondary">
                          Typography
                        </Typography>
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
                      </Stack>
                    </Box>
                  ) : null}
                  <Box sx={inspectorGroupSx}>
                    <Stack spacing={1}>
                      <Typography variant="caption" fontWeight={900} color="text.secondary">
                        Giao diện
                      </Typography>
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
                  </Box>
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
