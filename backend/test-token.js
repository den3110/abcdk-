import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

const token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2ODkyNGFmZjI5OTMxNDkxYzU3MGJhZWEiLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3NzM5NDQ5NjYsImV4cCI6MTc3NjUzNjk2Nn0.X8GGsIPPLpK89zk0xG4U_mTNgqwC_Nrtxs5ufiK0ON4";

console.log("SECRET:", process.env.JWT_SECRET ? "exists..." : "missing");

try {
  const dec = jwt.verify(token, process.env.JWT_SECRET);
  console.log("Success! Decoded:", dec);
} catch (e) {
  console.log("Verify Error:", e.message);
}
