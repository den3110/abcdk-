import PropTypes from "prop-types";
import Box from "@mui/material/Box";

export default function AppBootSplash({
  brand = "PICKLETOUR",
  message = "",
}) {
  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#fff",
      }}
    >
      <Box
        component="img"
        src="/icon-512.png"
        alt={message || brand}
        sx={{
          width: 64,
          height: 64,
          animation: "appBootPulse 1.2s ease-in-out infinite",
        }}
      />
      <style>
        {`@keyframes appBootPulse{0%,100%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}`}
      </style>
    </Box>
  );
}

AppBootSplash.propTypes = {
  brand: PropTypes.string,
  message: PropTypes.string,
};
