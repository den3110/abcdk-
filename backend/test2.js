import {
  normalize_for_search,
  build_vietnamese_regex,
} from "./utils/vnSearchNormalizer.js";

const q1 = "quang hoà trần";
const q2 = "quang hòa trần";

const n1 = normalize_for_search(q1);
const n2 = normalize_for_search(q2);

console.log("q1 (hoà): canonical =", n1.canonical, "| folded =", n1.folded);
console.log("q2 (hòa): canonical =", n2.canonical, "| folded =", n2.folded);

console.log("Regex q1:", build_vietnamese_regex(n1.folded));
console.log("Regex q2:", build_vietnamese_regex(n2.folded));
