// Sinh trang so sánh wordmark "pickletour" từ nhiều font OFL -> public/wordmarks.html
// Mở: http://localhost:3000/wordmarks.html rồi chọn số ưng ý.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import opentype from "opentype.js";

const TEXT = "pickletour";
const SIZE = 200;
const TRACKING = 0.93;

const CANDIDATES = [
  ["Baloo 2 (800)", "node_modules/@fontsource/baloo-2/files/baloo-2-latin-800-normal.woff"],
  ["Bowlby One", "node_modules/@fontsource/bowlby-one/files/bowlby-one-latin-400-normal.woff"],
  ["Lilita One", "node_modules/@fontsource/lilita-one/files/lilita-one-latin-400-normal.woff"],
  ["Shrikhand", "node_modules/@fontsource/shrikhand/files/shrikhand-latin-400-normal.woff"],
  ["Luckiest Guy", "node_modules/@fontsource/luckiest-guy/files/luckiest-guy-latin-400-normal.woff"],
  ["Titan One", "node_modules/@fontsource/titan-one/files/titan-one-latin-400-normal.woff"],
  ["Chango", "node_modules/@fontsource/chango/files/chango-latin-400-normal.woff"],
];

function renderWordmark(fontPath) {
  const buf = readFileSync(resolve(fontPath));
  const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const scale = SIZE / font.unitsPerEm;
  let x = 0;
  let d = "";
  for (const ch of TEXT) {
    const glyph = font.charToGlyph(ch);
    d += glyph.getPath(x, SIZE, SIZE).toPathData(2) + " ";
    x += glyph.advanceWidth * scale * TRACKING;
  }
  const bb = font.getPath(TEXT, 0, SIZE, SIZE).getBoundingBox();
  const pad = 10;
  const viewBox = `${-pad} ${(bb.y1 - pad).toFixed(1)} ${(x + pad * 2).toFixed(1)} ${(bb.y2 - bb.y1 + pad * 2).toFixed(1)}`;
  return { d: d.trim(), viewBox };
}

const rows = CANDIDATES.map(([name, path], i) => {
  try {
    const { d, viewBox } = renderWordmark(path);
    return `
  <div class="row">
    <div class="tag">${i + 1} · ${name}</div>
    <svg viewBox="${viewBox}"><path fill="#3D87FF" d="${d}"/></svg>
  </div>`;
  } catch (e) {
    return `<div class="row"><div class="tag">${i + 1} · ${name} — LỖI: ${e.message}</div></div>`;
  }
}).join("\n");

const html = `<!doctype html>
<meta charset="utf-8">
<title>Chọn wordmark pickletour</title>
<style>
  body { background: #111112; margin: 0; padding: 40px 24px; font-family: system-ui, sans-serif; }
  h1 { color: #DFE2E5; font-size: 18px; font-weight: 600; margin: 0 0 28px; text-align: center; }
  .row { max-width: 860px; margin: 0 auto 34px; }
  .tag { color: #8F959C; font-size: 13px; margin-bottom: 10px; }
  svg { width: 100%; height: auto; display: block; }
</style>
<h1>Chọn kiểu chữ wordmark — nhắn số bạn ưng (1–${CANDIDATES.length})</h1>
${rows}
`;

writeFileSync(resolve("public/wordmarks.html"), html);
console.log("OK -> public/wordmarks.html");
