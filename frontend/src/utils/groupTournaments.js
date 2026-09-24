// Gom nhóm giải đấu cùng "sự kiện": cùng TÊN GỐC (phần trước dấu "•"/"-" —
// chỉ khác nội dung thi đấu) HOẶC cùng CỤM SÂN (location) trong ~2 ngày.
// Không có field liên kết ở backend nên gom phía client bằng union-find.

export function foldStr(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Tên gốc = phần trước dấu "•"/"·" hoặc " - "/" – " (bao quanh bởi khoảng trắng).
export function baseNameOf(name) {
  const s = String(name || "").trim();
  const parts = s.split(/\s+[•·]\s+|\s+[-–—]\s+/);
  return (parts[0] || s).trim();
}

// Nội dung con = phần khác biệt sau tên gốc (để hiển thị mỗi row).
export function subLabelOf(name, base) {
  const s = String(name || "").trim();
  const b = String(base || "").trim();
  if (b && s.toLowerCase().startsWith(b.toLowerCase())) {
    return s.slice(b.length).replace(/^[\s•·\-–—|]+/, "").trim();
  }
  const parts = s.split(/\s+[•·]\s+|\s+[-–—]\s+/);
  return parts.length > 1 ? parts.slice(1).join(" · ").trim() : "";
}

function dayNum(t) {
  const d = new Date(t?.startDate || t?.startAt || t?.createdAt || 0);
  const ms = d.getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : 0;
}

/**
 * Trả mảng nhóm THEO THỨ TỰ xuất hiện: [{ key, title, items[], isGroup }].
 * items giữ nguyên thứ tự trong list gốc.
 */
export function groupTournaments(list) {
  const arr = Array.isArray(list) ? list : [];
  const n = arr.length;
  if (n <= 1) {
    return arr.map((t) => ({
      key: String(t?._id || Math.random()),
      title: baseNameOf(t?.name),
      items: [t],
      isGroup: false,
    }));
  }
  const parent = arr.map((_, i) => i);
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  const base = arr.map((t) => foldStr(baseNameOf(t?.name)));
  const loc = arr.map((t) => foldStr(t?.location));
  const day = arr.map(dayNum);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sameName = base[i] && base[i] === base[j];
      const sameVenueClose =
        loc[i] && loc[i] === loc[j] && Math.abs(day[i] - day[j]) <= 2;
      if (sameName || sameVenueClose) union(i, j);
    }
  }

  const order = [];
  const map = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!map.has(r)) {
      map.set(r, []);
      order.push(r);
    }
    map.get(r).push(arr[i]);
  }

  return order.map((r) => {
    const items = map.get(r);
    return {
      key: String(items[0]?._id || r),
      title: groupTitle(items),
      items,
      isGroup: items.length > 1,
    };
  });
}

// Tiêu đề nhóm: tên gốc phổ biến nhất; nếu lệch thì lấy tiền tố chung theo từ.
function groupTitle(items) {
  if (!items?.length) return "";
  const counts = new Map();
  for (const t of items) {
    const b = baseNameOf(t?.name);
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  let best = "";
  let bestC = -1;
  for (const [b, c] of counts) {
    if (c > bestC) {
      best = b;
      bestC = c;
    }
  }
  return best || baseNameOf(items[0]?.name);
}

// Khoảng ngày hiển thị của nhóm (min startDate → max endDate/startDate).
export function groupDateRange(items) {
  let min = Infinity;
  let max = -Infinity;
  for (const t of items || []) {
    const s = new Date(t?.startDate || t?.startAt || 0).getTime();
    const e = new Date(t?.endDate || t?.startDate || t?.startAt || 0).getTime();
    if (Number.isFinite(s)) min = Math.min(min, s);
    if (Number.isFinite(e)) max = Math.max(max, e);
  }
  return {
    start: Number.isFinite(min) ? new Date(min) : null,
    end: Number.isFinite(max) ? new Date(max) : null,
  };
}
