/* eslint-disable react/prop-types */
import { Box, Stack, Typography } from "@mui/material";
import Lottie from "lottie-react";
import emptyAnimation from "../assets/lottie/empty_lottie.json";

export default function LottieEmptyState({
  title,
  description = "",
  minHeight = 320,
  maxWidth = 520,
  animationSize = 220,
  sx = {},
}) {
  return (
    <Box
      sx={{
        width: "100%",
        minHeight,
        px: { xs: 2, md: 3 },
        py: { xs: 3, md: 4 },
        borderRadius: 4,
        backgroundColor: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...sx,
      }}
    >
      <Stack
        spacing={1.25}
        alignItems="center"
        textAlign="center"
        sx={{ width: "100%", maxWidth }}
      >
        <Box
          sx={{
            width: animationSize,
            maxWidth: "100%",
            mx: "auto",
            filter: "drop-shadow(0 18px 28px rgba(24,119,242,0.12))",
          }}
        >
          <Lottie animationData={emptyAnimation} loop autoplay />
        </Box>

        <Typography variant="h6" fontWeight={800}>
          {title}
        </Typography>

        {description ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ maxWidth: 440, lineHeight: 1.7 }}
          >
            {description}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}
