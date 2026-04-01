const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

// Insert helpers after samplePolygon
const sampleAnchor = "    const samplePolygon = (pts, count) => {";
if (!text.includes(sampleAnchor)) {
  throw new Error("samplePolygon anchor not found");
}
if (!text.includes("const rotatePoints")) {
  text = text.replace(
    /const samplePolygon = \(pts, count\) => \{[\s\S]*?\};\n/,
    (match) =>
      `${match}\n    const rotatePoints = (pts, shift) =>\n      pts.map((_, i) => pts[(i + shift) % pts.length]);\n\n    const totalDistance = (a, b) =>\n      a.reduce((sum, p, i) => sum + dist(p, b[i]), 0);\n\n    const alignPoints = (from, to) => {\n      let bestShift = 0;\n      let best = Infinity;\n      for (let s = 0; s < to.length; s += 1) {\n        const rotated = rotatePoints(to, s);\n        const d = totalDistance(from, rotated);\n        if (d < best) {\n          best = d;\n          bestShift = s;\n        }\n      }\n      return rotatePoints(to, bestShift);\n    };\n`
  );
}

// Replace morphTo block
const morphRegex = /const morphTo = \(toPoints, duration, ease = "power1\.inOut"\) => \{[\s\S]*?\};/;
if (!morphRegex.test(text)) {
  throw new Error("morphTo block not found");
}

const morphBlock = [
  'const morphTo = (toPoints, duration, ease = "power1.inOut") => {',
  '      const aligned = alignPoints(currentPoints, toPoints);',
  '      const tweenState = { t: 0 };',
  '      masterTl.to(tweenState, {',
  '        t: 1,',
  '        duration,',
  '        ease,',
  '        onUpdate: () => {',
  '          const pts = interpolatePoints(currentPoints, aligned, tweenState.t);',
  '          morphShape.setAttribute("points", pointsToString(pts));',
  '        },',
  '        onComplete: () => {',
  '          currentPoints = aligned;',
  '        },',
  '      });',
  '    };',
].join("\n");

text = text.replace(morphRegex, morphBlock);

fs.writeFileSync(path, text, "utf8");
console.log("Aligned morph points to avoid spin");
