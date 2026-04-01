const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

const start = "    // Create a single morphing shape (all points share same count)";
const end = "    svg.appendChild(morphShape);";
const startIdx = text.indexOf(start);
const endIdx = text.indexOf(end);
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  throw new Error("Morph block anchors not found");
}

const before = text.slice(0, startIdx);
const after = text.slice(endIdx + end.length);

const block = [
  "    // Create a single morphing shape (path-sampled points)",
  "    const cx = 14;",
  "    const cy = 25;",
  "    const outerR = 10;",
  "    const innerR = 4;",
  "    const pointCount = 80;",
  "",
  "    const pointsToPath = (pts) => {",
  "      const [first, ...rest] = pts;",
  "      return (",
  "        `M ${first[0].toFixed(1)} ${first[1].toFixed(1)} ` +",
  "        rest.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(\" \") +",
  "        \" Z\"",
  "      );",
  "    };",
  "",
  "    const lerp = (a, b, t) => a + (b - a) * t;",
  "    const interpolatePoints = (fromPts, toPts, t) =>",
  "      fromPts.map((p, i) => [",
  "        lerp(p[0], toPts[i][0], t),",
  "        lerp(p[1], toPts[i][1], t),",
  "      ]);",
  "    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);",
  "    const rotatePoints = (pts, shift) =>",
  "      pts.map((_, i) => pts[(i + shift) % pts.length]);",
  "    const totalDistance = (a, b) =>",
  "      a.reduce((sum, p, i) => sum + dist(p, b[i]), 0);",
  "    const alignPoints = (from, to) => {",
  "      let bestShift = 0;",
  "      let best = Infinity;",
  "      for (let s = 0; s < to.length; s += 1) {",
  "        const rotated = rotatePoints(to, s);",
  "        const d = totalDistance(from, rotated);",
  "        if (d < best) {",
  "          best = d;",
  "          bestShift = s;",
  "        }",
  "      }",
  "      return rotatePoints(to, bestShift);",
  "    };",
  "",
  "    const makePath = (d) => {",
  "      const p = document.createElementNS(\"http://www.w3.org/2000/svg\", \"path\");",
  "      p.setAttribute(\"d\", d);",
  "      p.setAttribute(\"fill\", \"none\");",
  "      p.setAttribute(\"stroke\", \"none\");",
  "      p.style.opacity = \"0\";",
  "      svg.appendChild(p);",
  "      return p;",
  "    };",
  "",
  "    const samplePath = (pathEl, count) => {",
  "      const len = pathEl.getTotalLength();",
  "      const pts = [];",
  "      for (let i = 0; i < count; i += 1) {",
  "        const p = pathEl.getPointAtLength((i / count) * len);",
  "        pts.push([p.x, p.y]);",
  "      }",
  "      return pts;",
  "    };",
  "",
  "    const circleD = `M ${cx + outerR} ${cy} A ${outerR} ${outerR} 0 1 0 ${",
  "      cx - outerR",
  "    } ${cy} A ${outerR} ${outerR} 0 1 0 ${cx + outerR} ${cy} Z`;",
  "    const squareD = `M ${cx - outerR} ${cy - outerR} L ${cx + outerR} ${",
  "      cy - outerR",
  "    } L ${cx + outerR} ${cy + outerR} L ${cx - outerR} ${cy + outerR} Z`;",
  "    const triangleD = `M ${cx} ${cy - outerR} L ${cx - outerR} ${",
  "      cy + outerR * 0.8",
  "    } L ${cx + outerR} ${cy + outerR * 0.8} Z`;",
  "    const starCorners = Array.from({ length: 10 }, (_, i) => {",
  "      const angle = (i * 36 - 90) * Math.PI / 180;",
  "      const r = i % 2 === 0 ? outerR : innerR;",
  "      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];",
  "    });",
  "    const starD = pointsToPath(starCorners);",
  "",
  "    const circlePath = makePath(circleD);",
  "    const squarePath = makePath(squareD);",
  "    const trianglePath = makePath(triangleD);",
  "    const starPath = makePath(starD);",
  "",
  "    const circlePoints = samplePath(circlePath, pointCount);",
  "    const squarePoints = samplePath(squarePath, pointCount);",
  "    const trianglePoints = samplePath(trianglePath, pointCount);",
  "    const starPoints = samplePath(starPath, pointCount);",
  "",
  "    circlePath.remove();",
  "    squarePath.remove();",
  "    trianglePath.remove();",
  "    starPath.remove();",
  "",
  "    const morphShape = document.createElementNS(\"http://www.w3.org/2000/svg\", \"path\");",
  "    morphShape.setAttribute(\"d\", pointsToPath(circlePoints));",
  "    morphShape.setAttribute(\"fill\", \"url(#grad-blue)\");",
  "    morphShape.style.transformOrigin = \"center\";",
  "    morphShape.style.transformBox = \"fill-box\";",
  "    morphShape.style.opacity = \"1\";",
  "    svg.appendChild(morphShape);",
].join("\n");

text = before + block + after;

// Update morphTo to set path d
text = text.replace(
  /morphShape\.setAttribute\("points", pointsToString\(pts\)\);/g,
  'morphShape.setAttribute("d", pointsToPath(pts));'
);

fs.writeFileSync(path, text, "utf8");
console.log("Switched to path-sampled morphing");
