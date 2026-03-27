let hlsLoaderPromise = null;

export default function loadHlsFromCDN() {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.resolve(null);
  }

  if (window.Hls) {
    return Promise.resolve(window.Hls);
  }

  if (hlsLoaderPromise) {
    return hlsLoaderPromise;
  }

  hlsLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-hlsjs='1']");

    const resolveLoaded = () => resolve(window.Hls || null);
    const rejectLoaded = (error) =>
      reject(error || new Error("Failed to load hls.js"));

    if (existing) {
      existing.addEventListener("load", resolveLoaded, { once: true });
      existing.addEventListener("error", rejectLoaded, { once: true });
      if (window.Hls) {
        resolveLoaded();
      }
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.16/dist/hls.min.js";
    script.async = true;
    script.defer = true;
    script.setAttribute("data-hlsjs", "1");
    script.onload = resolveLoaded;
    script.onerror = rejectLoaded;
    document.head.appendChild(script);
  });

  return hlsLoaderPromise;
}
