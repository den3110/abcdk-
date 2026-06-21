import { memo } from "react";
import { Link } from "react-router-dom";
import { Box } from "@mui/material";
import PropTypes from "prop-types";

const LogoAnimationMorph = memo(function LogoAnimationMorph({
  isMobile,
  showBackButton,
}) {
  return (
    <Link
      to="/"
      style={{
        textDecoration: "none",
        flexGrow: isMobile ? 1 : 0,
        textAlign: isMobile ? "center" : "left",
        display: "inline-flex",
        alignItems: "center",
        flexShrink: 0,
        width: "auto",
        minWidth: isMobile ? "140px" : "170px",
      }}
      onClick={() => window.scrollTo(0, 0)}
    >
      <Box
        component="span"
        sx={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: isMobile ? "center" : "flex-start",
          height: "50px",
          width: "100%",
          mr: isMobile && showBackButton ? 4 : 0,
          ml: isMobile && showBackButton ? 4 : 0,
          cursor: "pointer",
          fontSize: isMobile ? "1.35rem" : "1.5rem",
          fontWeight: 800,
          lineHeight: 1,
          letterSpacing: 0,
          whiteSpace: "nowrap",
          background: "linear-gradient(45deg, #0d6efd 30%, #0dcaf0 90%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
        }}
      >
        PickleTour
      </Box>
    </Link>
  );
});

LogoAnimationMorph.propTypes = {
  isMobile: PropTypes.bool,
  showBackButton: PropTypes.bool,
};

export default LogoAnimationMorph;
