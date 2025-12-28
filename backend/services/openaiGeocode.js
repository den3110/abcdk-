// services/geocodeTournamentLocation.js
import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const BASE_RESULT = {
  lat: null,
  lon: null,
  countryCode: null,
  countryName: null,
  locality: null,
  admin1: null,
  admin2: null,
  formatted: null,
  accuracy: "low",
  confidence: 0,
  provider: "openai-geocode",
  raw: null,
};

const normalizeStr = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  return s || null;
};

const buildSystemPrompt = (kind) => {
  const head =
    "You are a geocoding engine for a sports platform. " +
    "Given a free-form location (often Vietnamese) and an optional country hint, " +
    "return an approximate point on Earth.\n\n";

  const rules =
    "Rules:\n" +
    "- Prefer coordinates in WGS84.\n" +
    "- Country hint is important: strongly assume the place is in that country.\n" +
    "- If exact venue is unknown but you can identify city/province, use city/province center.\n" +
    "- Only return null lat/lon if you cannot identify even city/province.\n\n";

  const output =
    "Output format: STRICT JSON OBJECT with these fields only:\n" +
    '{\n' +
    '  "lat": number | null,\n' +
    '  "lon": number | null,\n' +
    '  "countryCode": string | null,\n' +
    '  "countryName": string | null,\n' +
    '  "locality": string | null,\n' +
    '  "admin1": string | null,\n' +
    '  "admin2": string | null,\n' +
    '  "formatted": string | null,\n' +
    '  "accuracy": "low" | "medium" | "high",\n' +
    '  "confidence": number\n' +
    "}\n" +
    "Do NOT include any extra fields. Do NOT include comments.\n";

  const extra =
    kind === "club"
      ? "\nContext: The input describes a sports club / community or a venue name. " +
        "It may be short (only city/province). " +
        "If only the club name is given, infer the most likely city/province from the string.\n"
      : "\nContext: The input describes a sports tournament location.\n";

  return head + rules + output + extra;
};

/**
 * Geocode địa điểm giải đấu bằng OpenAI
 */
export async function geocodeTournamentLocation({
  location,
  countryHint = "VN",
} = {}) {
  const raw = String(location || "").trim();
  if (!raw) return { ...BASE_RESULT, raw: "" };

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[geocodeTournamentLocation] Missing OPENAI_API_KEY", {
      location: raw,
    });
    return { ...BASE_RESULT, raw };
  }

  try {
    const systemPrompt = buildSystemPrompt("tournament");
    const userPrompt =
      `Location string: "${raw}".\n` +
      `Country hint (ISO 3166-1 alpha-2): "${countryHint || "VN"}".\n` +
      "Return ONLY JSON, no explanation, no markdown.";

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) return { ...BASE_RESULT, raw };

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
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

    return {
      ...BASE_RESULT,
      lat,
      lon,
      countryCode: normalizeStr(parsed.countryCode),
      countryName: normalizeStr(parsed.countryName),
      locality: normalizeStr(parsed.locality),
      admin1: normalizeStr(parsed.admin1),
      admin2: normalizeStr(parsed.admin2),
      formatted: normalizeStr(parsed.formatted) || raw,
      accuracy,
      confidence,
      raw,
    };
  } catch (err) {
    console.error("[geocodeTournamentLocation] error", {
      location: raw,
      error: err?.message || err,
    });
    return { ...BASE_RESULT, raw };
  }
}

/**
 * ✅ NEW: Geocode địa điểm CLB bằng OpenAI
 * @param {string} location - address/locationText (ví dụ: "CLB ABC, 126 Lê Hồng Phong, Nam Định")
 */
export async function geocodeClubLocation({ location, countryHint = "VN" } = {}) {
  const raw = String(location || "").trim();
  if (!raw) return { ...BASE_RESULT, raw: "" };

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[geocodeClubLocation] Missing OPENAI_API_KEY", { location: raw });
    return { ...BASE_RESULT, raw };
  }

  try {
    const systemPrompt = buildSystemPrompt("club");
    const userPrompt =
      `Club location string: "${raw}".\n` +
      `Country hint (ISO 3166-1 alpha-2): "${countryHint || "VN"}".\n` +
      "Return ONLY JSON, no explanation, no markdown.";

    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const content = response.choices?.[0]?.message?.content?.trim();
    if (!content) return { ...BASE_RESULT, raw };

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
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

    return {
      ...BASE_RESULT,
      lat,
      lon,
      countryCode: normalizeStr(parsed.countryCode),
      countryName: normalizeStr(parsed.countryName),
      locality: normalizeStr(parsed.locality),
      admin1: normalizeStr(parsed.admin1),
      admin2: normalizeStr(parsed.admin2),
      formatted: normalizeStr(parsed.formatted) || raw,
      accuracy,
      confidence,
      raw,
    };
  } catch (err) {
    console.error("[geocodeClubLocation] error", {
      location: raw,
      error: err?.message || err,
    });
    return { ...BASE_RESULT, raw };
  }
}
