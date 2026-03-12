import fs from 'fs';

const corrupted = "Káº¿t ná»‘i cá»™ng Ä‘á»“ng & quáº£n lÃ½ giáº£i Ä‘áº¥u thá»ƒ thao";

function fixEncoding(str) {
  try {
    const buf = Buffer.from(str, 'latin1');
    const fixed = buf.toString('utf8');
    return fixed;
  } catch (e) {
    return str;
  }
}

console.log("Original:", corrupted);
console.log("Fixed:", fixEncoding(corrupted));
