// services/geocodeTournamentLocation.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Kết quả mặc định
const BASE_RESULT = {
  lat: null,
  lon: null,
  countryCode: null,
  countryName: null,
  locality: null,
  admin1: null,
  admin2: null,
  formatted: null,
  accuracy: "low", // low | medium | high
  confidence: 0,
  provider: "openai-geocode",
  raw: null,
};

const normalizeStr = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
};

/**
 * Geocode địa điểm giải đấu bằng OpenAI
 *
 * @param {Object} params
 * @param {string} params.location - chuỗi địa điểm (VD: "Sân A, Quận 7, TP.HCM")
 * @param {string} [params.countryHint="VN"] - mã quốc gia ISO-3166-1 alpha-2
 */
export async function geocodeTournamentLocation({
  location,
  countryHint = "VN",
} = {}) {
  const raw = String(location || "").trim();
    
  if (!raw) {
    console.log(2)
    return { ...BASE_RESULT, raw: "" };
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn(
      "[geocodeTournamentLocation] Missing OPENAI_API_KEY, skip geocode",
      { location: raw }
    );
    return { ...BASE_RESULT, raw };
  }

  try {
    const systemPrompt =
      "You are a geocoding engine for a sports tournament platform. " +
      "Given a free-form location (often in Vietnamese) and an optional country code, " +
      "you MUST return a single JSON object describing an approximate point on Earth.\n\n" +
      "Rules:\n" +
      "- If the place is a venue or court inside a city, you may approximate by the venue or by the city center.\n" +
      "- If you are not sure of the exact venue coordinates but can identify the city or province, " +
      "  use the city/province center (do NOT return null in that case).\n" +
      "- Only return null lat/lon if you really cannot identify even the city or province.\n" +
      "- Prefer coordinates in WGS84.\n" +
      "- Country hint is very important: if provided, strongly assume the place is in that country.\n\n" +
      "Output format: STRICT JSON OBJECT with these fields only:\n" +
      '{\n' +
      '  "lat": number | null,\n' +
      '  "lon": number | null,\n' +
      '  "countryCode": string | null,\n' +
      '  "countryName": string | null,\n' +
      '  "locality": string | null,        // city / district / town\n' +
      '  "admin1": string | null,          // province / state\n' +
      '  "admin2": string | null,          // smaller admin area if useful\n' +
      '  "formatted": string | null,       // nice full formatted address\n' +
      '  "accuracy": "low" | "medium" | "high",\n' +
      '  "confidence": number              // 0-1 or 0-100, your choice but consistent\n' +
      "}\n" +
      "Do NOT include any extra fields. Do NOT include comments.";

    const userPrompt =
      `Location string: "${raw}".\n` +
      `Country hint (ISO 3166-1 alpha-2): "${countryHint || "VN"}".\n` +
      "Return ONLY JSON, no explanation, no markdown.";

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini", // hoặc gpt-4o-mini tuỳ bạn
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices?.[0]?.message?.content?.trim();

    if (!content) {
      console.warn("[geocodeTournamentLocation] Empty content from OpenAI", {
        location: raw,
      });
      return { ...BASE_RESULT, raw };
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (e) {
      console.error(
        "[geocodeTournamentLocation] JSON.parse failed, content=",
        content
      );
      return { ...BASE_RESULT, raw };
    }

    const lat =
      typeof parsed.lat === "number" && Number.isFinite(parsed.lat)
        ? parsed.lat
        : null;
    const lon =
      typeof parsed.lon === "number" && Number.isFinite(parsed.lon)
        ? parsed.lon
        : null;

    const accuracyRaw = String(parsed.accuracy || "").toLowerCase();
    const accuracy = ["low", "medium", "high"].includes(accuracyRaw)
      ? accuracyRaw
      : "low";

    const confidenceNum = Number(parsed.confidence);
    const confidence = Number.isFinite(confidenceNum) ? confidenceNum : 0;

    const result = {
      ...BASE_RESULT,
      lat,
      lon,
      countryCode: normalizeStr(parsed.countryCode),
      countryName: normalizeStr(parsed.countryName),
      locality: normalizeStr(parsed.locality),
      admin1: normalizeStr(parsed.admin1),
      admin2: normalizeStr(parsed.admin2),
      formatted:
        normalizeStr(parsed.formatted) ||
        normalizeStr(parsed.formattedAddress) ||
        raw,
      accuracy,
      confidence,
      raw,
    };

    // Log nhẹ để debug (có thể tắt sau)
    console.log("[geocodeTournamentLocation] OK", {
      location: raw,
      lat: result.lat,
      lon: result.lon,
      locality: result.locality,
      admin1: result.admin1,
      countryCode: result.countryCode,
      confidence: result.confidence,
    });

    return result;
  } catch (err) {
    console.error("[geocodeTournamentLocation] error", {
      location: raw,
      error: err?.message || err,
    });
    return { ...BASE_RESULT, raw };
  }
}
