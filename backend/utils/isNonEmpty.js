// utils/isNonEmpty.js

/**
 * Kiểm tra giá trị có "không rỗng" theo ngữ cảnh.
 * - null/undefined  -> false
 * - string          -> trim().length > 0
 * - number          -> Number.isFinite(n) (có thể coi 0 là rỗng nếu options.treatZeroAsEmpty=true)
 * - boolean         -> luôn coi là có giá trị (có thể coi false là rỗng nếu options.treatFalseAsEmpty=true)
 * - Date            -> hợp lệ khi !isNaN(date.getTime())
 * - Array/TypedArr  -> length > 0
 * - Map/Set         -> size > 0
 * - Object thường   -> có ít nhất 1 own enumerable key
 * - Các kiểu khác   -> true (coi như có giá trị)
 *
 * @param {any} v
 * @param {Object} [options]
 * @param {boolean} [options.treatZeroAsEmpty=false]  - nếu true, 0 sẽ coi là rỗng
 * @param {boolean} [options.treatFalseAsEmpty=false] - nếu true, false sẽ coi là rỗng
 * @returns {boolean}
 */
export function isNonEmpty(v, options = {}) {
  const { treatZeroAsEmpty = false, treatFalseAsEmpty = false } = options;

  if (v === null || v === undefined) return false;

  const t = typeof v;

  if (t === "string") return v.trim().length > 0;

  if (t === "number") {
    if (!Number.isFinite(v)) return false;
    return treatZeroAsEmpty ? v !== 0 : true;
  }

  if (t === "boolean") {
    return treatFalseAsEmpty ? v === true : true;
  }

  if (v instanceof Date) {
    return !Number.isNaN(v.getTime());
  }

  // Array hoặc TypedArray
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    // ArrayBuffer.isView trả true cho TypedArray/DataView
    return v.length > 0;
  }

  if (v instanceof Map || v instanceof Set) {
    return v.size > 0;
  }

  if (t === "object") {
    return Object.keys(v).length > 0;
  }

  return true;
}

export default isNonEmpty;
