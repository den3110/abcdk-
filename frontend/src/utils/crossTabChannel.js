export function createCrossTabChannel(name) {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return null;
  }

  try {
    return new BroadcastChannel(name);
  } catch {
    return null;
  }
}

export function subscribeCrossTabChannel(channel, handler) {
  if (!channel || typeof handler !== "function") {
    return () => {};
  }

  const wrappedHandler = (event) => {
    handler(event?.data);
  };

  channel.addEventListener("message", wrappedHandler);
  return () => channel.removeEventListener("message", wrappedHandler);
}

export function publishCrossTabMessage(channel, payload) {
  if (!channel) return;

  try {
    channel.postMessage(payload);
  } catch {
    // Ignore channel delivery failures and let storage fallback handle it.
  }
}

export function closeCrossTabChannel(channel) {
  if (!channel) return;

  try {
    channel.close();
  } catch {
    // Ignore close failures.
  }
}
