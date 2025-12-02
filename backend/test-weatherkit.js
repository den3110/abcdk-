// test-weatherkit.js - Debug WeatherKit 401 error
import dotenv from "dotenv";
import { createWeatherKitToken } from "./services/weatherkitToken.js";
import { fetchWeatherFromApple } from "./services/weatherkitClient.js";
import jwt from "jsonwebtoken";

dotenv.config();

async function debugWeatherKit() {
  console.log("🔍 Debugging WeatherKit 401 Error...\n");

  // Step 1: Check environment variables
  console.log("=".repeat(70));
  console.log("STEP 1: Check Environment Variables");
  console.log("=".repeat(70));

  const {
    WEATHERKIT_TEAM_ID,
    WEATHERKIT_KEY_ID,
    WEATHERKIT_SERVICE_ID,
    WEATHERKIT_PRIVATE_KEY,
  } = process.env;

  console.log(
    "WEATHERKIT_TEAM_ID:",
    WEATHERKIT_TEAM_ID ? `✅ (${WEATHERKIT_TEAM_ID})` : "❌ MISSING"
  );
  console.log(
    "WEATHERKIT_KEY_ID:",
    WEATHERKIT_KEY_ID ? `✅ (${WEATHERKIT_KEY_ID})` : "❌ MISSING"
  );
  console.log(
    "WEATHERKIT_SERVICE_ID:",
    WEATHERKIT_SERVICE_ID ? `✅ (${WEATHERKIT_SERVICE_ID})` : "❌ MISSING"
  );
  console.log(
    "WEATHERKIT_PRIVATE_KEY:",
    WEATHERKIT_PRIVATE_KEY
      ? `✅ (${WEATHERKIT_PRIVATE_KEY.substring(0, 50)}...)`
      : "❌ MISSING"
  );

  if (
    !WEATHERKIT_TEAM_ID ||
    !WEATHERKIT_KEY_ID ||
    !WEATHERKIT_SERVICE_ID ||
    !WEATHERKIT_PRIVATE_KEY
  ) {
    console.log("\n❌ Missing required environment variables!");
    process.exit(1);
  }

  // Step 2: Check private key format
  console.log("\n");
  console.log("=".repeat(70));
  console.log("STEP 2: Check Private Key Format");
  console.log("=".repeat(70));

  const privateKey = WEATHERKIT_PRIVATE_KEY.replace(/\\n/g, "\n");
  console.log("Private Key (first 100 chars):");
  console.log(privateKey.substring(0, 100));
  console.log("...");

  const hasBegin = privateKey.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd = privateKey.includes("-----END PRIVATE KEY-----");

  console.log("\nPrivate Key Format Check:");
  console.log("  Has BEGIN marker:", hasBegin ? "✅" : "❌");
  console.log("  Has END marker:", hasEnd ? "✅" : "❌");
  console.log("  Total length:", privateKey.length);

  // Step 3: Generate and decode JWT
  console.log("\n");
  console.log("=".repeat(70));
  console.log("STEP 3: Generate JWT Token");
  console.log("=".repeat(70));

  try {
    const token = createWeatherKitToken();
    console.log("\n✅ Token generated successfully!");
    console.log("\nToken (first 100 chars):");
    console.log(token.substring(0, 100) + "...");

    // Decode without verification to see payload
    const decoded = jwt.decode(token, { complete: true });
    console.log("\n📋 Token Header:");
    console.log(JSON.stringify(decoded.header, null, 2));
    console.log("\n📋 Token Payload:");
    console.log(JSON.stringify(decoded.payload, null, 2));

    const now = Math.floor(Date.now() / 1000);
    const timeToExpire = decoded.payload.exp - now;
    console.log(
      `\n⏰ Token expires in: ${timeToExpire} seconds (${Math.floor(
        timeToExpire / 60
      )} minutes)`
    );
  } catch (err) {
    console.log("\n❌ Error generating token:");
    console.log(err.message);
    console.log(err.stack);
    process.exit(1);
  }

  // Step 4: Test API call
  console.log("\n");
  console.log("=".repeat(70));
  console.log("STEP 4: Test WeatherKit API Call");
  console.log("=".repeat(70));

  // Test coordinates (Saigon)
  const lat = 10.762622;
  const lon = 106.660172;

  console.log(`\nCalling WeatherKit API for:`);
  console.log(`  Latitude: ${lat}`);
  console.log(`  Longitude: ${lon}`);
  console.log(`  Language: en`);
  console.log(`  Timezone: Asia/Bangkok`);
  console.log("\nWaiting for response...\n");

  try {
    const result = await fetchWeatherFromApple({
      lat,
      lon,
      lang: "en",
      timezone: "Asia/Bangkok",
    });

    if (result.response?.status === 401) {
      console.log("❌ Got 401 Unauthorized Error!");
      console.log("\nResponse details:");
      console.log("  Status:", result.response?.status);
      console.log("  Status Text:", result.response?.statusText);
      console.log("  Data:", JSON.stringify(result.response?.data, null, 2));

      console.log("\n🔧 Possible Issues:");
      console.log("  1. Team ID is incorrect");
      console.log("  2. Key ID is incorrect");
      console.log("  3. Service ID is incorrect");
      console.log("  4. Private key (.p8 file) doesn't match the Key ID");
      console.log("  5. WeatherKit service not enabled for this App ID");
      console.log("  6. Private key format is wrong (check newlines)");
    } else if (result.currentWeather) {
      console.log("✅ SUCCESS! Got weather data:");
      console.log("\n📊 Current Weather:");
      console.log(`  Temperature: ${result.currentWeather.temperature}°C`);
      console.log(`  Condition: ${result.currentWeather.conditionCode}`);
      console.log(`  Humidity: ${result.currentWeather.humidity * 100}%`);
    } else {
      console.log("⚠️ Got response but unexpected format:");
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (err) {
    console.log("❌ Error calling WeatherKit API:");
    console.log("\nError details:");
    console.log("  Message:", err.message);

    if (err.response) {
      console.log("  Status:", err.response.status);
      console.log("  Status Text:", err.response.statusText);
      console.log("  Headers:", JSON.stringify(err.response.headers, null, 2));
      console.log("  Data:", JSON.stringify(err.response.data, null, 2));
    }

    console.log("\nFull error:");
    console.log(err);
  }

  console.log("\n");
  console.log("=".repeat(70));
  console.log("Debug Complete!");
  console.log("=".repeat(70));
}

debugWeatherKit();
