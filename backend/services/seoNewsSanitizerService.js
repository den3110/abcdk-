import sanitizeHtml from "sanitize-html";

const ALLOWED_TAGS = [
  "p",
  "h2",
  "h3",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "a",
  "blockquote",
  "br",
];

const ALLOWED_ATTRIBUTES = {
  a: ["href", "title", "target", "rel"],
};

const ALLOWED_SCHEMES = ["http", "https", "mailto"];

export function sanitizeSeoNewsHtml(html = "") {
  return sanitizeHtml(String(html || ""), {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    transformTags: {
      a: (_tagName, attribs) => {
        const next = { ...attribs };
        if (!next.href) {
          delete next.href;
        }
        next.target = "_blank";
        next.rel = "noopener noreferrer";
        return { tagName: "a", attribs: next };
      },
    },
  });
}

export function stripSeoNewsHtmlToText(html = "") {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
