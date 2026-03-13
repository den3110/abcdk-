const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

const dupBlock = /\n\s*masterTl\.to\(tweenState,[\s\S]*?\n\s*\};\n/;
if (!dupBlock.test(text)) {
  throw new Error("Duplicate block not found");
}
text = text.replace(dupBlock, "\n");
fs.writeFileSync(path, text, "utf8");
console.log("Removed duplicate morph block");
