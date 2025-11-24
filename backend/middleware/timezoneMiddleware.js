// src/middleware/timezoneMiddleware.js
export function timezoneMiddleware(req, _res, next) {
  const tzHeader = req.headers["x-timezone"];
  const offsetHeader = req.headers["x-timezone-offset"];
  const gmtHeader = req.headers["x-timezone-gmt"];

  req.userTimezone =
    typeof tzHeader === "string" && tzHeader.trim() ? tzHeader.trim() : "UTC";

  if (typeof offsetHeader === "string") {
    const n = Number(offsetHeader);
    if (!Number.isNaN(n)) req.userTimezoneOffset = n; // phút
  }

  if (typeof gmtHeader === "string") {
    req.userTimezoneGmt = gmtHeader;
  }

  next();
}
