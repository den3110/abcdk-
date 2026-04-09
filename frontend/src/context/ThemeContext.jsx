// src/context/ThemeContext.jsx
import React, {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  useMemo,
} from "react";
import { ThemeProvider as MuiThemeProvider, CssBaseline } from "@mui/material";
import { lightTheme, darkTheme } from "../theme";
import {
  closeCrossTabChannel,
  createCrossTabChannel,
  publishCrossTabMessage,
  subscribeCrossTabChannel,
} from "../utils/crossTabChannel";

const ThemeContext = createContext({
  mode: "light",
  toggleTheme: () => {},
  isDark: false,
});

export const useThemeMode = () => useContext(ThemeContext);

const STORAGE_KEY = "theme-mode";
const THEME_SYNC_CHANNEL = "pickletour:ui-preferences";
const THEME_SYNC_TOPIC = "theme-mode";

export const ThemeContextProvider = ({ children }) => {
  const syncChannelRef = useRef(null);
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

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const channel = createCrossTabChannel(THEME_SYNC_CHANNEL);
    syncChannelRef.current = channel;

    const unsubscribe = subscribeCrossTabChannel(channel, (message) => {
      if (message?.topic !== THEME_SYNC_TOPIC) return;
      const nextMode =
        message?.mode === "dark" || message?.mode === "light"
          ? message.mode
          : "light";
      setMode((current) => (current === nextMode ? current : nextMode));
    });

    return () => {
      unsubscribe();
      closeCrossTabChannel(channel);
      if (syncChannelRef.current === channel) {
        syncChannelRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    publishCrossTabMessage(syncChannelRef.current, {
      topic: THEME_SYNC_TOPIC,
      mode,
    });
  }, [mode]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleStorage = (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;

      const nextMode =
        event.newValue === "dark" || event.newValue === "light"
          ? event.newValue
          : "light";

      setMode((current) => (current === nextMode ? current : nextMode));
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const toggleTheme = () => {
    setMode((prev) => (prev === "light" ? "dark" : "light"));
  };

  const theme = useMemo(
    () => (mode === "dark" ? darkTheme : lightTheme),
    [mode],
  );

  const contextValue = useMemo(
    () => ({
      mode,
      toggleTheme,
      isDark: mode === "dark",
    }),
    [mode],
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
