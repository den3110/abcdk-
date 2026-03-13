const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

text = text.replace(
  /const pts = interpolatePoints\(currentPoints, toPoints, tweenState\.t\);/,
  'const pts = interpolatePoints(currentPoints, aligned, tweenState.t);'
);
text = text.replace(/currentPoints = toPoints;/, 'currentPoints = aligned;');

fs.writeFileSync(path, text, "utf8");
console.log("Aligned morphTo update");
