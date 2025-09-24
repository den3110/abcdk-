// utils/cccdParsing.js
export function stripVN(s = "") {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

export function normalizeDOB(s) {
  if (!s) return null;
  const m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
  if (!m) return null;
  const d = Number(m[1]),
    mo = Number(m[2]),
    y = Number(m[3]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function valueAfterLabel(lines, labelVariants) {
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    const norm = stripVN(raw).toLowerCase();
    for (const lab of labelVariants) {
      const key = stripVN(lab).toLowerCase();
      const pos = norm.indexOf(key);
      if (pos !== -1) {
        const tail = raw
          .slice(pos + lab.length)
          .replace(/^[\s:.-]+/, "")
          .trim();
        if (tail && tail.length >= 2) return tail;
        const next = (lines[i + 1] || "").trim();
        if (next) return next;
      }
    }
  }
  return null;
}

export function parseQRPayload(qr) {
  if (!qr) return {};
  try {
    const obj = JSON.parse(qr);
    return obj;
  } catch (e) {}
  const out = {};
  const parts = qr
    .split(/[\n|;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    const kv = p.split(/[:=]+/);
    if (kv.length >= 2) {
      const k = stripVN(kv[0]).toLowerCase().replace(/\s+/g, "_");
      const v = kv.slice(1).join(":").trim();
      out[k] = v;
    }
  }
  if (!Object.keys(out).length && parts.length) out._list = parts;
  return out;
}

export function mapQRToFields(parsed) {
  const lower = {};
  for (const [k, v] of Object.entries(parsed)) lower[k.toLowerCase()] = v;
  const pick = (...alts) => {
    for (const a of alts)
      if (lower[a] && String(lower[a]).trim()) return String(lower[a]).trim();
    return null;
  };

  let fullName = pick("ho_ten", "hoten", "name", "fullname", "ho_va_ten");
  let dobRaw = pick("ngay_sinh", "ngaysinh", "dob", "birthdate", "birth");
  let hometown = pick("que_quan", "quequan", "hometown", "noisinh", "address");

  if (!fullName || !dobRaw || !hometown) {
    const L = parsed._list;
    if (Array.isArray(L)) {
      if (!fullName) fullName = L[0] || L[1];
      if (!dobRaw)
        dobRaw = L.find((x) => /\d{2}[\/\-.]\d{2}[\/\-.]\d{4}/.test(x));
      if (!hometown)
        hometown = L.find((x) =>
          /tinh|thanh pho|huyen|quan|xa|phuong|,/.test(
            stripVN(String(x)).toLowerCase()
          )
        );
    }
  }
  const dob = normalizeDOB(dobRaw || "");
  return {
    fullName: fullName || null,
    dob: dob || null,
    hometown: hometown || null,
  };
}
