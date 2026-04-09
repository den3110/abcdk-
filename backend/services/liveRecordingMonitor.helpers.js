function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toActivityMs(value) {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function sanitizeSegmentMeta(meta) {
  return meta && typeof meta === "object" ? { ...meta } : {};
}

export function isPlaceholderSegment(segment) {
  return String(segment?.uploadStatus || "").trim().toLowerCase() === "presigned";
}

function getLatestSegmentActivityMs(recording, { includeStartedAt = true } = {}) {
  let latestMs = 0;

  for (const segment of recording?.segments || []) {
    const meta = sanitizeSegmentMeta(segment?.meta);
    latestMs = Math.max(
      latestMs,
      toActivityMs(segment?.uploadedAt),
      toActivityMs(meta.lastPartUploadedAt),
      toActivityMs(meta.completedAt),
      includeStartedAt ? toActivityMs(meta.startedAt) : 0
    );
  }

  return latestMs;
}

export function getLatestSegmentActivityDate(
  recording,
  { includeStartedAt = true } = {}
) {
  const latestMs = getLatestSegmentActivityMs(recording, {
    includeStartedAt,
  });
  return latestMs > 0 ? new Date(latestMs) : null;
}

export function getLatestRecordingActivityDate(
  recording,
  { includeStartedAt = true, includeLifecycleTimestamps = false } = {}
) {
  let latestMs = getLatestSegmentActivityMs(recording, {
    includeStartedAt,
  });

  if (includeLifecycleTimestamps) {
    latestMs = Math.max(
      latestMs,
      toActivityMs(recording?.updatedAt),
      toActivityMs(recording?.createdAt)
    );
  }

  return latestMs > 0 ? new Date(latestMs) : null;
}

export function summarizeSegments(
  segments = [],
  recording = null,
  { includeDetailedSegments = true } = {}
) {
  const sortedSegments = [...segments].sort((a, b) => a.index - b.index);
  const placeholderSegments = sortedSegments.filter(isPlaceholderSegment);
  const materializedSegments = sortedSegments.filter(
    (segment) => !isPlaceholderSegment(segment)
  );
  const uploadedSegments = materializedSegments.filter(
    (segment) => segment.uploadStatus === "uploaded"
  );
  const uploadingSegments = materializedSegments.filter((segment) =>
    segment.uploadStatus === "uploading_parts"
  );
  const failedSegments = materializedSegments.filter(
    (segment) => segment.uploadStatus === "failed"
  );
  const abortedSegments = materializedSegments.filter(
    (segment) => segment.uploadStatus === "aborted"
  );
  const latestSegment =
    materializedSegments[materializedSegments.length - 1] || null;
  const activeUploadSegment =
    [...uploadingSegments].sort((a, b) => b.index - a.index)[0] || null;

  const buildSegmentProgress = (segment) => {
    if (!segment) return null;
    const meta = sanitizeSegmentMeta(segment.meta);
    const completedParts = Array.isArray(meta.completedParts)
      ? meta.completedParts
      : [];
    const rawCompletedBytes = completedParts.reduce(
      (sum, part) => sum + toNumber(part?.sizeBytes),
      0
    );
    const totalSizeBytes =
      toNumber(meta.totalSizeBytes) ||
      toNumber(meta.segmentSizeBytes) ||
      toNumber(segment.sizeBytes);
    const completedBytes =
      rawCompletedBytes > 0
        ? rawCompletedBytes
        : segment.uploadStatus === "uploaded"
        ? totalSizeBytes
        : 0;
    const partSizeBytes = toNumber(meta.partSizeBytes);
    const percent =
      totalSizeBytes > 0
        ? Math.max(
            0,
            Math.min(100, Math.round((completedBytes / totalSizeBytes) * 100))
          )
        : segment.uploadStatus === "uploaded"
        ? 100
        : 0;
    const totalParts =
      partSizeBytes > 0 && totalSizeBytes > 0
        ? Math.max(1, Math.ceil(totalSizeBytes / partSizeBytes))
        : 0;
    return {
      index: segment.index,
      objectKey: segment.objectKey || "",
      storageTargetId:
        String(
          segment?.storageTargetId || recording?.r2TargetId || ""
        ).trim() || null,
      bucketName:
        String(segment?.bucketName || recording?.r2BucketName || "").trim() ||
        null,
      etag: segment.etag || "",
      uploadStatus: segment.uploadStatus,
      isPlaceholder: isPlaceholderSegment(segment),
      isFinal: Boolean(segment.isFinal),
      sizeBytes: toNumber(segment.sizeBytes),
      durationSeconds: toNumber(segment.durationSeconds),
      uploadedAt: segment.uploadedAt || null,
      completedPartCount: completedParts.length,
      completedBytes,
      totalSizeBytes,
      percent,
      partSizeBytes,
      totalParts,
      lastPartUploadedAt: meta.lastPartUploadedAt || null,
      startedAt: meta.startedAt || null,
    };
  };

  const detailedSegments = includeDetailedSegments
    ? sortedSegments.map(buildSegmentProgress).filter(Boolean)
    : [];
  return {
    totalSegments: materializedSegments.length,
    placeholderSegments: placeholderSegments.length,
    uploadedSegments: uploadedSegments.length,
    uploadingSegments: uploadingSegments.length,
    failedSegments: failedSegments.length,
    abortedSegments: abortedSegments.length,
    totalUploadedBytes: uploadedSegments.reduce(
      (sum, segment) => sum + toNumber(segment.sizeBytes),
      0
    ),
    finalSegmentUploaded: uploadedSegments.some((segment) => segment.isFinal),
    segments: detailedSegments,
    latestSegment: buildSegmentProgress(latestSegment),
    activeUploadSegment: buildSegmentProgress(activeUploadSegment),
  };
}
