// src/components/SponsorMarquee.jsx
import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Box, Stack, Tooltip } from "@mui/material";
import { keyframes } from "@emotion/react";
import { useGetSponsorsPublicQuery } from "../slices/sponsorsApiSlice";
// import { useGetSponsorsPublicQuery } from "slices/sponsorsApiSlice";

/**
 * SponsorMarquee — Marquee chạy liên tục từ phải qua trái (seamless)
 * - Tự lấy dữ liệu qua useGetSponsorsPublicQuery (RTK Query)
 * - Không có list => không render gì
 *
 * Props:
 * - featuredOnly: chỉ lấy sponsor nổi bật (default: true)
 * - tier: lọc theo tier (Platinum/Gold/...)
 * - limit: số lượng tối đa (default: 50)
 * - height: chiều cao khung logo (px) — 16:9, object-fit: contain
 * - gap: khoảng cách giữa các logo (px)
 * - duration: số giây chạy hết 1 vòng
 * - pauseOnHover: hover để tạm dừng
 * - openInNewTab: mở link ở tab mới
 * - utm: object { utm_source, utm_medium, utm_campaign, ... } để gắn query vào link
 * - gradient: overlay mờ 2 bên mép
 * - bg: màu nền của rail
 */

function withParams(url, params = {}) {
  try {
    if (!url) return "#";
    const u = new URL(url);
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && String(v).length)
        u.searchParams.set(k, v);
    });
    return u.toString();
  } catch {
    return url || "#";
  }
}

function buildHref(item, utm) {
  if (item?.refLink) return withParams(item.refLink, utm);
  if (item?.websiteUrl) return withParams(item.websiteUrl, utm);
  return "#";
}

// Track 200%: translateX(0 → -50%) để seamless
const scrollLeft = keyframes`
  from { transform: translateX(0%); }
  to   { transform: translateX(-50%); }
`;

export default function SponsorMarquee({
  featuredOnly = true,
  tier,
  limit = 50,
  height = 60,
  gap = 24,
  duration = 30,
  pauseOnHover = true,
  openInNewTab = true,
  utm,
  gradient = true,
  bg,
}) {
  // Lấy list từ slice (public API)
  const { data: items = [], isError } = useGetSponsorsPublicQuery({
    featuredOnly: featuredOnly ? 1 : undefined,
    tier,
    limit,
  });

  // Không có list -> không hiện gì

  // Làm sạch + nếu quá ít logo thì nhân đôi để track dài hơn
  const base = useMemo(() => items.filter(Boolean), [items]);
  const group = useMemo(
    () => (base.length <= 4 ? [...base, ...base] : base),
    [base]
  );
  const hasItems = group.length > 0;

  // Bảo vệ duration tối thiểu để animation không giật
  const safeDuration = Math.max(5, Number(duration) || 30);

  if (isError || !items || items.length === 0) return null;
  return (
    <Box
      className="SponsorMarquee"
      sx={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        bgcolor: bg || "transparent",
        "@media (prefers-reduced-motion: reduce)": {
          "& ._track": { animation: "none" },
        },
        ...(pauseOnHover && {
          "&:hover ._track": { animationPlayState: "paused" },
        }),
      }}
    >
      {/* Fade edges */}
      {gradient && (
        <>
          <Box
            sx={(t) => ({
              pointerEvents: "none",
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 48,
              background: `linear-gradient(90deg, ${
                bg || t.palette.background.default
              } 0%, ${bg || t.palette.background.default}00 100%)`,
              zIndex: 1,
            })}
          />
          <Box
            sx={(t) => ({
              pointerEvents: "none",
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 48,
              background: `linear-gradient(270deg, ${
                bg || t.palette.background.default
              } 0%, ${bg || t.palette.background.default}00 100%)`,
              zIndex: 1,
            })}
          />
        </>
      )}

      {/* Track 200%: gồm 2 nhóm giống hệt nhau */}
      <Box
        className="_track"
        sx={{
          display: "flex",
          alignItems: "center",
          width: "max-content",
          animation: hasItems
            ? `${scrollLeft} ${safeDuration}s linear infinite`
            : "none",
          willChange: "transform",
        }}
      >
        <MarqueeGroup
          items={group}
          height={height}
          gap={gap}
          utm={utm}
          openInNewTab={openInNewTab}
        />
        <MarqueeGroup
          items={group}
          height={height}
          gap={gap}
          utm={utm}
          openInNewTab={openInNewTab}
        />
      </Box>
    </Box>
  );
}

function MarqueeGroup({ items, height, gap, utm, openInNewTab }) {
  return (
    <Stack direction="row" spacing={gap} sx={{ pr: gap }}>
      {items.map((sp) => (
        <SponsorLogo
          key={sp.id || sp.slug || sp.name}
          item={sp}
          height={height}
          utm={utm}
          openInNewTab={openInNewTab}
        />
      ))}
    </Stack>
  );
}

function SponsorLogo({ item, height, utm, openInNewTab }) {
  const href = buildHref(item, utm);
  const ratio = 16 / 9;
  const minW = Math.round(height * ratio);

  return (
    <Tooltip title={item?.name || "Nhà tài trợ"} arrow>
      <Box
        component={href && href !== "#" ? "a" : "div"}
        href={href && href !== "#" ? href : undefined}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noopener noreferrer" : undefined}
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          textDecoration: "none",
          borderRadius: 1.5,
          border: (t) => `1px solid ${t.palette.divider}`,
          bgcolor: "background.paper",
          overflow: "hidden",
          height,
          minWidth: minW,
          px: 1,
          transition: (t) =>
            t.transitions.create(["transform", "box-shadow"], {
              duration: t.transitions.duration.shorter,
            }),
          "&:hover": { transform: "translateY(-1px)", boxShadow: 1 },
        }}
        aria-label={item?.name || "Sponsor"}
      >
        {item?.logoUrl ? (
          <img
            loading="lazy"
            src={item.logoUrl}
            alt={item?.name || "Sponsor logo"}
            draggable={false}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <Box
            sx={{
              fontSize: 13,
              px: 1,
              color: "text.secondary",
              whiteSpace: "nowrap",
            }}
          >
            {item?.name || "Sponsor"}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}

/* PropTypes — không còn items ở component chính */
SponsorMarquee.propTypes = {
  featuredOnly: PropTypes.bool,
  tier: PropTypes.string,
  limit: PropTypes.number,
  height: PropTypes.number,
  gap: PropTypes.number,
  duration: PropTypes.number,
  pauseOnHover: PropTypes.bool,
  openInNewTab: PropTypes.bool,
  utm: PropTypes.object,
  gradient: PropTypes.bool,
  bg: PropTypes.string,
};

MarqueeGroup.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      logoUrl: PropTypes.string,
      websiteUrl: PropTypes.string,
      refLink: PropTypes.string,
      description: PropTypes.string,
      tier: PropTypes.string,
    })
  ),
  height: PropTypes.number,
  gap: PropTypes.number,
  utm: PropTypes.object,
  openInNewTab: PropTypes.bool,
};

SponsorLogo.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    name: PropTypes.string,
    logoUrl: PropTypes.string,
    websiteUrl: PropTypes.string,
    refLink: PropTypes.string,
    description: PropTypes.string,
    tier: PropTypes.string,
  }),
  height: PropTypes.number,
  utm: PropTypes.object,
  openInNewTab: PropTypes.bool,
};

/*
Usage (không cần truyền items):

import SponsorMarquee from "components/SponsorMarquee";

<SponsorMarquee
  featuredOnly
  limit={40}
  height={64}
  duration={25}
  utm={{ utm_source: "pickletour", utm_medium: "sponsor", utm_campaign: "2025" }}
/>
*/
