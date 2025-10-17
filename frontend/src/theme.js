// src/theme.js
import { createTheme } from "@mui/material/styles";

export const theme = createTheme({
  typography: {
    fontFamily: [
      "Montserrat Variable",
      "Montserrat",
      "ui-monospace",
      "SFMono-Regular",
      "Menlo",
      "Consolas",
      "Liberation Mono",
      "monospace",
    ].join(","),
    fontWeightLight: 300,
    fontWeightRegular: 400,
    fontWeightMedium: 600,
    fontWeightBold: 700,
  },
});
