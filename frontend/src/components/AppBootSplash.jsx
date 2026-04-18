import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

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
        px: 3,
        background:
          "linear-gradient(180deg, #161110 0%, #141012 34%, #0f1319 100%)",
        color: "#f8f5f0",
      }}
    >
      <Stack spacing={1.5} alignItems="center">
        <Typography
          sx={{
            fontWeight: 800,
            letterSpacing: "0.2em",
            fontSize: "0.82rem",
          }}
        >
          {brand}
        </Typography>
        <CircularProgress
          size={28}
          thickness={4.5}
          sx={{ color: "#cb6b2f" }}
        />
        {message ? (
          <Typography
            variant="caption"
            sx={{
              color: "rgba(248,245,240,0.64)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {message}
          </Typography>
        ) : null}
      </Stack>
    </Box>
  );
}

AppBootSplash.propTypes = {
  brand: PropTypes.string,
  message: PropTypes.string,
};
