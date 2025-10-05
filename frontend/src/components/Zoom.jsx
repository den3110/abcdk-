// src/components/Zoom.jsx
/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useState } from "react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";

/** Ảnh dự phòng mặc định (SVG data URI, nhẹ, không cần asset ngoài) */
export const DEFAULT_FALLBACK =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'>
      <defs>
        <linearGradient id='g' x1='0' x2='0' y1='0' y2='1'>
          <stop stop-color='#e5e7eb' offset='0%'/>
          <stop stop-color='#d1d5db' offset='100%'/>
        </linearGradient>
      </defs>
      <rect width='400' height='300' fill='url(#g)'/>
      <g fill='#9ca3af'>
        <circle cx='200' cy='125' r='36'/>
        <rect x='115' y='185' rx='8' width='170' height='20'/>
      </g>
      <text x='200' y='260' font-family='sans-serif' font-size='14' text-anchor='middle' fill='#6b7280'>No Image</text>
    </svg>`
  );

/** Hook: kiểm tra trước ảnh có load được không; rơi về fallback nếu lỗi */
function useResolvedImage(src, fallback = DEFAULT_FALLBACK) {
  const [resolved, setResolved] = useState(src || fallback);

  useEffect(() => {
    if (!src) {
      setResolved(fallback);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.onload = () => !cancelled && setResolved(src);
    img.onerror = () => !cancelled && setResolved(fallback);
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, fallback]);

  return resolved;
}

/** Handler onError an toàn, tránh loop khi fallback cũng lỗi */
function makeOnErrorHandler(fallback = DEFAULT_FALLBACK) {
  return (e) => {
    const el = e?.currentTarget;
    if (!el) return;
    if (el.dataset.fallbackApplied === "1") return;
    el.dataset.fallbackApplied = "1";
    el.src = fallback;
  };
}

/**
 * Dùng một lần cho nhiều ảnh (group). Bọc list/galley bên trong để có next/prev.
 *
 * <ZoomProvider maskOpacity={0.6} loadingElement={<div>Loading...</div>}>
 *   {items.map(i => (
 *     <ZoomItem key={i.id} src={i.fullUrl} thumb={i.thumbUrl} fallback="/img/placeholder.png">
 *       <img src={i.thumbUrl} alt={i.alt} style={{maxWidth: '100%', display: 'block', cursor: 'zoom-in'}} />
 *     </ZoomItem>
 *   ))}
 * </ZoomProvider>
 */
export function ZoomProvider({ children, ...providerProps }) {
  return <PhotoProvider {...providerProps}>{children}</PhotoProvider>;
}

/**
 * Một ảnh trong group (hoặc đơn lẻ). Nếu không truyền children,
 * component sẽ tự render <img> từ src hoặc thumb, kèm fallback.
 *
 * Props:
 *  - src:       ảnh full để zoom
 *  - thumb:     ảnh hiển thị bên ngoài (nếu không có sẽ dùng src)
 *  - fallback:  ảnh dự phòng khi lỗi (mặc định DEFAULT_FALLBACK)
 *  - imgProps:  props truyền vào thẻ <img> mặc định (alt, style, loading,...)
 */
export function ZoomItem({
  src,
  thumb,
  fallback = DEFAULT_FALLBACK,
  children,
  imgProps,
}) {
  // Ảnh dùng cho overlay zoom
  const resolvedViewSrc = useResolvedImage(src, fallback);
  // Ảnh hiển thị ngoài (thumb ưu tiên)
  const displayCandidate = thumb || src;
  const resolvedDisplaySrc = useResolvedImage(displayCandidate, fallback);

  const onError = useMemo(() => makeOnErrorHandler(fallback), [fallback]);

  // Nếu có children: cố gắng tiêm onError cho <img> hoặc MUI Avatar
  let childToRender = children;
  if (children && React.isValidElement(children)) {
    const c = React.Children.only(children);

    // Case 1: <img>
    if (c.type === "img") {
      childToRender = React.cloneElement(c, {
        onError: (e) => {
          c.props?.onError?.(e);
          onError(e);
        },
      });
    }
    // Case 2: MUI Avatar (c.type.muiName === 'Avatar')
    else if (c.type?.muiName === "Avatar") {
      const prevImgProps = c.props?.imgProps || {};
      childToRender = React.cloneElement(c, {
        imgProps: {
          ...prevImgProps,
          onError: (e) => {
            prevImgProps?.onError?.(e);
            onError(e);
          },
        },
      });
    }
    // Case 3: phần tử khác -> để nguyên
  }

  return (
    <PhotoView src={resolvedViewSrc}>
      {childToRender || (
        <img
          src={resolvedDisplaySrc}
          loading="lazy"
          onError={onError}
          style={{ maxWidth: "100%", display: "block", cursor: "zoom-in"}}
          {...imgProps}
        />
      )}
    </PhotoView>
  );
}

/**
 * Zoom nhanh cho MỘT ảnh (không cần tự tạo Provider).
 * Ví dụ:
 *   <ZoomableImage src={url} alt="Ảnh" imgStyle={{ borderRadius: 8 }} />
 */
export function ZoomableImage({
  src,
  alt = "",
  imgStyle,
  fallback = DEFAULT_FALLBACK,
  ...imgProps
}) {
  return (
    <ZoomProvider>
      <ZoomItem
        src={src}
        fallback={fallback}
        imgProps={{
          alt,
          style: {
            maxWidth: "100%",
            display: "block",
            cursor: "zoom-in",
            ...(imgStyle || {}),
          },
          ...imgProps,
        }}
      />
    </ZoomProvider>
  );
}

/**
 * Bọc BẤT KỲ phần tử con nào (card, avatar, thumbnail...) để click là zoom.
 * Ví dụ (MUI Avatar):
 *   <ZoomableWrapper src={fullUrl}>
 *     <Avatar src={thumbUrl} variant="rounded" sx={{ width: 96, height: 96, cursor: 'zoom-in' }} />
 *   </ZoomableWrapper>
 */
export function ZoomableWrapper({
  src,
  children,
  providerProps,
  fallback = DEFAULT_FALLBACK,
}) {
  return (
    <ZoomProvider {...(providerProps || {})}>
      <ZoomItem src={src} fallback={fallback}>
        {children}
      </ZoomItem>
    </ZoomProvider>
  );
}

/** Tiện ích: <ImgWithFallback /> nếu cần dùng riêng lẻ ngoài Zoom */
export function ImgWithFallback({
  src,
  alt = "",
  fallback = DEFAULT_FALLBACK,
  ...rest
}) {
  const resolved = useResolvedImage(src, fallback);
  const onError = useMemo(() => makeOnErrorHandler(fallback), [fallback]);
  return <img src={resolved} alt={alt} onError={onError} {...rest} />;
}

export default ZoomableImage;
