import {
  normalize_for_search,
  build_vietnamese_regex,
} from "./utils/vnSearchNormalizer.js";
const q1 = normalize_for_search("quang hoà trần", {
  fold_case: true,
  fold_accents: true,
});
const q2 = normalize_for_search("quang hòa trần", {
  fold_case: true,
  fold_accents: true,
});

console.log("q1 folded:", q1.folded);
console.log("q2 folded:", q2.folded);

console.log("Regex q1:", build_vietnamese_regex(q1.folded));
console.log("Regex q2:", build_vietnamese_regex(q2.folded));

// test mongo regex execution
const re1 = new RegExp(build_vietnamese_regex(q1.folded), "i");
console.log(
  "re1 matches 'quang hòa trần(nfc)'",
  re1.test("quang hòa trần".normalize("NFC")),
);
console.log(
  "re1 matches 'quang hoà trần(nfc)'",
  re1.test("quang hoà trần".normalize("NFC")),
);
