let hlsLoaderPromise = null;

export default function loadHlsPlayer() {
  if (hlsLoaderPromise) {
    return hlsLoaderPromise;
  }

  hlsLoaderPromise = import("hls.js")
    .then((module) => module?.default || module?.Hls || null)
    .catch((error) => {
      hlsLoaderPromise = null;
      throw error;
    });

  return hlsLoaderPromise;
}
