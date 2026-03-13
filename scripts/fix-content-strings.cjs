const fs = require("fs");
const path = "frontend/src/screens/PickleBall/Tournament.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/content: """",/g, "content: '\"\"',");
fs.writeFileSync(path, text, "utf8");
console.log("Fixed content strings");
