// src/components/SponsorMarquee.jsx
import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Box, Stack, Tooltip, alpha } from "@mui/material";
import { keyframes } from "@emotion/react";
import { useGetSponsorsPublicQuery } from "../slices/sponsorsApiSlice";

/**
 * SponsorMarquee — Premium marquee với glass-morphism & gradient effects
 * - Tự lấy dữ liệu qua useGetSponsorsPublicQuery (RTK Query)
 * - Modern design với glow, blur, và smooth animations
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
 * - utm: object { utm_source, utm_medium, utm_campaign, ... }
 * - gradient: overlay mờ 2 bên mép
 * - bg: màu nền của rail
 * - variant: "glass" | "premium" | "minimal" (default: "glass")
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

// Seamless scroll animation
const scrollLeft = keyframes`
  from { transform: translateX(0%); }
  to   { transform: translateX(-50%); }
`;

// Shimmer effect cho premium feel
const shimmer = keyframes`
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
`;

// Pulse glow animation
const pulseGlow = keyframes`
  0%, 100% { opacity: 0.5; }
  50% { opacity: 0.8; }
`;

export default function SponsorMarquee({
  featuredOnly = true,
  tier,
  limit = 50,
  height = 72,
  gap = 20,
  duration = 30,
  pauseOnHover = true,
  openInNewTab = true,
  utm,
  gradient = true,
  bg,
  variant = "glass", // "glass" | "premium" | "minimal"
}) {
  const { data: items = [], isError } = useGetSponsorsPublicQuery({
    featuredOnly: featuredOnly ? 1 : undefined,
    tier,
    limit,
  });

  const base = useMemo(() => items.filter(Boolean), [items]);
  const group = useMemo(
    () => (base.length <= 4 ? [...base, ...base] : base),
    [base]
  );
  const hasItems = group.length > 0;
  const safeDuration = Math.max(5, Number(duration) || 30);

  if (isError || !items || items.length === 0) return null;

  return (
    <Box
      className="SponsorMarquee"
      sx={{
        position: "relative",
        overflow: "hidden",
        width: "100%",
        py: 3,
        bgcolor: bg || "transparent",
        "@media (prefers-reduced-motion: reduce)": {
          "& ._track": { animation: "none" },
        },
        ...(pauseOnHover && {
          "&:hover ._track": { animationPlayState: "paused" },
        }),
      }}
    >
      {/* Premium gradient overlays */}
      {gradient && (
        <>
          <Box
            sx={(t) => ({
              pointerEvents: "none",
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: 120,
              background: `linear-gradient(90deg, 
                ${bg || t.palette.background.default} 0%, 
                ${alpha(bg || t.palette.background.default, 0.8)} 40%,
                ${alpha(bg || t.palette.background.default, 0)} 100%)`,
              zIndex: 2,
            })}
          />
          <Box
            sx={(t) => ({
              pointerEvents: "none",
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              width: 120,
              background: `linear-gradient(270deg, 
                ${bg || t.palette.background.default} 0%, 
                ${alpha(bg || t.palette.background.default, 0.8)} 40%,
                ${alpha(bg || t.palette.background.default, 0)} 100%)`,
              zIndex: 2,
            })}
          />
        </>
      )}

      {/* Animated track */}
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
          variant={variant}
        />
        <MarqueeGroup
          items={group}
          height={height}
          gap={gap}
          utm={utm}
          openInNewTab={openInNewTab}
          variant={variant}
        />
      </Box>
    </Box>
  );
}

function MarqueeGroup({ items, height, gap, utm, openInNewTab, variant }) {
  return (
    <Stack direction="row" spacing={gap / 8} sx={{ pr: gap / 8 }}>
      {items.map((sp) => (
        <SponsorLogo
          key={sp.id || sp.slug || sp.name}
          item={sp}
          height={height}
          utm={utm}
          openInNewTab={openInNewTab}
          variant={variant}
        />
      ))}
    </Stack>
  );
}

function SponsorLogo({ item, height, utm, openInNewTab, variant }) {
  const href = buildHref(item, utm);
  const ratio = 16 / 9;
  const minW = Math.round(height * ratio);

  // Styles theo variant
  const getVariantStyles = (theme) => {
    const baseStyles = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      textDecoration: "none",
      borderRadius: 2.5,
      overflow: "hidden",
      height,
      minWidth: minW,
      px: 2.5,
      position: "relative",
      transition: theme.transitions.create(
        ["transform", "box-shadow", "border-color", "background"],
        { duration: 300, easing: "cubic-bezier(0.4, 0, 0.2, 1)" }
      ),
    };

    switch (variant) {
      case "premium":
        return {
          ...baseStyles,
          background: `linear-gradient(135deg, 
            ${alpha(theme.palette.background.paper, 0.9)} 0%,
            ${alpha(theme.palette.background.paper, 0.7)} 100%)`,
          backdropFilter: "blur(20px) saturate(180%)",
          border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
          boxShadow: `
            0 4px 12px ${alpha(theme.palette.common.black, 0.05)},
            0 0 0 1px ${alpha(theme.palette.common.white, 0.05)} inset
          `,
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            borderRadius: "inherit",
            padding: "1px",
            background: `linear-gradient(135deg, 
              ${alpha(theme.palette.primary.main, 0.3)} 0%,
              ${alpha(theme.palette.secondary.main, 0.2)} 50%,
              ${alpha(theme.palette.primary.main, 0.1)} 100%)`,
            WebkitMask:
              "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
            WebkitMaskComposite: "xor",
            maskComposite: "exclude",
            opacity: 0,
            transition: "opacity 0.3s ease",
          },
          "&:hover": {
            transform: "translateY(-4px) scale(1.02)",
            boxShadow: `
              0 12px 28px ${alpha(theme.palette.primary.main, 0.15)},
              0 0 0 1px ${alpha(theme.palette.common.white, 0.1)} inset,
              0 0 40px ${alpha(theme.palette.primary.main, 0.1)}
            `,
            border: `1px solid ${alpha(theme.palette.primary.main, 0.3)}`,
            "&::before": { opacity: 1 },
          },
        };

      case "minimal":
        return {
          ...baseStyles,
          bgcolor: alpha(theme.palette.background.paper, 0.6),
          border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          backdropFilter: "blur(8px)",
          "&:hover": {
            transform: "translateY(-2px)",
            bgcolor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: `0 4px 12px ${alpha(theme.palette.common.black, 0.08)}`,
          },
        };

      case "glass":
      default:
        return {
          ...baseStyles,
          background: `linear-gradient(135deg,
            ${alpha(theme.palette.background.paper, 0.7)} 0%,
            ${alpha(theme.palette.background.paper, 0.5)} 100%)`,
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          border: `1px solid ${alpha(
            theme.palette.mode === "dark"
              ? theme.palette.common.white
              : theme.palette.common.black,
            0.08
          )}`,
          boxShadow: `
            0 8px 32px ${alpha(theme.palette.common.black, 0.08)},
            inset 0 1px 0 ${alpha(theme.palette.common.white, 0.1)}
          `,
          "&::after": {
            content: '""',
            position: "absolute",
            top: 0,
            left: "-100%",
            width: "100%",
            height: "100%",
            background: `linear-gradient(90deg, 
              transparent 0%, 
              ${alpha(theme.palette.common.white, 0.1)} 50%, 
              transparent 100%)`,
            animation: `${shimmer} 3s ease-in-out infinite`,
            pointerEvents: "none",
          },
          "&:hover": {
            transform: "translateY(-3px) scale(1.01)",
            border: `1px solid ${alpha(
              theme.palette.primary.main,
              0.2
            )}`,
            boxShadow: `
              0 12px 48px ${alpha(theme.palette.common.black, 0.12)},
              0 0 0 1px ${alpha(theme.palette.primary.main, 0.1)} inset,
              0 0 60px ${alpha(theme.palette.primary.main, 0.08)}
            `,
            background: `linear-gradient(135deg,
              ${alpha(theme.palette.background.paper, 0.85)} 0%,
              ${alpha(theme.palette.background.paper, 0.65)} 100%)`,
          },
        };
    }
  };

  return (
    <Tooltip
      title={item?.name || "Nhà tài trợ"}
      arrow
      placement="top"
      slotProps={{
        popper: {
          modifiers: [{ name: "offset", options: { offset: [0, -4] } }],
        },
        tooltip: {
          sx: {
            bgcolor: (t) => alpha(t.palette.grey[900], 0.95),
            backdropFilter: "blur(8px)",
            fontSize: 12,
            fontWeight: 500,
            px: 1.5,
            py: 0.75,
          },
        },
      }}
    >
      <Box
        component={href && href !== "#" ? "a" : "div"}
        href={href && href !== "#" ? href : undefined}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noopener noreferrer" : undefined}
        sx={getVariantStyles}
        aria-label={item?.name || "Sponsor"}
      >
        {item?.logoUrl ? (
          <Box
            sx={{
              position: "relative",
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              loading="lazy"
              src={item.logoUrl}
              alt={item?.name || "Sponsor logo"}
              draggable={false}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "contain",
                filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.05))",
                transition: "filter 0.3s ease",
              }}
              onMouseEnter={(e) => {
                e.target.style.filter =
                  "drop-shadow(0 4px 8px rgba(0,0,0,0.1))";
              }}
              onMouseLeave={(e) => {
                e.target.style.filter =
                  "drop-shadow(0 2px 4px rgba(0,0,0,0.05))";
              }}
            />
          </Box>
        ) : (
          <Box
            sx={{
              fontSize: 13,
              fontWeight: 600,
              px: 1.5,
              color: "text.secondary",
              whiteSpace: "nowrap",
              letterSpacing: 0.5,
            }}
          >
            {item?.name || "Sponsor"}
          </Box>
        )}
      </Box>
    </Tooltip>
  );
}

/* PropTypes */
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
  variant: PropTypes.oneOf(["glass", "premium", "minimal"]),
};

MarqueeGroup.propTypes = {
  items: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
      name: PropTypes.string,
      logoUrl: PropTypes.string,
      websiteUrl: PropTypes.string,
      refLink: PropTypes.string,
      tier: PropTypes.string,
    })
  ),
  height: PropTypes.number,
  gap: PropTypes.number,
  utm: PropTypes.object,
  openInNewTab: PropTypes.bool,
  variant: PropTypes.string,
};

SponsorLogo.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    name: PropTypes.string,
    logoUrl: PropTypes.string,
    websiteUrl: PropTypes.string,
    refLink: PropTypes.string,
    tier: PropTypes.string,
  }),
  height: PropTypes.number,
  utm: PropTypes.object,
  openInNewTab: PropTypes.bool,
  variant: PropTypes.string,
};

/*
Usage Examples:

// Glass variant (default) - Modern, elegant
<SponsorMarquee
  featuredOnly
  variant="glass"
  height={72}
  duration={25}
  utm={{ utm_source: "pickletour", utm_campaign: "2025" }}
/>

// Premium variant - Luxury feel với gradient borders
<SponsorMarquee
  variant="premium"
  height={80}
  gap={24}
  duration={30}
/>

// Minimal variant - Clean, simple
<SponsorMarquee
  variant="minimal"
  height={64}
  duration={20}
/>
*/