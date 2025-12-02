// src/services/weatherkitClient.js
import axios from "axios";
import { createWeatherKitToken } from "./weatherkitToken.js";

const WEATHERKIT_BASE_URL = "https://weatherkit.apple.com/api/v1";

/**
 * Gọi WeatherKit REST API
 * @param {Object} options
 * @param {number} options.lat
 * @param {number} options.lon
 * @param {string} [options.lang="en"]
 * @param {string} [options.timezone="Asia/Bangkok"]
 */
export async function fetchWeatherFromApple({
  lat,
  lon,
  lang = "en",
  timezone = "Asia/Bangkok",
}) {
  if (!lat || !lon) {
    throw new Error("Latitude/longitude is required");
  }

  const token = createWeatherKitToken();
  console.log(token);
  const params = new URLSearchParams({
    dataSets: "currentWeather,forecastHourly,forecastDaily,weatherAlerts",
    timezone,
  }).toString();

  const url = `${WEATHERKIT_BASE_URL}/weather/${lang}/${lat}/${lon}?${params}`;
  try {
    const res = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return res.data;
  } catch (error) {
    console.log(error)
    if (error.status === 401 && error.apple) {
      return res.status(401).json({
        message: "WeatherKit unauthorized",
        apple: error.apple,
      });
    }
    // console.log(error)
    return error;
  }
}
