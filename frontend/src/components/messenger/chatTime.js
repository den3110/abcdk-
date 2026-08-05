// Helper format thời gian tin nhắn cho chat UI (web).
// - shouldShowTimeSeparator: hiện time header giữa 2 tin nếu gap > 5 phút hoặc
//   sang ngày mới (Messenger/iMessage style)
// - fmtSeparator: "HH:mm" cùng ngày / "Hôm qua HH:mm" / "dd/MM HH:mm" / "dd/MM/yyyy HH:mm"
// - fmtBubbleTime: "HH:mm" tin cùng ngày, "dd/MM HH:mm" khác ngày (dùng tooltip / dưới bubble)

const MS_5MIN = 5 * 60 * 1000;

function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function pad(n) {
  return String(n).padStart(2, "0");
}

export function shouldShowTimeSeparator(current, prev) {
  if (!current?.createdAt) return false;
  if (!prev?.createdAt) return true; // Message đầu tiên → hiện time header
  const c = new Date(current.createdAt);
  const p = new Date(prev.createdAt);
  if (!sameDay(c, p)) return true;
  if (c.getTime() - p.getTime() > MS_5MIN) return true;
  return false;
}

export function fmtSeparator(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return time;
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(d, y)) return `Hôm qua ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const dm = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  if (sameYear) return `${dm} ${time}`;
  return `${dm}/${d.getFullYear()} ${time}`;
}

export function fmtBubbleTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay(d, now)) return time;
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${time}`;
}
