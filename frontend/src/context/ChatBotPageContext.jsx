/* eslint-disable react-refresh/only-export-components */
import PropTypes from "prop-types";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const ChatBotPageContext = createContext({
  snapshot: null,
  capabilityKeys: [],
  getActionHandler: () => null,
  setSnapshot: () => {},
  clearSnapshot: () => {},
  setPageBindings: () => {},
  clearPageBindings: () => {},
});

function trimText(value, maxLength = 180) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function sanitizeList(list, limit = 8, maxLength = 80) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((item) => trimText(item, maxLength))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function sanitizeStats(stats) {
  if (!stats || typeof stats !== "object") return null;

  const next = {};
  for (const [key, value] of Object.entries(stats)) {
    const safeKey = trimText(key, 48);
    if (!safeKey) continue;
    if (typeof value === "number" && Number.isFinite(value)) {
      next[safeKey] = value;
      continue;
    }
    const textValue = trimText(value, 96);
    if (textValue) {
      next[safeKey] = textValue;
    }
  }

  return Object.keys(next).length ? next : null;
}

function sanitizeStructuredItems(list, limit = 8) {
  return (Array.isArray(list) ? list : [])
    .map((item) => ({
      id: trimText(item?.id, 64),
      name: trimText(item?.name, 140),
      status: trimText(item?.status, 32),
      location: trimText(item?.location, 96),
      startDate: trimText(item?.startDate, 48),
      endDate: trimText(item?.endDate, 48),
    }))
    .filter((item) => item.name)
    .slice(0, limit);
}

function sanitizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return null;

  const next = {
    pageType: trimText(snapshot.pageType, 64),
    pageSection: trimText(snapshot.pageSection, 64),
    pageView: trimText(snapshot.pageView, 64),
    entityTitle: trimText(snapshot.entityTitle, 140),
    sectionTitle: trimText(snapshot.sectionTitle, 120),
    pageSummary: trimText(snapshot.pageSummary, 240),
    activeLabels: sanitizeList(snapshot.activeLabels, 8, 64),
    visibleActions: sanitizeList(snapshot.visibleActions, 8, 64),
    highlights: sanitizeList(snapshot.highlights, 8, 96),
    metrics: sanitizeList(snapshot.metrics, 8, 96),
    stats: sanitizeStats(snapshot.stats),
    visibleTournaments: sanitizeStructuredItems(snapshot.visibleTournaments, 8),
    tournamentId: trimText(snapshot.tournamentId, 48),
    clubId: trimText(snapshot.clubId, 48),
    newsSlug: trimText(snapshot.newsSlug, 96),
    matchId: trimText(snapshot.matchId, 48),
    courtId: trimText(snapshot.courtId, 48),
  };

  if (!Object.values(next).some((value) =>
    Array.isArray(value) ? value.length > 0 : Boolean(value)
  )) {
    return null;
  }

  return next;
}

export function ChatBotPageContextProvider({ children }) {
  const [snapshot, setSnapshotState] = useState(null);
  const [capabilityKeys, setCapabilityKeys] = useState([]);
  const actionHandlersRef = useRef({});

  const setSnapshot = useCallback((nextSnapshot) => {
    setSnapshotState(sanitizeSnapshot(nextSnapshot));
  }, []);

  const clearSnapshot = useCallback(() => {
    setSnapshotState(null);
  }, []);

  const setPageBindings = useCallback((config = {}) => {
    const nextSnapshot =
      config && typeof config === "object" && "snapshot" in config
        ? config.snapshot
        : config;

    setSnapshotState(sanitizeSnapshot(nextSnapshot));
    setCapabilityKeys(
      sanitizeList(config?.capabilityKeys, 16, 48).map((item) => item.toLowerCase()),
    );
    actionHandlersRef.current =
      config?.actionHandlers && typeof config.actionHandlers === "object"
        ? config.actionHandlers
        : {};
  }, []);

  const clearPageBindings = useCallback(() => {
    setSnapshotState(null);
    setCapabilityKeys([]);
    actionHandlersRef.current = {};
  }, []);

  const getActionHandler = useCallback((key) => {
    if (!key) return null;
    return actionHandlersRef.current?.[key] || null;
  }, []);

  const value = useMemo(
    () => ({
      snapshot,
      capabilityKeys,
      getActionHandler,
      setSnapshot,
      clearSnapshot,
      setPageBindings,
      clearPageBindings,
    }),
    [
      snapshot,
      capabilityKeys,
      getActionHandler,
      setSnapshot,
      clearSnapshot,
      setPageBindings,
      clearPageBindings,
    ],
  );

  return (
    <ChatBotPageContext.Provider value={value}>
      {children}
    </ChatBotPageContext.Provider>
  );
}

ChatBotPageContextProvider.propTypes = {
  children: PropTypes.node.isRequired,
};

export function useChatBotPageContext() {
  return useContext(ChatBotPageContext);
}

export function useRegisterChatBotPageSnapshot(snapshot) {
  const { setPageBindings, clearPageBindings } = useChatBotPageContext();
  const serialized = useMemo(() => JSON.stringify(snapshot || null), [snapshot]);

  useEffect(() => {
    if (!serialized || serialized === "null") {
      clearPageBindings();
      return undefined;
    }

    const nextSnapshot = JSON.parse(serialized);
    setPageBindings({ snapshot: nextSnapshot });

    return () => {
      clearPageBindings();
    };
  }, [serialized, setPageBindings, clearPageBindings]);
}

export function useRegisterChatBotPageContext(config) {
  const { setPageBindings, clearPageBindings } = useChatBotPageContext();
  const serializedSnapshot = useMemo(
    () => JSON.stringify(config?.snapshot || null),
    [config?.snapshot],
  );
  const capabilityKeys = useMemo(
    () => (Array.isArray(config?.capabilityKeys) ? config.capabilityKeys : []),
    [config?.capabilityKeys],
  );
  const actionHandlers = config?.actionHandlers;

  useEffect(() => {
    const nextSnapshot =
      serializedSnapshot && serializedSnapshot !== "null"
        ? JSON.parse(serializedSnapshot)
        : null;

    setPageBindings({
      snapshot: nextSnapshot,
      capabilityKeys,
      actionHandlers,
    });

    return () => {
      clearPageBindings();
    };
  }, [serializedSnapshot, capabilityKeys, actionHandlers, setPageBindings, clearPageBindings]);
}
