const fs = require("fs");
const path = "frontend/src/screens/PickleBall/Tournament.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");
text = text.replace(
  /<Container maxWidth="xl" sx=\{\{ py: 4, minHeight: "100vh" \}\}>/,
  '<Container maxWidth="xl" sx={{ py: 4, minHeight: "100vh", position: "relative", zIndex: 1 }}>'
);
fs.writeFileSync(path, text, "utf8");
console.log("Updated Container sx");
