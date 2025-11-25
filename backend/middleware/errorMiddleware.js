const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

const errorHandler = (err, req, res, next) => {
  // Ưu tiên err.statusCode nếu có
  let statusCode =
    typeof err.statusCode === "number"
      ? err.statusCode
      : res.statusCode === 200
      ? 500
      : res.statusCode;

  let message = err.message || "Đã có lỗi xảy ra.";

  // Nếu là lỗi cast ObjectId của Mongoose -> 404
  if (err.name === "CastError" && err.kind === "ObjectId") {
    statusCode = 404;
    message = "Resource not found";
  }

  const payload = {
    message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  };

  // Nếu có remainingResetTime (quota search), trả kèm cho FE
  if (typeof err.remainingResetTime === "number") {
    payload.remainingResetTime = err.remainingResetTime;
  }

  res.status(statusCode).json(payload);
};

export { notFound, errorHandler };
