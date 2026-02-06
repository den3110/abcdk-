// src/theme.js
import { createTheme } from "@mui/material/styles";

// Shared typography settings
const typography = {
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
};

// Light Theme (default)
export const lightTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#0d6efd",
      light: "#3d8bff",
      dark: "#0a58ca",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#6c757d",
      light: "#8c939a",
      dark: "#495057",
    },
    background: {
      default: "#f8f9fa",
      paper: "#ffffff",
    },
    text: {
      primary: "#212529",
      secondary: "#6c757d",
    },
    divider: "rgba(0, 0, 0, 0.12)",
    error: {
      main: "#dc3545",
    },
    warning: {
      main: "#ffc107",
    },
    success: {
      main: "#198754",
    },
    info: {
      main: "#0dcaf0",
    },
  },
  typography,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#f8f9fa",
          color: "#212529",
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(255, 255, 255, 0.9)",
          backdropFilter: "blur(12px)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: "#ffffff",
        },
      },
    },
  },
});

// Dark Theme
export const darkTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#3d8bff",
      light: "#6ba3ff",
      dark: "#0d6efd",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#adb5bd",
      light: "#c4cad1",
      dark: "#6c757d",
    },
    background: {
      default: "#121212",
      paper: "#1e1e1e",
    },
    text: {
      primary: "#e9ecef",
      secondary: "#adb5bd",
    },
    divider: "rgba(255, 255, 255, 0.12)",
    error: {
      main: "#f44336",
    },
    warning: {
      main: "#ffc107",
    },
    success: {
      main: "#4caf50",
    },
    info: {
      main: "#29b6f6",
    },
  },
  typography,
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#121212",
          color: "#e9ecef",
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(30, 30, 30, 0.95)",
          backdropFilter: "blur(12px)",
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundColor: "#1e1e1e",
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: "#1e1e1e",
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: "#2d2d2d",
        },
      },
    },
  },
});

// Export default theme for backward compatibility
export const theme = lightTheme;
