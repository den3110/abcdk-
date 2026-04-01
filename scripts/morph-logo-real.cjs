const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

// Insert interpolatePoints after lerp
const lerpAnchor = 'const lerp = (a, b, t) => a + (b - a) * t;';
if (!text.includes(lerpAnchor)) {
  throw new Error("Anchor not found: lerp");
}
if (!text.includes("const interpolatePoints")) {
  text = text.replace(
    lerpAnchor,
    `${lerpAnchor}\n    const interpolatePoints = (fromPts, toPts, t) =>\n      fromPts.map((p, i) => [\n        lerp(p[0], toPts[i][0], t),\n        lerp(p[1], toPts[i][1], t),\n      ]);`
  );
}

const timelineRegex = /const masterTl = gsap\.timeline\(\);[\s\S]*?\/\/ Stage 4: Star -> fade out for P/;
if (!timelineRegex.test(text)) {
  throw new Error("Timeline block not found");
}

const timelineReplacement = [
  'const masterTl = gsap.timeline();',
  '    let currentPoints = circlePoints;',
  '    const morphTo = (toPoints, duration, ease = "power2.inOut") => {',
  '      const tweenState = { t: 0 };',
  '      masterTl.to(tweenState, {',
  '        t: 1,',
  '        duration,',
  '        ease,',
  '        onUpdate: () => {',
  '          const pts = interpolatePoints(currentPoints, toPoints, tweenState.t);',
  '          morphShape.setAttribute("points", pointsToString(pts));',
  '        },',
  '        onComplete: () => {',
  '          currentPoints = toPoints;',
  '        },',
  '      });',
  '    };',
  '',
  '    // Stage 1: Circle -> Square (morph)',
  '    morphTo(squarePoints, 0.35);',
  '',
  '    // Stage 2: Square -> Triangle (morph)',
  '    morphTo(trianglePoints, 0.35);',
  '',
  '    // Stage 3: Triangle -> Star (morph)',
  '    morphTo(starPoints, 0.4);',
  '',
  '    // Stage 4: Star -> fade out for P',
].join("\n");

text = text.replace(timelineRegex, timelineReplacement);

fs.writeFileSync(path, text, "utf8");
console.log("Switched to manual morph tween");
