/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import { resolveOverlayTemplateValue } from "../../utils/overlayTemplateBindings.js";

const DEFAULT_CANVAS = { width: 1920, height: 1080 };

const clampNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const asCanvas = (canvas) => ({
  width: Math.max(1, clampNumber(canvas?.width, DEFAULT_CANVAS.width)),
  height: Math.max(1, clampNumber(canvas?.height, DEFAULT_CANVAS.height)),
});

function layerPosition(layer) {
  const x = clampNumber(layer?.x, 0);
  const y = clampNumber(layer?.y, 0);
  const width = Math.max(1, clampNumber(layer?.width, 120));
  const height = Math.max(1, clampNumber(layer?.height, 48));

  return {
    left: x,
    top: y,
    width,
    height,
  };
}

function layerBaseStyle(layer, canvas, mode, selected) {
  const style = layer?.style || {};
  const background =
    layer?.type === "rect" ? style.background || "rgba(0,0,0,.7)" : style.background;

  return {
    position: "absolute",
    ...layerPosition(layer),
    opacity: clampNumber(layer?.opacity, 1),
    transform: `rotate(${clampNumber(layer?.rotation, 0)}deg)`,
    transformOrigin: "center center",
    zIndex: clampNumber(layer?.zIndex, 0),
    display: layer?.visible === false ? "none" : "flex",
    alignItems: "center",
    justifyContent:
      style.textAlign === "right"
        ? "flex-end"
        : style.textAlign === "center"
          ? "center"
          : "flex-start",
    overflow: "hidden",
    boxSizing: "border-box",
    padding: layer?.type === "text" ? "0 0.08em" : 0,
    color: style.color || "#ffffff",
    background: background || "transparent",
    border:
      clampNumber(style.borderWidth, 0) > 0
        ? `${clampNumber(style.borderWidth, 0)}px solid ${
            style.borderColor || "transparent"
          }`
        : "none",
    borderRadius: clampNumber(style.borderRadius, 0),
    fontFamily:
      style.fontFamily ||
      'Montserrat, Inter, system-ui, -apple-system, "Segoe UI", Arial',
    fontSize: `${clampNumber(style.fontSize, 36)}px`,
    fontWeight: clampNumber(style.fontWeight, 700),
    lineHeight: clampNumber(style.lineHeight, 1.1),
    textAlign: style.textAlign || "left",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    pointerEvents: mode === "editor" ? "auto" : "none",
    cursor: mode === "editor" && !layer?.locked ? "move" : "default",
    outline: selected ? "2px solid #3b82f6" : "none",
    outlineOffset: selected ? 2 : 0,
  };
}

function renderLayer(layer, canvas, values, mode, editorProps = {}) {
  const selected = editorProps.selectedLayerId === layer?.id;
  const common = {
    key: layer?.id,
    "data-layer-id": layer?.id,
    style: layerBaseStyle(layer, canvas, mode, selected),
    onPointerDown: (event) => editorProps.onLayerPointerDown?.(event, layer),
    onClick: (event) => editorProps.onLayerClick?.(event, layer),
  };

  if (layer?.type === "rect") {
    return <div {...common} aria-label={layer?.label || "shape"} />;
  }

  if (layer?.type === "image") {
    const src =
      layer?.binding === "tournament.logoUrl"
        ? values["tournament.logoUrl"] || layer?.src
        : layer?.src;
    return (
      <div {...common}>
        {src ? (
          <img
            src={src}
            alt={layer?.label || ""}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              objectFit: "contain",
              pointerEvents: "none",
            }}
          />
        ) : mode === "editor" ? (
          <span style={{ fontSize: 22, opacity: 0.7 }}>Image</span>
        ) : null}
      </div>
    );
  }

  return <div {...common}>{resolveOverlayTemplateValue(layer, values)}</div>;
}

export default function TemplateOverlayRenderer({
  template,
  document,
  canvas,
  values,
  mode = "live",
  selectedLayerId,
  onLayerPointerDown,
  onLayerClick,
  style,
  className,
}) {
  const rootRef = useRef(null);
  const [rootSize, setRootSize] = useState({ width: 0, height: 0 });
  const sourceDocument = document || template?.document || {};
  const sourceCanvas = asCanvas(canvas || template?.canvas);
  const layers = Array.isArray(sourceDocument?.layers)
    ? sourceDocument.layers
    : [];

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return undefined;

    const update = () => {
      const rect = node.getBoundingClientRect();
      setRootSize({ width: rect.width, height: rect.height });
    };
    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const stageScale = useMemo(() => {
    if (!rootSize.width || !rootSize.height) return 1;
    return Math.min(
      rootSize.width / sourceCanvas.width,
      rootSize.height / sourceCanvas.height,
    );
  }, [rootSize.height, rootSize.width, sourceCanvas.height, sourceCanvas.width]);

  const rootStyle =
    mode === "editor"
      ? {
          position: "relative",
          width: "100%",
          aspectRatio: `${sourceCanvas.width} / ${sourceCanvas.height}`,
          overflow: "hidden",
          background:
            sourceDocument.background && sourceDocument.background !== "transparent"
              ? sourceDocument.background
              : "rgba(15,23,42,.92)",
          ...style,
        }
      : {
          position: "fixed",
          inset: 0,
          overflow: "hidden",
          background: sourceDocument.background || "transparent",
          pointerEvents: "none",
          zIndex: 2147483647,
          ...style,
        };

  if (!layers.length) return null;

  return (
    <div
      ref={rootRef}
      className={className}
      style={rootStyle}
      data-overlay-template=""
    >
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: sourceCanvas.width,
          height: sourceCanvas.height,
          transform: `translate(-50%, -50%) scale(${stageScale})`,
          transformOrigin: "center center",
        }}
      >
        {[...layers]
          .sort((left, right) => (left?.zIndex || 0) - (right?.zIndex || 0))
          .map((layer) =>
            renderLayer(layer, sourceCanvas, values, mode, {
              selectedLayerId,
              onLayerPointerDown,
              onLayerClick,
            }),
          )}
      </div>
    </div>
  );
}
