const fs = require("fs");
const path = "frontend/src/screens/PickleBall/Tournament.jsx";
const input = fs.readFileSync(path, "utf8");
const fixed = Buffer.from(input, "latin1").toString("utf8");
if (fixed !== input) {
  fs.writeFileSync(path, fixed, "utf8");
  console.log("Re-encoded", path);
} else {
  console.log("No change", path);
}
if (fixed.includes("\uFFFD")) {
  console.warn("Warning: Replacement character found after fix.");
}
