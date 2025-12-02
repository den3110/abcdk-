// convert-p8-to-env.js - Convert .p8 file to env format
import fs from "fs";
import path from "path";

const p8FilePath = process.argv[2];

if (!p8FilePath) {
  console.log("Usage: node convert-p8-to-env.js <path-to-p8-file>");
  console.log("\nExample:");
  console.log(
    '  node convert-p8-to-env.js "C:\\Users\\giang\\Downloads\\Telegram Desktop\\AuthKey_VD8XT4NSJB (2).p8"'
  );
  process.exit(1);
}

if (!fs.existsSync(p8FilePath)) {
  console.log(`❌ File not found: ${p8FilePath}`);
  process.exit(1);
}

console.log("🔧 Converting .p8 file to ENV format...\n");

const content = fs.readFileSync(p8FilePath, "utf8");

// Replace real newlines with \\n for ENV file
const envFormat = content.replace(/\n/g, "\\n");

console.log("=".repeat(70));
console.log("✅ CONVERTED PRIVATE KEY (copy this to .env):");
console.log("=".repeat(70));
console.log("");
console.log(`WEATHERKIT_PRIVATE_KEY="${envFormat}"`);
console.log("");
console.log("=".repeat(70));
console.log("\n📋 Also add these to your .env file:");
console.log("");
console.log("WEATHERKIT_TEAM_ID=VD8XT4NSJB");
console.log("WEATHERKIT_KEY_ID=<get-from-apple-developer>");
console.log("WEATHERKIT_SERVICE_ID=<your-bundle-id>");
console.log("");
console.log("🔗 Get KEY_ID from:");
console.log("   https://developer.apple.com/account/resources/authkeys/list");
console.log("");
console.log("💡 SERVICE_ID is usually your app's Bundle ID");
console.log("   Example: com.pickletour.app");
console.log("");
