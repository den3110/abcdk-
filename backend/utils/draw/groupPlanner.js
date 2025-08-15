// utils/draw/groupPlanner.js
// LẬP KẾ HOẠCH KÍCH THƯỚC NHÓM THEO SỐ ĐỘI n + CHÍNH SÁCH DƯ/THIẾU
export function planGroups(
  n,
  {
    groupSize = null,
    groupCount = null,
    autoFit = true,
    allowUneven = true,
    byePolicy = "none", // "pad" | "none"
    overflowPolicy = "grow", // "grow" | "extraGroup"
    underflowPolicy = "shrink", // "shrink" | "byes"
    minSize = 3,
    maxSize = 16,
  } = {}
) {
  if (!Number.isFinite(n) || n <= 0) return { groupSizes: [], byes: 0 };

  let gSize = groupSize
    ? Math.max(minSize, Math.min(maxSize, Number(groupSize)))
    : null;
  let gCount =
    Number.isFinite(groupCount) && groupCount > 0 ? Number(groupCount) : null;

  if (!gSize && !gCount) {
    // fallback hợp lý (4~6/nghỉ): dùng sqrt(n)
    gSize = Math.max(minSize, Math.min(maxSize, Math.round(Math.sqrt(n))));
  }
  if (!gCount && gSize) gCount = Math.ceil(n / gSize);
  if (!gSize && gCount) gSize = Math.ceil(n / gCount);

  gSize = Math.max(minSize, Math.min(maxSize, gSize));
  gCount = Math.max(1, gCount);

  const capacity = gCount * gSize;

  if (capacity === n) {
    return { groupSizes: Array(gCount).fill(gSize), byes: 0 };
  }

  // UNDERFLOW (capacity > n): thiếu đội so với sức chứa
  if (capacity > n) {
    const deficit = capacity - n; // slot trống

    if (underflowPolicy === "byes" || byePolicy === "pad") {
      // giữ size cố định, nhét BYE
      return { groupSizes: Array(gCount).fill(gSize), byes: deficit };
    }

    // shrink: co nhóm xuống (không dưới minSize), ưu tiên lệch ±1
    let sizes = Array(gCount).fill(gSize);
    let needReduce = deficit;

    if (allowUneven) {
      for (let i = 0; i < gCount && needReduce > 0; i++) {
        const canReduce = Math.min(needReduce, sizes[i] - minSize);
        sizes[i] -= canReduce;
        needReduce -= canReduce;
      }
      if (autoFit && needReduce > 0) {
        // vẫn thừa nhiều → căn lại trung bình
        const avg = Math.floor(n / gCount);
        const rem = n % gCount;
        sizes = Array.from(
          { length: gCount },
          (_, i) => avg + (i < rem ? 1 : 0)
        );
        needReduce = 0;
      }
      if (needReduce > 0) {
        // vẫn thừa → buộc dùng BYE cho phần còn lại
        return { groupSizes: sizes, byes: needReduce };
      }
      return { groupSizes: sizes, byes: 0 };
    }
    // không cho lệch → BYE
    return { groupSizes: Array(gCount).fill(gSize), byes: deficit };
  }

  // OVERFLOW (capacity < n): dư đội so với sức chứa
  const overflow = n - capacity;
  if (overflow <= 0) return { groupSizes: Array(gCount).fill(gSize), byes: 0 };

  if (overflowPolicy === "extraGroup") {
    const extra = Math.ceil(overflow / gSize);
    const newCount = gCount + extra;
    const avg = Math.floor(n / newCount);
    const rem = n % newCount;
    const sizes = Array.from(
      { length: newCount },
      (_, i) => avg + (i < rem ? 1 : 0)
    );
    return { groupSizes: sizes, byes: 0 };
  }

  // grow: tăng 1 vài nhóm lên size+1 (lệch ±1)
  if (allowUneven) {
    const sizes = Array.from(
      { length: gCount },
      (_, i) => gSize + (i < overflow ? 1 : 0)
    );
    return { groupSizes: sizes, byes: 0 };
  }

  // không cho lệch → tạo thêm nhóm
  const extra = Math.ceil(overflow / gSize);
  const newCount = gCount + extra;
  const avg = Math.floor(n / newCount);
  const rem = n % newCount;
  const sizes = Array.from(
    { length: newCount },
    (_, i) => avg + (i < rem ? 1 : 0)
  );
  return { groupSizes: sizes, byes: 0 };
}
