const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/join\(" " \)/g, 'join(" ")');
fs.writeFileSync(path, text, "utf8");
console.log("Cleaned join spacing");
