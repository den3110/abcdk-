// src/controllers/weatherController.js
import { getWeatherCached } from "../services/weatherkitCache.js";
import Tournament from "../models/tournamentModel.js";

/**
 * GET /api/weather?lat=...&lon=...
 */
export async function getWeatherByCoords(req, res, next) {
  try {
    const { lat, lon } = req.query;

    if (!lat || !lon) {
      return res.status(400).json({ message: "Missing lat or lon" });
    }

    const latNum = Number(lat);
    const lonNum = Number(lon);

    if (Number.isNaN(latNum) || Number.isNaN(lonNum)) {
      return res.status(400).json({ message: "lat/lon must be numbers" });
    }

    const data = await getWeatherCached({
      lat: latNum,
      lon: lonNum,
      lang: "en", // hoặc "vi" nếu bạn muốn
      timezone: "Asia/Bangkok",
    });

    const response = {
      current: data.currentWeather ?? null,
      hourly: data.forecastHourly?.hours?.slice(0, 12) ?? [],
      daily: data.forecastDaily?.days?.slice(0, 7) ?? [],
      alerts: data.weatherAlerts?.alerts ?? [],
      attribution: data.attribution ?? null,
    };

    return res.json(response);
  } catch (err) {
    return next(err);
  }
}

/**
 * GET /api/weather/tournament/:tid
 * Lấy lat/lon từ tournament.locationGeo trong DB
 */
export async function getWeatherForTournament(req, res, next) {
  try {
    const { tid } = req.params;

    const t = await Tournament.findById(tid).lean();
    if (!t) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    const geo = t.locationGeo || {};
    const latNum = Number(geo.lat);
    const lonNum = Number(geo.lon);

    // chưa có toạ độ => báo lỗi rõ ràng cho FE
    if (
      !geo ||
      Number.isNaN(latNum) ||
      Number.isNaN(lonNum) ||
      geo.lat == null ||
      geo.lon == null
    ) {
      return res.status(400).json({
        message:
          "Tournament has no geocoded location yet (locationGeo.lat/lon is missing)",
      });
    }

    const tz = t.timezone || "Asia/Ho_Chi_Minh";

    const data = await getWeatherCached({
      lat: latNum,
      lon: lonNum,
      lang: "en", // giữ nguyên như hàm trên cho đồng bộ
      timezone: tz,
    });

    const response = {
      current: data.currentWeather ?? null,
      daily: data.forecastDaily?.days?.slice(0, 3) ?? [],
      alerts: data.weatherAlerts?.alerts ?? [],
      attribution: data.attribution ?? null,
      // bonus: trả luôn info geo để FE hiển thị nếu muốn
      location: {
        text: t.location,
        geo: {
          lat: geo.lat,
          lon: geo.lon,
          displayName: geo.displayName || null,
          confidence: geo.confidence || "",
          source: geo.source || "",
        },
      },
    };

    return res.json(response);
  } catch (err) {
    return next(err);
  }
}
