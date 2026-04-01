import User from "../../models/userModel.js";

const ALLOWED_MUTATION_TYPES = new Set([
  "save_ui_preference",
  "save_bot_preference",
  "stage_form_draft",
]);

function trimText(value, maxLength = 160) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function sanitizeKey(value, fallback = "default") {
  const text = trimText(value, 96)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || fallback;
}

function sanitizeStringList(values, limit = 12, maxLength = 64) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((item) => trimText(item, maxLength))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

function sanitizeMutationPreview(input = {}) {
  const type = trimText(input.type || "", 48);
  if (!ALLOWED_MUTATION_TYPES.has(type)) {
    throw new Error("Loại mutation không hợp lệ");
  }

  return {
    type,
    title: trimText(input.title, 120),
    summary: trimText(input.summary, 240),
    changes: sanitizeStringList(input.changes, 8, 120),
    requiresConfirm: input.requiresConfirm !== false,
    payload: input.payload && typeof input.payload === "object" ? input.payload : {},
  };
}

function buildBotPreferencePayload(payload = {}) {
  return {
    assistantMode:
      payload.assistantMode === "operator"
        ? "operator"
        : payload.assistantMode === "analyst"
          ? "analyst"
          : "balanced",
    verificationMode:
      payload.verificationMode === "strict" ? "strict" : "balanced",
    reasoningMode:
      payload.reasoningMode === "force_reasoner" ? "force_reasoner" : "auto",
    answerDensity:
      payload.answerDensity === "compact_operator"
        ? "compact_operator"
        : "balanced",
    suggestionStyle:
      payload.suggestionStyle === "operator_first"
        ? "operator_first"
        : "default",
    updatedAt: new Date(),
  };
}

function buildUiPreferencePayload(payload = {}) {
  return {
    scopeKey: sanitizeKey(
      payload.scopeKey ||
        [payload.pageType, payload.pageSection, payload.pageView]
          .filter(Boolean)
          .join("_"),
      "page_default",
    ),
    pageType: trimText(payload.pageType, 64),
    pageSection: trimText(payload.pageSection, 64),
    pageView: trimText(payload.pageView, 64),
    path: trimText(payload.path, 160),
    activeLabels: sanitizeStringList(payload.activeLabels, 8, 48),
    filters: sanitizeStringList(payload.filters, 8, 64),
    sort: trimText(payload.sort, 64),
    updatedAt: new Date(),
  };
}

function buildFormDraftPayload(payload = {}) {
  return {
    draftKey: sanitizeKey(
      payload.draftKey ||
        [payload.pageType, payload.pageSection, payload.pageView]
          .filter(Boolean)
          .join("_"),
      "form_draft",
    ),
    title: trimText(payload.title, 120),
    pageType: trimText(payload.pageType, 64),
    pageSection: trimText(payload.pageSection, 64),
    pageView: trimText(payload.pageView, 64),
    path: trimText(payload.path, 160),
    data: payload.data && typeof payload.data === "object" ? payload.data : null,
    updatedAt: new Date(),
  };
}

export async function commitPikoraMutation({
  currentUser = null,
  mutationPreview,
  surface = "web",
} = {}) {
  const mutation = sanitizeMutationPreview(mutationPreview);

  if (!currentUser?._id) {
    return {
      ok: true,
      committed: false,
      localOnly: true,
      surface: surface === "mobile" ? "mobile" : "web",
      mutation,
    };
  }

  const userId = currentUser._id;
  const update = {};
  let applied = null;

  if (mutation.type === "save_bot_preference") {
    applied = buildBotPreferencePayload(mutation.payload);
    update.$set = {
      ...(update.$set || {}),
      "assistantPreferences.bot": applied,
    };
  }

  if (mutation.type === "save_ui_preference") {
    applied = buildUiPreferencePayload(mutation.payload);
    update.$set = {
      ...(update.$set || {}),
      [`assistantPreferences.ui.${applied.scopeKey}`]: applied,
    };
  }

  if (mutation.type === "stage_form_draft") {
    applied = buildFormDraftPayload(mutation.payload);
    update.$set = {
      ...(update.$set || {}),
      [`assistantPreferences.formDrafts.${applied.draftKey}`]: applied,
    };
  }

  await User.updateOne({ _id: userId }, update);

  return {
    ok: true,
    committed: true,
    localOnly: false,
    surface: surface === "mobile" ? "mobile" : "web",
    mutation: {
      ...mutation,
      payload: applied,
    },
  };
}
