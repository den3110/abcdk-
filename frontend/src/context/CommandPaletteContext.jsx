/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import PropTypes from "prop-types";

const CommandPaletteContext = createContext({
  open: false,
  openPalette: () => {},
  closePalette: () => {},
  togglePalette: () => {},
});

function shouldIgnoreKeyboardShortcut(event) {
  if (!event) return false;
  if (event.defaultPrevented) return true;
  if (event.isComposing) return true;
  return false;
}

export function CommandPaletteProvider({ children }) {
  const [open, setOpen] = useState(false);

  const openPalette = useCallback(() => setOpen(true), []);
  const closePalette = useCallback(() => setOpen(false), []);
  const togglePalette = useCallback(() => setOpen((current) => !current), []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleKeyDown = (event) => {
      if (shouldIgnoreKeyboardShortcut(event)) return;
      const key = String(event.key || "").toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const value = useMemo(
    () => ({
      open,
      openPalette,
      closePalette,
      togglePalette,
    }),
    [closePalette, open, openPalette, togglePalette],
  );

  return (
    <CommandPaletteContext.Provider value={value}>
      {children}
    </CommandPaletteContext.Provider>
  );
}

CommandPaletteProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export default CommandPaletteContext;
