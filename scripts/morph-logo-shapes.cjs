const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

const shapesBlockRegex = /\n\s*\/\/ Create multiple shapes[\s\S]*?svg\.appendChild\(star\);\n/;
if (!shapesBlockRegex.test(text)) {
  throw new Error("Shapes block not found");
}

const shapesBlock = [
  "\n    // Create a single morphing shape (all points share same count)",
  "    const cx = 14;",
  "    const cy = 25;",
  "    const outerR = 10;",
  "    const innerR = 4;",
  "    const pointCount = 12;",
  "",
  "    const pointsToString = (pts) =>",
  "      pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(\" \" );",
  "",
  "    const lerp = (a, b, t) => a + (b - a) * t;",
  "    const edgePoints = (a, b, steps) =>",
  "      Array.from({ length: steps }, (_, i) => {",
  "        const t = i / (steps - 1);",
  "        return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];",
  "      });",
  "",
  "    const circlePoints = Array.from({ length: pointCount }, (_, i) => {",
  "      const angle = (i / pointCount) * Math.PI * 2 - Math.PI / 2;",
  "      return [cx + outerR * Math.cos(angle), cy + outerR * Math.sin(angle)];",
  "    });",
  "",
  "    const squareCorners = [",
  "      [cx - outerR, cy - outerR],",
  "      [cx + outerR, cy - outerR],",
  "      [cx + outerR, cy + outerR],",
  "      [cx - outerR, cy + outerR],",
  "    ];",
  "    const squarePoints = [",
  "      ...edgePoints(squareCorners[0], squareCorners[1], 3),",
  "      ...edgePoints(squareCorners[1], squareCorners[2], 3),",
  "      ...edgePoints(squareCorners[2], squareCorners[3], 3),",
  "      ...edgePoints(squareCorners[3], squareCorners[0], 3),",
  "    ];",
  "",
  "    const triangleCorners = [",
  "      [cx, cy - outerR],",
  "      [cx - outerR, cy + outerR * 0.8],",
  "      [cx + outerR, cy + outerR * 0.8],",
  "    ];",
  "    const trianglePoints = [",
  "      ...edgePoints(triangleCorners[0], triangleCorners[1], 4),",
  "      ...edgePoints(triangleCorners[1], triangleCorners[2], 4),",
  "      ...edgePoints(triangleCorners[2], triangleCorners[0], 4),",
  "    ];",
  "",
  "    const starPointsRaw = [];",
  "    for (let i = 0; i < 10; i++) {",
  "      const angle = (i * 36 - 90) * Math.PI / 180;",
  "      const r = i % 2 === 0 ? outerR : innerR;",
  "      starPointsRaw.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);",
  "    }",
  "    const starPoints = [...starPointsRaw, starPointsRaw[0], starPointsRaw[1]];",
  "",
  "    const circlePointsStr = pointsToString(circlePoints);",
  "    const squarePointsStr = pointsToString(squarePoints);",
  "    const trianglePointsStr = pointsToString(trianglePoints);",
  "    const starPointsStr = pointsToString(starPoints);",
  "",
  "    const morphShape = document.createElementNS(\"http://www.w3.org/2000/svg\", \"polygon\");",
  "    morphShape.setAttribute(\"points\", circlePointsStr);",
  "    morphShape.setAttribute(\"fill\", \"url(#grad-blue)\");",
  "    morphShape.style.transformOrigin = \"center\";",
  "    morphShape.style.transformBox = \"fill-box\";",
  "    svg.appendChild(morphShape);",
  "",
].join("\n");

text = text.replace(shapesBlockRegex, shapesBlock);

const timelineBlockRegex = /\n\s*\/\/ Stage 1: Circle rotates[\s\S]*?\/\/ P appears in center with entrance animation/;
if (!timelineBlockRegex.test(text)) {
  throw new Error("Timeline block not found");
}

const timelineBlock = [
  "\n    // Stage 1: Circle -> Square",
  "    masterTl.to(morphShape, {",
  "      attr: { points: squarePointsStr },",
  "      duration: 0.35,",
  "      ease: \"power2.inOut\",",
  "    });",
  "\n    // Stage 2: Square -> Triangle",
  "    masterTl.to(morphShape, {",
  "      attr: { points: trianglePointsStr },",
  "      duration: 0.35,",
  "      ease: \"power2.inOut\",",
  "    });",
  "\n    // Stage 3: Triangle -> Star",
  "    masterTl.to(morphShape, {",
  "      attr: { points: starPointsStr },",
  "      duration: 0.4,",
  "      ease: \"power2.inOut\",",
  "    });",
  "\n    // Stage 4: Star -> fade out for P",
  "    masterTl.to(morphShape, {",
  "      opacity: 0,",
  "      scale: 0.6,",
  "      duration: 0.3,",
  "      ease: \"power2.in\",",
  "    });",
  "\n    // P appears in center with entrance animation",
].join("\n");

text = text.replace(timelineBlockRegex, timelineBlock);

fs.writeFileSync(path, text, "utf8");
console.log("Reworked GSAP morphing shapes");
