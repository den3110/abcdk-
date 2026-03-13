const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

if (!text.includes('morphShape.style.transformBox = "fill-box";')) {
  throw new Error("transformBox anchor not found");
}
if (!text.includes('morphShape.style.opacity = "1";')) {
  text = text.replace(
    'morphShape.style.transformBox = "fill-box";\n',
    'morphShape.style.transformBox = "fill-box";\n    morphShape.style.opacity = "1";\n'
  );
}

// update morphTo defaults and durations
text = text.replace(
  /const morphTo = \(toPoints, duration, ease = "power2\.inOut"\) => \{/,
  'const morphTo = (toPoints, duration, ease = "power1.inOut") => {'
);

text = text.replace(/morphTo\(squarePoints, 0\.35\);/g, 'morphTo(squarePoints, 0.6);');
text = text.replace(/morphTo\(trianglePoints, 0\.35\);/g, 'morphTo(trianglePoints, 0.6);');
text = text.replace(/morphTo\(starPoints, 0\.4\);/g, 'morphTo(starPoints, 0.7);');

// ensure morph shape is visible before morph
if (!text.includes('masterTl.set(morphShape')) {
  text = text.replace(
    'const masterTl = gsap.timeline();\n',
    'const masterTl = gsap.timeline();\n    masterTl.set(morphShape, { opacity: 1, scale: 1 });\n'
  );
}

fs.writeFileSync(path, text, "utf8");
console.log("Tweaked morph timing and visibility");
