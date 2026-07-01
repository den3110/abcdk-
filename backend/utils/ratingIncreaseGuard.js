const DECREASE_EPSILON = 1e-9;

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const formatScore = (value) => Number(value).toFixed(3);

export function getRatingDecreaseFields(current = {}, next = {}) {
  const fields = [];

  const currentSingle = toFiniteNumber(current.single);
  const nextSingle = toFiniteNumber(next.single);
  if (
    currentSingle !== null &&
    nextSingle !== null &&
    nextSingle < currentSingle - DECREASE_EPSILON
  ) {
    fields.push(
      `đơn ${formatScore(nextSingle)} < ${formatScore(currentSingle)}`,
    );
  }

  const currentDouble = toFiniteNumber(current.double);
  const nextDouble = toFiniteNumber(next.double);
  if (
    currentDouble !== null &&
    nextDouble !== null &&
    nextDouble < currentDouble - DECREASE_EPSILON
  ) {
    fields.push(
      `đôi ${formatScore(nextDouble)} < ${formatScore(currentDouble)}`,
    );
  }

  return fields;
}

export function assertNoRatingDecreaseForMod(current, next) {
  const decreases = getRatingDecreaseFields(current, next);
  if (!decreases.length) return;

  const error = new Error(
    `Mod chỉ được tăng trình, không được giảm điểm hiện tại (${decreases.join(
      ", ",
    )}).`,
  );
  error.statusCode = 403;
  throw error;
}
