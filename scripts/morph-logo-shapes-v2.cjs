const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

const start = "    // Create a single morphing shape (all points share same count)";
const end = "    const circlePointsStr = pointsToString(circlePoints);";
const startIdx = text.indexOf(start);
const endIdx = text.indexOf(end);
if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  throw new Error("Shape block anchors not found");
}

const before = text.slice(0, startIdx);
const after = text.slice(endIdx);

const block = [
  "    // Create a single morphing shape (all points share same count)",
  "    const cx = 14;",
  "    const cy = 25;",
  "    const outerR = 10;",
  "    const innerR = 4;",
  "    const pointCount = 48;",
  "",
  "    const pointsToString = (pts) =>",
  "      pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(\" \");",
  "",
  "    const lerp = (a, b, t) => a + (b - a) * t;",
  "    const interpolatePoints = (fromPts, toPts, t) =>",
  "      fromPts.map((p, i) => [",
  "        lerp(p[0], toPts[i][0], t),",
  "        lerp(p[1], toPts[i][1], t),",
  "      ]);",
  "    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);",
  "    const samplePolygon = (pts, count) => {",
  "      const closed = [...pts, pts[0]];",
  "      const segLens = closed.slice(0, -1).map((p, i) => dist(p, closed[i + 1]));",
  "      const total = segLens.reduce((sum, v) => sum + v, 0);",
  "      const step = total / count;",
  "      const samples = [];",
  "      let segIndex = 0;",
  "      let segStart = closed[0];",
  "      let segEnd = closed[1];",
  "      let segLen = segLens[0];",
  "      let segAccum = 0;",
  "      for (let i = 0; i < count; i += 1) {",
  "        const target = i * step;",
  "        while (segAccum + segLen < target && segIndex < segLens.length - 1) {",
  "          segAccum += segLen;",
  "          segIndex += 1;",
  "          segStart = closed[segIndex];",
  "          segEnd = closed[segIndex + 1];",
  "          segLen = segLens[segIndex];",
  "        }",
  "        const local = segLen === 0 ? 0 : (target - segAccum) / segLen;",
  "        samples.push([lerp(segStart[0], segEnd[0], local), lerp(segStart[1], segEnd[1], local)]);",
  "      }",
  "      return samples;",
  "    };",
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
  "    const squarePoints = samplePolygon(squareCorners, pointCount);",
  "",
  "    const triangleCorners = [",
  "      [cx, cy - outerR],",
  "      [cx - outerR, cy + outerR * 0.8],",
  "      [cx + outerR, cy + outerR * 0.8],",
  "    ];",
  "    const trianglePoints = samplePolygon(triangleCorners, pointCount);",
  "",
  "    const starCorners = Array.from({ length: 10 }, (_, i) => {",
  "      const angle = (i * 36 - 90) * Math.PI / 180;",
  "      const r = i % 2 === 0 ? outerR : innerR;",
  "      return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];",
  "    });",
  "    const starPoints = samplePolygon(starCorners, pointCount);",
  "",
].join("\n");

text = before + block + after;
fs.writeFileSync(path, text, "utf8");
console.log("Rebuilt morphing points with higher resolution");
