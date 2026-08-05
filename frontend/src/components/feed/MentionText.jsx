// Render text với @mention màu xanh clickable → mở /profile/:id
import React from "react";
import { Link as RouterLink } from "react-router-dom";
import { Box } from "@mui/material";

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
          <React.Fragment key={i}>{p.text}</React.Fragment>
        )
      )}
    </Box>
  );
}
