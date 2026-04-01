const fs = require("fs");
const path = "frontend/src/components/LogoAnimationMorph.jsx";
let text = fs.readFileSync(path, "utf8");
text = text.replace(/\r\n/g, "\n");

function insertAfter(anchor, insert) {
  if (!text.includes(anchor)) {
    throw new Error(`Anchor not found: ${anchor}`);
  }
  text = text.replace(anchor, `${anchor}\n${insert}`);
}

insertAfter('circle.style.transformOrigin = "center";', '    circle.style.transformBox = "fill-box";');
insertAfter('square.style.transformOrigin = "center";', '    square.style.transformBox = "fill-box";');
insertAfter('triangle.style.transformOrigin = "center";', '    triangle.style.transformBox = "fill-box";');
insertAfter('star.style.transformOrigin = "center";', '    star.style.transformBox = "fill-box";');

// Remove rotations by forcing to 0
text = text.replace(/rotation:\s*-?\d+(?:\.\d+)?/g, 'rotation: 0');

fs.writeFileSync(path, text, "utf8");
console.log("Adjusted GSAP rotations and transform box");
