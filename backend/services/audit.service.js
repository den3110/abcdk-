import AuditLog from "../models/auditLogModel.js";

/** ========== Helpers ========== */
const DEFAULT_IGNORE = new Set([
  "_id",
  "__v",
  "password",
  "createdAt",
  "updatedAt",
  "resetPasswordToken",
  "resetPasswordExpire",
  "refreshToken",
  "accessToken",
  "tokens",
]);

function isPlainObject(v) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function isPrimitive(v) {
  return v === null || (typeof v !== "object" && typeof v !== "function");
}

function isObjectIdLike(v) {
  // mongoose ObjectId thường có _bsontype = 'ObjectID' hoặc toString()
  return (
    !!v &&
    typeof v === "object" &&
    (v._bsontype === "ObjectID" ||
      (typeof v.toString === "function" &&
        /^[a-f\d]{24}$/i.test(String(v.toString()))))
  );
}

function normPrimitive(v) {
  // dùng để sort/compare primitive ổn định
  if (v === undefined) return "undefined";
  if (typeof v === "string") return `str:${v}`;
  if (typeof v === "number") return `num:${Number.isNaN(v) ? "NaN" : v}`;
  if (typeof v === "boolean") return `bool:${v}`;
  if (v === null) return "null";
  return `other:${String(v)}`;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;

  // Date
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : new Date(a).getTime();
    const tb = b instanceof Date ? b.getTime() : new Date(b).getTime();
    return ta === tb;
  }

  // ObjectId
  if (isObjectIdLike(a) && isObjectIdLike(b)) return String(a) === String(b);

  // Primitive
  if (isPrimitive(a) && isPrimitive(b)) return a === b;

  // Array
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;

    // nếu là array primitive => so như set (bỏ qua thứ tự)
    const aAllPrim = a.every(isPrimitive);
    const bAllPrim = b.every(isPrimitive);
    if (aAllPrim && bAllPrim) {
      const sa = a.map(normPrimitive).sort();
      const sb = b.map(normPrimitive).sort();
      for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
      return true;
    }

    // array object => so theo thứ tự
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // Plain object
  if (isPlainObject(a) && isPlainObject(b)) {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.length !== kb.length) return false;
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
    for (const k of ka) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }

  // fallback: compare string for special types (rare)
  return String(a) === String(b);
}

function safeClone(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch {
    return v;
  }
}

/**
 * diff sâu object -> ra danh sách {field, from, to}
 * - chỉ log khi THẬT SỰ khác (deepEqual)
 * - array primitive: ignore order (so như set) để tránh false-positive
 */
export function diffObjects(before, after, opts = {}) {
  const ignore = opts.ignore ?? DEFAULT_IGNORE;
  const maxChanges = opts.maxChanges ?? 200;

  const changes = [];

  const walk = (a, b, path) => {
    if (changes.length >= maxChanges) return;

    const lastKey = path.split(".").pop();
    if (ignore.has(lastKey)) return;

    // ✅ quan trọng: nếu deepEqual thì coi như không đổi
    if (deepEqual(a, b)) return;

    // null/undefined
    if (a == null || b == null) {
      changes.push({
        field: path,
        from: safeClone(a ?? null),
        to: safeClone(b ?? null),
      });
      return;
    }

    // array: nếu tới đây là chắc chắn khác
    if (Array.isArray(a) || Array.isArray(b)) {
      changes.push({ field: path, from: safeClone(a), to: safeClone(b) });
      return;
    }

    // object: recurse
    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of keys) {
        if (changes.length >= maxChanges) break;
        walk(a[k], b[k], path ? `${path}.${k}` : k);
      }
      return;
    }

    // primitive/special
    changes.push({ field: path, from: safeClone(a), to: safeClone(b) });
  };

  walk(before, after, "");
  return changes.filter((c) => c.field).slice(0, maxChanges);
}

export async function writeAuditLog({
  entityType,
  entityId,
  action = "UPDATE",
  actorId = null,
  actorKind = "user",
  ip = "",
  userAgent = "",
  before = {},
  after = {},
  note = "",
  ignoreFields,
  extraChanges = [],
  maxChanges,
}) {
  const changes = diffObjects(before, after, {
    ignore: ignoreFields ? new Set(ignoreFields) : undefined,
    maxChanges,
  });

  const finalChanges = [...changes, ...(extraChanges || [])].filter(Boolean);
  if (!finalChanges.length) return null;

  return AuditLog.create({
    entityType,
    entityId,
    action,
    actor: { id: actorId, kind: actorKind, ip, userAgent },
    changes: finalChanges,
    note,
  });
}
