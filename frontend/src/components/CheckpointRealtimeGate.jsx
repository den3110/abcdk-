import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
  useGetActiveCheckpointRequirementQuery,
  useStartActiveCheckpointMutation,
} from "../slices/checkpointApiSlice.js";
import {
  closeCrossTabChannel,
  createCrossTabChannel,
  publishCrossTabMessage,
  subscribeCrossTabChannel,
} from "../utils/crossTabChannel.js";

const POLLING_INTERVAL_MS = 15000;
const CHECKPOINT_STORAGE_KEY = "pickletour_checkpoint";
const FORCED_CHECKPOINT_STORAGE_KEY = "pickletour_forced_checkpoint";
const CHECKPOINT_SYNC_CHANNEL = "pickletour:checkpoint";
const CHECKPOINT_SYNC_TOPIC = "forced-checkpoint";

const EXCLUDED_PATH_PREFIXES = [
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/checkpoint",
  "/oauth/authorize",
];

function isExcludedPath(pathname = "") {
  return EXCLUDED_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function buildReturnTo(location) {
  const next = `${location.pathname || "/"}${location.search || ""}${
    location.hash || ""
  }`;
  return next.startsWith("/") && !next.startsWith("/checkpoint") ? next : "/";
}

function checkpointUrl(token, returnTo) {
  return `/checkpoint?token=${encodeURIComponent(token)}&returnTo=${encodeURIComponent(
    returnTo || "/",
  )}`;
}

function readStoredForcedCheckpoint() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(FORCED_CHECKPOINT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCheckpointPayload(payload) {
  if (typeof window === "undefined" || !payload?.checkpoint?.token) return;
  try {
    window.sessionStorage.setItem(
      CHECKPOINT_STORAGE_KEY,
      JSON.stringify({
        checkpoint: payload.checkpoint,
        returnTo: payload.returnTo || "/",
        createdAt: payload.createdAt || Date.now(),
      }),
    );
    window.sessionStorage.setItem(
      FORCED_CHECKPOINT_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // The URL token is enough when sessionStorage is unavailable.
  }
}

function clearForcedCheckpointPayload() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(FORCED_CHECKPOINT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function getMandateId(payload = {}) {
  return String(
    payload?.mandate?.id ||
      payload?.mandate?._id ||
      payload?.mandateId ||
      "",
  );
}

export default function CheckpointRealtimeGate() {
  const userInfo = useSelector((state) => state.auth?.userInfo || null);
  const location = useLocation();
  const navigate = useNavigate();
  const [startActiveCheckpoint] = useStartActiveCheckpointMutation();
  const startingRef = useRef(false);
  const handledMandateRef = useRef("");
  const channelRef = useRef(null);

  const isLoggedIn = Boolean(userInfo?._id || userInfo?.token || userInfo?.email);
  const skip = !isLoggedIn || isExcludedPath(location.pathname);

  const { data, refetch } = useGetActiveCheckpointRequirementQuery(undefined, {
    skip,
    pollingInterval: skip ? 0 : POLLING_INTERVAL_MS,
    refetchOnFocus: true,
    refetchOnReconnect: true,
  });

  const navigateToCheckpoint = useCallback(
    ({ checkpoint, mandate, mandateId }) => {
      const token = checkpoint?.token;
      if (!token) return;

      const returnTo = buildReturnTo(location);
      const payload = {
        checkpoint,
        mandate: mandate || null,
        mandateId: mandateId || getMandateId({ mandate }),
        returnTo,
        createdAt: Date.now(),
        source: "realtime",
      };

      writeCheckpointPayload(payload);
      navigate(checkpointUrl(token, returnTo), { replace: true });
    },
    [location, navigate],
  );

  useEffect(() => {
    if (skip) return undefined;

    const channel = createCrossTabChannel(CHECKPOINT_SYNC_CHANNEL);
    channelRef.current = channel;
    const unsubscribe = subscribeCrossTabChannel(channel, (message) => {
      if (message?.topic !== CHECKPOINT_SYNC_TOPIC) return;
      if (!message?.checkpoint?.token) return;
      const mandateId = getMandateId(message);
      if (mandateId) handledMandateRef.current = mandateId;
      navigateToCheckpoint({
        checkpoint: message.checkpoint,
        mandate: message.mandate,
        mandateId,
      });
    });

    return () => {
      unsubscribe();
      closeCrossTabChannel(channel);
      if (channelRef.current === channel) {
        channelRef.current = null;
      }
    };
  }, [navigateToCheckpoint, skip]);

  useEffect(() => {
    if (skip) return;
    refetch();
  }, [location.hash, location.pathname, location.search, refetch, skip]);

  useEffect(() => {
    if (skip) {
      startingRef.current = false;
      return;
    }
    if (data?.required !== false) return;

    handledMandateRef.current = "";
    startingRef.current = false;
    clearForcedCheckpointPayload();
  }, [data?.required, skip]);

  useEffect(() => {
    if (skip || !data?.required) return;

    const mandateId = getMandateId(data);

    if (data?.checkpoint?.token) {
      if (mandateId) handledMandateRef.current = mandateId;
      const checkpointPayload = {
        checkpoint: data.checkpoint,
        mandate: data.mandate || null,
        mandateId,
      };
      publishCrossTabMessage(channelRef.current, {
        topic: CHECKPOINT_SYNC_TOPIC,
        ...checkpointPayload,
      });
      navigateToCheckpoint(checkpointPayload);
      return;
    }

    const stored = readStoredForcedCheckpoint();
    if (
      stored?.checkpoint?.token &&
      (!mandateId || String(stored.mandateId || "") === mandateId)
    ) {
      if (mandateId) handledMandateRef.current = mandateId;
      navigateToCheckpoint({
        checkpoint: stored.checkpoint,
        mandate: stored.mandate || data.mandate,
        mandateId,
      });
      return;
    }

    if (mandateId && handledMandateRef.current === mandateId) return;

    if (startingRef.current) return;
    startingRef.current = true;
    if (mandateId) handledMandateRef.current = mandateId;

    startActiveCheckpoint()
      .unwrap()
      .then((result) => {
        if (!result?.required || !result?.checkpoint?.token) {
          startingRef.current = false;
          handledMandateRef.current = "";
          clearForcedCheckpointPayload();
          return;
        }

        const nextMandateId = getMandateId(result) || mandateId;
        const checkpointPayload = {
          checkpoint: result.checkpoint,
          mandate: result.mandate || data.mandate || null,
          mandateId: nextMandateId,
        };

        publishCrossTabMessage(channelRef.current, {
          topic: CHECKPOINT_SYNC_TOPIC,
          ...checkpointPayload,
        });
        navigateToCheckpoint(checkpointPayload);
      })
      .catch(() => {
        startingRef.current = false;
        handledMandateRef.current = "";
      });
  }, [data, navigateToCheckpoint, skip, startActiveCheckpoint]);

  return null;
}
