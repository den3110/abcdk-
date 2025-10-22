// useImageFallback.js
import { useState, useMemo } from "react";

export default function useImageFallback(candidates = []) {
  const list = useMemo(() => candidates.filter(Boolean), [candidates]);
  const [idx, setIdx] = useState(0);
  const src = list[idx] || null;
  const onError = () => setIdx((i) => i + 1); // chuyển sang ảnh tiếp theo
  return { src, onError, hasMore: idx < list.length - 1 };
}
