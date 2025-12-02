// src/services/weatherkitToken.js
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const {
  WEATHERKIT_TEAM_ID,
  WEATHERKIT_KEY_ID,
  WEATHERKIT_SERVICE_ID,
  WEATHERKIT_PRIVATE_KEY,
} = process.env;

if (!WEATHERKIT_TEAM_ID || !WEATHERKIT_KEY_ID || !WEATHERKIT_SERVICE_ID) {
  console.log(1)
  console.log(WEATHERKIT_TEAM_ID)
  console.log(WEATHERKIT_KEY_ID)
  console.log(WEATHERKIT_SERVICE_ID )
  throw new Error("Missing WeatherKit env: TEAM_ID / KEY_ID / SERVICE_ID");
}

if (!WEATHERKIT_PRIVATE_KEY) {
  console.log(2)
  throw new Error("Missing WeatherKit env: WEATHERKIT_PRIVATE_KEY");
}

// ENV đang là 1 dòng chứa "\n" → convert thành newline thật
const privateKey = WEATHERKIT_PRIVATE_KEY.replace(/\\n/g, "\n");

/**
 * Tạo WeatherKit Developer Token (JWT) dùng để gọi REST API
 */
export function createWeatherKitToken() {
  const now = Math.floor(Date.now() / 1000);
  const expiresInSeconds = 60 * 60; // 1 giờ

  const payload = {
    iss: WEATHERKIT_TEAM_ID,        // Team ID
    sub: WEATHERKIT_SERVICE_ID,     // Service ID / App ID
    iat: now,
    exp: now + expiresInSeconds,
  };

  const header = {
    alg: "ES256",
    kid: WEATHERKIT_KEY_ID,
    id: `${WEATHERKIT_TEAM_ID}.${WEATHERKIT_SERVICE_ID}`,
    typ: "JWT",
  };

  const token = jwt.sign(payload, privateKey, {
    algorithm: "ES256",
    header,
  });

  return token;
}
