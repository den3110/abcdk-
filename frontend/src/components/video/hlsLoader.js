let hlsLoaderPromise = null;

// hls.js (~500KB) chỉ cần khi phát HLS → tách chunk on-demand để bundle chính nhẹ,
// build không OOM. Gọi trong player có .catch nên nếu chunk 404 (tab cũ sau deploy)
// thì chỉ hỏng phát video đó, KHÔNG sập trang.
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
