// Render text với @mention màu xanh clickable → mở /profile/:id
// + tự nhận diện URL (http/https/www) thành link bấm được (mở tab mới).
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box } from "@mui/material";

// Bắt http(s)://... hoặc www...., cắt dấu câu ở cuối.
const URL_RE = /((?:https?:\/\/|www\.)[^\s<]+[^\s<.,;:!?)\]}'"])/gi;

// Tách 1 đoạn text thành các node: text thường + <a> cho URL.
function renderTextWithLinks(text, keyPrefix) {
  if (!text) return [text];
  const nodes = [];
  let last = 0;
  let m;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    const url = m[0];
    const start = m.index;
    if (start > last) nodes.push(text.slice(last, start));
    const href = url.startsWith("http") ? url : `https://${url}`;
    nodes.push(
      <a
        key={`${keyPrefix}-u-${start}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        style={{ color: "inherit", textDecoration: "underline", wordBreak: "break-all" }}
      >
        {url}
      </a>
    );
    last = start + url.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export default function MentionText({ content, mentions, sx, style }) {
  if (!content) return null;
  const byNick = new Map();
  const byName = new Map();
  (mentions || []).forEach((u) => {
    if (u?.nickname) byNick.set(String(u.nickname).toLowerCase(), u);
    if (u?.name) byName.set(String(u.name).toLowerCase(), u);
  });

  const re = /(^|\s)@([\p{L}\p{N}._-]+(?: [\p{L}\p{N}._-]+){0,2})/gu;
  const parts = [];
  let lastIndex = 0;
  let m;
  while ((m = re.exec(content))) {
    const [, lead, raw] = m;
    const startIdx = m.index + lead.length;
    if (startIdx > lastIndex) {
      parts.push({ type: "text", text: content.slice(lastIndex, startIdx) });
    }
    const words = raw.split(/\s+/);
    let matched = null;
    let matchedLen = 0;
    for (let i = words.length; i > 0; i--) {
      const candidate = words.slice(0, i).join(" ");
      const u =
        byNick.get(candidate.toLowerCase()) ||
        byName.get(candidate.toLowerCase());
      if (u) {
        matched = u;
        matchedLen = candidate.length;
        break;
      }
    }
    if (matched) {
      parts.push({ type: "mention", text: "@" + raw.slice(0, matchedLen), user: matched });
      lastIndex = startIdx + 1 + matchedLen;
    } else {
      parts.push({ type: "text", text: "@" + raw });
      lastIndex = startIdx + 1 + raw.length;
    }
  }
  if (lastIndex < content.length) {
    parts.push({ type: "text", text: content.slice(lastIndex) });
  }

  return (
    <Box component="span" sx={{ whiteSpace: "pre-wrap", ...sx }} style={style}>
      {parts.map((p, i) =>
        p.type === "mention" ? (
          <RouterLink
            key={i}
            to={`/profile/${p.user._id}`}
            style={{
              color: "#1877F2",
              fontWeight: 700,
              textDecoration: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
            onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
          >
            {p.text}
          </RouterLink>
        ) : (
          <React.Fragment key={i}>{renderTextWithLinks(p.text, i)}</React.Fragment>
        )
      )}
    </Box>
  );
}
