import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";

import { useGetAppInitQuery } from "../slices/appInitApiSlice.js";

export default function AppInitGate({ children }) {
  const { data, error } = useGetAppInitQuery();

  if (!data && !error) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          px: 3,
          background:
            "linear-gradient(180deg, #161110 0%, #141012 34%, #0f1319 100%)",
          color: "#f8f5f0",
        }}
      >
        <Stack spacing={2} alignItems="center">
          <Typography
            sx={{
              fontWeight: 800,
              letterSpacing: "0.2em",
              fontSize: "0.82rem",
            }}
          >
            PICKLETOUR
          </Typography>
          <CircularProgress
            size={28}
            thickness={4.5}
            sx={{ color: "#cb6b2f" }}
          />
        </Stack>
      </Box>
    );
  }

  return children;
}

AppInitGate.propTypes = {
  children: PropTypes.node.isRequired,
};
