// Sinh SVG path cho wordmark "pickletour" từ font display (OFL) bằng opentype.js.
// Chạy: node scripts/gen-wordmark.mjs [đường-dẫn-font.woff]
// Kết quả: src/screens/astryx/wordmarkData.js (mảng path từng chữ + kích thước khung).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";

const fontPath =
  process.argv[2] ||
  "node_modules/@fontsource/chango/files/chango-latin-400-normal.woff";
const TEXT = "pickletour";
const SIZE = 200;
const TRACKING = 0.93; // siết khoảng cách chữ cho chắc khối

const buf = readFileSync(resolve(fontPath));
const font = opentype.parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
);

const scale = SIZE / font.unitsPerEm;
let x = 0;
const letters = [];
for (const ch of TEXT) {
  const glyph = font.charToGlyph(ch);
  const p = glyph.getPath(x, SIZE, SIZE); // baseline y = SIZE
  letters.push({ ch, d: p.toPathData(2) });
  x += glyph.advanceWidth * scale * TRACKING;
}

// bbox tổng để set viewBox
const full = font.getPath(TEXT, 0, SIZE, SIZE);
const bb = full.getBoundingBox();
const minY = bb.y1;
const maxY = bb.y2;

const pad = 8;
const out = {
  viewBox: `${-pad} ${(minY - pad).toFixed(1)} ${(x + pad * 2).toFixed(1)} ${(maxY - minY + pad * 2).toFixed(1)}`,
  letters,
};

const js = `// ⚠️ File SINH TỰ ĐỘNG bởi scripts/gen-wordmark.mjs — đừng sửa tay.
// Wordmark "pickletour" đã convert thành path (font OFL: Chango).
const wordmarkData = ${JSON.stringify(out, null, 2)};
export default wordmarkData;
`;
writeFileSync(resolve("src/screens/astryx/wordmarkData.js"), js);
console.log("OK ->", out.viewBox, "| letters:", letters.length);
