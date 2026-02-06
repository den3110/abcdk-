// src/context/ThemeContext.jsx
import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { lightTheme, darkTheme } from "../theme";

const ThemeContext = createContext({
  mode: "light",
  toggleTheme: () => {},
  isDark: false,
});

export const useThemeMode = () => useContext(ThemeContext);

const STORAGE_KEY = "theme-mode";

export const ThemeContextProvider = ({ children }) => {
  // Initialize from localStorage, default to "light"
  const [mode, setMode] = useState(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "dark" || saved === "light") {
        return saved;
      }
    }
    return "light"; // Default to light theme
  });

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const toggleTheme = () => {
    setMode((prev) => (prev === "light" ? "dark" : "light"));
  };

  const theme = useMemo(() => (mode === "dark" ? darkTheme : lightTheme), [mode]);

  const contextValue = useMemo(
    () => ({
      mode,
      toggleTheme,
      isDark: mode === "dark",
    }),
    [mode]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};

export default ThemeContext;
