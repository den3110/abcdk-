// utils/geocode.js — Geocode địa chỉ VN qua OpenStreetMap Nominatim (miễn phí, không cần key).
// Tôn trọng policy: gửi User-Agent, hạn chế tần suất (≤1 req/giây khi chạy hàng loạt).

/** Geocode 1 địa chỉ tại Việt Nam → { lat, lon, displayName } hoặc null. */
export async function geocodeAddressVN(address) {
  const q = String(address || "").trim();
  if (!q) return null;
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&q=" +
    encodeURIComponent(q);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "PickleTour/1.0 (https://pickletour.vn; support@pickletour.vn)",
        "Accept-Language": "vi",
      },
    });
    if (!res.ok) return null;
    const arr = await res.json();
    const hit = Array.isArray(arr) ? arr[0] : null;
    if (hit && hit.lat && hit.lon) {
      return { lat: parseFloat(hit.lat), lon: parseFloat(hit.lon), displayName: hit.display_name || q };
    }
  } catch (e) {
    console.warn("[geocodeAddressVN] fail:", e?.message || e);
  }
  return null;
}
