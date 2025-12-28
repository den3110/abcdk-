/**
 * Test R2 Connection
 * Run: node test-r2.js
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import dotenv from "dotenv"
dotenv.config()

// ⚠️ ĐIỀN CREDENTIALS CỦA BẠN VÀO ĐÂY
const CONFIG = {
  accountId: process.env.R2_ACCOUNT_ID, // từ URL dashboard
  accessKeyId: process.env.R2_ACCESS_KEY_ID, // từ API token
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY, // từ API token
  bucketName: process.env.R2_BUCKET_NAME,
};


console.log(process.env.R2_ACCESS_KEY_ID)

// Tạo R2 client
const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${CONFIG.accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: CONFIG.accessKeyId,
    secretAccessKey: CONFIG.secretAccessKey,
  },
});

async function testConnection() {
  console.log("\n🧪 Testing R2 Connection...\n");

  try {
    // Test 1: Upload file
    console.log("1️⃣  Uploading test file...");
    const testContent = JSON.stringify({
      test: true,
      timestamp: new Date().toISOString(),
      message: "Hello from PickleTour OTA!",
    });

    await r2.send(
      new PutObjectCommand({
        Bucket: CONFIG.bucketName,
        Key: "test/connection-test.json",
        Body: testContent,
        ContentType: "application/json",
      })
    );
    console.log("   ✅ Upload successful!\n");

    // Test 2: Read file
    console.log("2️⃣  Reading test file...");
    const getResponse = await r2.send(
      new GetObjectCommand({
        Bucket: CONFIG.bucketName,
        Key: "test/connection-test.json",
      })
    );
    const body = await getResponse.Body.transformToString();
    console.log("   ✅ Read successful!");
    console.log("   📄 Content:", body, "\n");

    // Test 3: List files
    console.log("3️⃣  Listing bucket contents...");
    const listResponse = await r2.send(
      new ListObjectsV2Command({
        Bucket: CONFIG.bucketName,
        MaxKeys: 10,
      })
    );
    console.log("   ✅ List successful!");
    console.log(
      "   📁 Files:",
      (listResponse.Contents || []).map((f) => f.Key).join(", ") || "(empty)",
      "\n"
    );

    // Test 4: Delete test file
    console.log("4️⃣  Cleaning up test file...");
    await r2.send(
      new DeleteObjectCommand({
        Bucket: CONFIG.bucketName,
        Key: "test/connection-test.json",
      })
    );
    console.log("   ✅ Cleanup successful!\n");

    // Success!
    console.log("═══════════════════════════════════════");
    console.log("🎉 R2 Connection Test PASSED!");
    console.log("═══════════════════════════════════════");
    console.log("\nYour R2 configuration:");
    console.log(
      `  Endpoint: https://${CONFIG.accountId}.r2.cloudflarestorage.com`
    );
    console.log(`  Bucket:   ${CONFIG.bucketName}`);
    console.log("\n✅ Ready to use OTA system!\n");
  } catch (error) {
    console.log("\n═══════════════════════════════════════");
    console.log("❌ R2 Connection Test FAILED");
    console.log("═══════════════════════════════════════");
    console.log("\nError:", error.message);

    if (error.name === "InvalidAccessKeyId") {
      console.log("\n💡 Hint: Access Key ID không đúng");
    } else if (error.name === "SignatureDoesNotMatch") {
      console.log("\n💡 Hint: Secret Access Key không đúng");
    } else if (error.name === "NoSuchBucket") {
      console.log("\n💡 Hint: Bucket không tồn tại, kiểm tra lại tên bucket");
    } else if (error.code === "ENOTFOUND") {
      console.log("\n💡 Hint: Account ID không đúng");
    }

    console.log("\n");
    process.exit(1);
  }
}

// Check if credentials are filled
if (CONFIG.accountId === "YOUR_ACCOUNT_ID") {
  console.log("\n⚠️  Bạn chưa điền credentials!");
  console.log("\nMở file test-r2.js và điền:");
  console.log("  - accountId: từ URL dashboard");
  console.log("  - accessKeyId: từ API token");
  console.log("  - secretAccessKey: từ API token\n");
  process.exit(1);
}

testConnection();
