import { Box, Container, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { Link as RouterLink } from "react-router-dom";

import { useGetBlogHomepageBannerQuery } from "../slices/blogApiSlice";

const variantMap = {
  light: {
    outerBg: "#f3f3f3",
    borderColor: "rgba(0,0,0,0.08)",
    color: "#1f1f1f",
    hoverBg: "rgba(0,0,0,0.04)",
  },
  dark: {
    outerBg: "rgba(255,255,255,0.08)",
    borderColor: "rgba(255,255,255,0.12)",
    color: "#f8f5f0",
    hoverBg: "rgba(255,255,255,0.08)",
  },
};

export default function HomeBlogBanner({
  variant = "light",
  maxWidth = "1200px",
  sx,
}) {
  const { data, isError } = useGetBlogHomepageBannerQuery();
  const banner = data?.banner;

  if (isError || !banner?.text) return null;

  const styles = variantMap[variant] || variantMap.light;
  const href = banner.href || `/blog/${banner.post?.slug || ""}`;

  return (
    <Box
      sx={[
        {
          width: "100%",
          backgroundColor: styles.outerBg,
          borderTop: `1px solid ${styles.borderColor}`,
          borderBottom: `1px solid ${styles.borderColor}`,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Container
        maxWidth={false}
        sx={{
          maxWidth,
          px: { xs: 2, md: 4 },
        }}
      >
        <Box
          component={RouterLink}
          to={href}
          sx={{
            minHeight: { xs: 48, md: 56 },
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 0.75,
            color: styles.color,
            textAlign: "center",
            textDecoration: "none",
            "&:hover": {
              backgroundColor: styles.hoverBg,
              color: styles.color,
            },
          }}
        >
          <Typography
            component="span"
            sx={{
              fontSize: { xs: "0.92rem", md: "1rem" },
              fontWeight: 700,
              lineHeight: 1.4,
            }}
          >
            {banner.text}
          </Typography>
          <ArrowForwardRoundedIcon sx={{ fontSize: 20, flexShrink: 0 }} />
        </Box>
      </Container>
    </Box>
  );
}
