const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

const insertAfter = 'const text = "PickleTour";';
if (text.includes('const fontSize =')) {
  // already inserted
} else {
  if (!text.includes(insertAfter)) {
    throw new Error("Anchor not found: text constant");
  }
  text = text.replace(
    insertAfter,
    `${insertAfter}\n    const fontSize = isMobile ? \"1.35rem\" : \"1.5rem\";\n    const letterSpacing = \"-0.5px\";`
  );
}

const minWidthLine = /logoWrapper\.style\.minWidth = [^;]+;/;
if (!minWidthLine.test(text)) {
  throw new Error("Anchor not found: minWidth line");
}

const minWidthReplacement = [
  'if (typeof window !== "undefined" && document.body) {',
  '      const measureSpan = document.createElement("span");',
  '      measureSpan.textContent = text;',
  '      measureSpan.style.position = "absolute";',
  '      measureSpan.style.visibility = "hidden";',
  '      measureSpan.style.whiteSpace = "nowrap";',
  '      measureSpan.style.fontSize = fontSize;',
  '      measureSpan.style.fontWeight = "800";',
  '      measureSpan.style.letterSpacing = letterSpacing;',
  '      measureSpan.style.fontFamily =',
  '        window.getComputedStyle(container).fontFamily || "inherit";',
  '      document.body.appendChild(measureSpan);',
  '      const fullWidth = Math.ceil(measureSpan.getBoundingClientRect().width) + 6;',
  '      measureSpan.remove();',
  '      logoWrapper.style.minWidth = `\${fullWidth}px`;',
  '    }',
].join("\n");

text = text.replace(minWidthLine, minWidthReplacement);

const pSpanBlock = /pSpan\.style\.fontSize = [^;]+;\n\s*pSpan\.style\.letterSpacing = [^;]+;/;
if (!pSpanBlock.test(text)) {
  throw new Error("Anchor not found: pSpan font styles");
}
text = text.replace(
  pSpanBlock,
  `pSpan.style.fontSize = fontSize;\n    pSpan.style.letterSpacing = letterSpacing;`
);

const spanBlock = /span\.style\.fontSize = [^;]+;\n\s*span\.style\.letterSpacing = [^;]+;/;
if (!spanBlock.test(text)) {
  throw new Error("Anchor not found: remaining span font styles");
}
text = text.replace(
  spanBlock,
  `span.style.fontSize = fontSize;\n      span.style.letterSpacing = letterSpacing;`
);

fs.writeFileSync(path, text, "utf8");
console.log("Updated logo width reservation");
