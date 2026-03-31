import { normalizeCommandText } from "./commandPalette.js";

const DRAW_VIEW_MODES = new Set(["stage", "board", "history"]);

function includesAny(text, patterns = []) {
  return patterns.some((pattern) => text.includes(normalizeCommandText(pattern)));
}

function firstExisting(itemsById, ids = []) {
  return ids.find((id) => itemsById.has(id)) || null;
}

function existingPlan(itemsById, ids = []) {
  return Array.from(
    new Set(ids.filter((id) => id && itemsById.has(id))),
  );
}

function createRecipeAssistResult(config = {}) {
  const primaryId = config.primaryId || null;
  const topIds = Array.from(
    new Set([primaryId, ...(Array.isArray(config.topIds) ? config.topIds : [])].filter(Boolean)),
  );

  return {
    primaryId,
    topIds,
    suggestedScope: config.suggestedScope || null,
    queryRewrite: config.queryRewrite || "",
    reason: config.reason || "",
    confidence: Number(config.confidence || 0.88),
    suggestedPrompts: Array.isArray(config.suggestedPrompts)
      ? config.suggestedPrompts.filter(Boolean).slice(0, 4)
      : [],
    operatorMode: config.operatorMode || "pick",
    operatorTitle: config.operatorTitle || "",
    operatorHint: config.operatorHint || "",
    planIds: Array.isArray(config.planIds) ? config.planIds.filter(Boolean).slice(0, 4) : [],
    clarifyQuestion: config.clarifyQuestion || "",
    clarifyChoices: Array.isArray(config.clarifyChoices)
      ? config.clarifyChoices.filter(Boolean).slice(0, 4)
      : [],
  };
}

export function getDrawLiveViewFromSearch(search = "") {
  try {
    const params = new URLSearchParams(String(search || ""));
    const view = String(params.get("view") || "").trim().toLowerCase();
    return DRAW_VIEW_MODES.has(view) ? view : "stage";
  } catch {
    return "stage";
  }
}

export function buildCommandPaletteContextSummary({
  pathname = "",
  search = "",
  currentTournamentId = "",
  currentTournamentName = "",
  currentClubId = "",
  currentClubName = "",
  isAdmin = false,
  hasUserInfo = false,
}) {
  const routeKind = (() => {
    if (pathname === "/") return "home";
    if (pathname.startsWith("/my-tournaments")) return "myTournaments";
    if (pathname.startsWith("/profile")) return "profile";
    if (pathname.startsWith("/admin")) return "admin";
    if (pathname.startsWith("/news/")) return "newsArticle";
    if (pathname.startsWith("/news")) return "news";
    if (pathname.startsWith("/clubs/")) return "clubDetail";
    if (pathname.startsWith("/clubs")) return "clubs";
    if (pathname.endsWith("/draw/live")) return "tournamentDrawLive";
    if (pathname.startsWith("/tournament/")) return "tournamentDetail";
    if (pathname.startsWith("/live")) return "live";
    return "generic";
  })();

  return {
    routeKind,
    currentTournamentId: String(currentTournamentId || ""),
    currentTournamentName: String(currentTournamentName || ""),
    currentClubId: String(currentClubId || ""),
    currentClubName: String(currentClubName || ""),
    drawView: routeKind === "tournamentDrawLive" ? getDrawLiveViewFromSearch(search) : "",
    isAdmin: Boolean(isAdmin),
    isAuthenticated: Boolean(hasUserInfo),
  };
}

export function matchCommandPaletteRecipe({
  query,
  itemsById,
  context,
  t,
}) {
  const normalized = normalizeCommandText(query);
  if (!normalized || !itemsById?.size) return null;

  const currentTournamentId = String(context?.currentTournamentId || "");
  const currentClubId = String(context?.currentClubId || "");
  const isAdmin = Boolean(context?.isAdmin);
  const isDrawLive = context?.routeKind === "tournamentDrawLive";

  const copyCurrentLinkId = "action:copy-current-link";
  const openCurrentNewTabId = "action:open-current-new-tab";
  const toggleThemeId = "action:toggle-theme";
  const languageViId = "action:set-language-vi";
  const languageEnId = "action:set-language-en";
  const myTournamentsId = "page:my-tournaments";
  const profileId = "page:profile";
  const adminId = "page:admin";
  const adminNewsId = "context:admin:news";
  const adminUsersId = "context:admin:users";

  const tournamentOverviewId = currentTournamentId
    ? `context:tournament:overview:${currentTournamentId}`
    : "";
  const tournamentScheduleId = currentTournamentId
    ? `context:tournament:schedule:${currentTournamentId}`
    : "";
  const tournamentBracketId = currentTournamentId
    ? `context:tournament:bracket:${currentTournamentId}`
    : "";
  const tournamentRegisterId = currentTournamentId
    ? `context:tournament:register:${currentTournamentId}`
    : "";
  const tournamentManageId = currentTournamentId
    ? `context:tournament:manage:${currentTournamentId}`
    : "";
  const drawStageId = currentTournamentId
    ? `context:tournament:draw-stage:${currentTournamentId}`
    : "";
  const drawBoardId = currentTournamentId
    ? `context:tournament:draw-board:${currentTournamentId}`
    : "";
  const drawHistoryId = currentTournamentId
    ? `context:tournament:draw-history:${currentTournamentId}`
    : "";
  const clubHomeId = currentClubId ? `context:club:home:${currentClubId}` : "";
  const clubNewsId = currentClubId ? `context:club:news:${currentClubId}` : "";
  const clubEventsId = currentClubId ? `context:club:events:${currentClubId}` : "";

  const wantsCopyLink = includesAny(normalized, [
    "copy link",
    "sao chep link",
    "sao chep lien ket",
    "link trang nay",
  ]);
  const wantsNewTab = includesAny(normalized, [
    "mo tab moi",
    "open new tab",
    "tab moi",
  ]);

  if (wantsCopyLink && wantsNewTab) {
    const planIds = existingPlan(itemsById, [openCurrentNewTabId, copyCurrentLinkId]);
    if (planIds.length === 2) {
      const primaryId = planIds[0];
      return createRecipeAssistResult({
        primaryId,
        topIds: planIds,
        operatorMode: "plan",
        operatorTitle: `${itemsById.get(planIds[0])?.title} → ${itemsById.get(planIds[1])?.title}`,
        operatorHint: t("commandPalette.smart.hintAutomation"),
        planIds,
        suggestedScope: "actions",
        reason: t("commandPalette.smart.hintAutomation"),
        suggestedPrompts: [
          itemsById.get(copyCurrentLinkId)?.title,
          itemsById.get(openCurrentNewTabId)?.title,
        ],
      });
    }
  }

  if (
    includesAny(normalized, [
      "copy link",
      "sao chep link",
      "sao chep lien ket",
      "copy current url",
      "link trang nay",
    ])
  ) {
    const primaryId = firstExisting(itemsById, [copyCurrentLinkId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "actions",
        queryRewrite: itemsById.get(primaryId)?.title,
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (includesAny(normalized, ["open new tab", "mo tab moi", "tab moi"])) {
    const primaryId = firstExisting(itemsById, [openCurrentNewTabId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "actions",
        queryRewrite: itemsById.get(primaryId)?.title,
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (includesAny(normalized, ["dark", "toi", "theme", "giao dien", "light", "sang"])) {
    const primaryId = firstExisting(itemsById, [toggleThemeId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "actions",
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (includesAny(normalized, ["tieng viet", "vietnamese", "doi ngon ngu viet"])) {
    const primaryId = firstExisting(itemsById, [languageViId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "actions",
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (includesAny(normalized, ["english", "tieng anh", "doi ngon ngu anh"])) {
    const primaryId = firstExisting(itemsById, [languageEnId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "actions",
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (includesAny(normalized, ["giai cua toi", "my tournaments", "giai toi"])) {
    const primaryId = firstExisting(itemsById, [myTournamentsId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "pages",
        queryRewrite: itemsById.get(primaryId)?.title,
        reason: t("commandPalette.smart.hintContext"),
        suggestedPrompts: [
          t("commandPalette.context.tournamentBracket"),
          t("commandPalette.context.tournamentSchedule"),
        ],
      });
    }
  }

  if (includesAny(normalized, ["ho so", "profile", "tai khoan"])) {
    const primaryId = firstExisting(itemsById, [profileId]);
    if (primaryId) {
      return createRecipeAssistResult({
        primaryId,
        topIds: [primaryId],
        operatorTitle: itemsById.get(primaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "pages",
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (isAdmin && includesAny(normalized, ["admin news", "quan ly tin tuc", "vao admin news"])) {
    const planIds = existingPlan(itemsById, [adminId, adminNewsId]);
    if (planIds.length) {
      return createRecipeAssistResult({
        primaryId: planIds[planIds.length - 1],
        topIds: planIds,
        operatorMode: planIds.length > 1 ? "plan" : "pick",
        operatorTitle:
          planIds.length > 1
            ? `${itemsById.get(planIds[0])?.title} → ${itemsById.get(planIds[1])?.title}`
            : itemsById.get(planIds[0])?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        planIds,
        suggestedScope: "pages",
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (isAdmin && normalizeCommandText(normalized) === "admin") {
    const clarifyChoices = [
      itemsById.get(adminId)?.title,
      itemsById.get(adminNewsId)?.title,
      itemsById.get(adminUsersId)?.title,
    ].filter(Boolean);

    if (clarifyChoices.length > 1) {
      return createRecipeAssistResult({
        primaryId: firstExisting(itemsById, [adminId]),
        topIds: existingPlan(itemsById, [adminId, adminNewsId, adminUsersId]),
        operatorMode: "clarify",
        operatorTitle: t("commandPalette.smart.label"),
        operatorHint: t("commandPalette.smart.hintContext"),
        clarifyQuestion: t("commandPalette.smart.clarifyAdmin"),
        clarifyChoices,
        suggestedScope: "pages",
        reason: t("commandPalette.smart.hintContext"),
      });
    }
  }

  if (currentTournamentId) {
    if (
      includesAny(normalized, [
        "giai hien tai",
        "current tournament",
        "giai nay",
        "tournament now",
      ]) &&
      !includesAny(normalized, ["lich", "nhanh", "bracket", "dang ky", "quan ly", "boc tham"])
    ) {
      const clarifyChoices = [
        itemsById.get(tournamentOverviewId)?.title,
        itemsById.get(tournamentScheduleId)?.title,
        itemsById.get(tournamentBracketId)?.title,
        itemsById.get(drawStageId)?.title,
      ].filter(Boolean);

      if (clarifyChoices.length > 1) {
        return createRecipeAssistResult({
          primaryId: firstExisting(itemsById, [tournamentOverviewId]),
          topIds: existingPlan(itemsById, [
            tournamentOverviewId,
            tournamentScheduleId,
            tournamentBracketId,
            drawStageId,
          ]),
          operatorMode: "clarify",
          operatorTitle: t("commandPalette.smart.label"),
          operatorHint: t("commandPalette.smart.hintContext"),
          clarifyQuestion: t("commandPalette.smart.clarifyTournament"),
          clarifyChoices,
          suggestedScope: "tournaments",
          reason: t("commandPalette.smart.hintContext"),
        });
      }
    }

    if (includesAny(normalized, ["nhanh dau", "bracket", "draw bracket"])) {
      const wantsTournamentFlow = includesAny(normalized, [
        "giai hien tai",
        "current tournament",
        "mo giai",
        "xem giai",
      ]);
      const planIds = wantsTournamentFlow
        ? existingPlan(itemsById, [tournamentOverviewId, tournamentBracketId])
        : existingPlan(itemsById, [tournamentBracketId]);
      if (planIds.length) {
        const primaryId = planIds[planIds.length - 1];
        return createRecipeAssistResult({
          primaryId,
          topIds: planIds,
          operatorMode: planIds.length > 1 ? "plan" : "pick",
          operatorTitle:
            planIds.length > 1
              ? `${itemsById.get(planIds[0])?.title} → ${itemsById.get(planIds[1])?.title}`
              : itemsById.get(primaryId)?.title,
          operatorHint: t("commandPalette.smart.hintContext"),
          planIds,
          suggestedScope: "tournaments",
          reason: t("commandPalette.smart.hintContext"),
          suggestedPrompts: [
            itemsById.get(tournamentScheduleId)?.title,
            itemsById.get(drawStageId)?.title,
          ].filter(Boolean),
        });
      }
    }

    if (includesAny(normalized, ["lich thi dau", "schedule", "lich giai"])) {
      const planIds = existingPlan(itemsById, [tournamentOverviewId, tournamentScheduleId]);
      if (planIds.length) {
        const primaryId = planIds[planIds.length - 1];
        return createRecipeAssistResult({
          primaryId,
          topIds: planIds,
          operatorMode: planIds.length > 1 ? "plan" : "pick",
          operatorTitle:
            planIds.length > 1
              ? `${itemsById.get(planIds[0])?.title} → ${itemsById.get(planIds[1])?.title}`
              : itemsById.get(primaryId)?.title,
          operatorHint: t("commandPalette.smart.hintContext"),
          planIds,
          suggestedScope: "tournaments",
          reason: t("commandPalette.smart.hintContext"),
        });
      }
    }

    if (includesAny(normalized, ["dang ky giai", "register tournament", "dang ky"])) {
      const primaryId = firstExisting(itemsById, [tournamentRegisterId]);
      if (primaryId) {
        return createRecipeAssistResult({
          primaryId,
          topIds: [primaryId],
          operatorTitle: itemsById.get(primaryId)?.title,
          operatorHint: t("commandPalette.smart.hintContext"),
          suggestedScope: "tournaments",
          reason: t("commandPalette.smart.hintContext"),
        });
      }
    }

    if (includesAny(normalized, ["quan ly giai", "manage tournament"])) {
      const primaryId = firstExisting(itemsById, [tournamentManageId]);
      if (primaryId) {
        return createRecipeAssistResult({
          primaryId,
          topIds: [primaryId],
          operatorTitle: itemsById.get(primaryId)?.title,
          operatorHint: t("commandPalette.smart.hintContext"),
          suggestedScope: "tournaments",
          reason: t("commandPalette.smart.hintContext"),
        });
      }
    }
  }

  if (currentClubId) {
    if (includesAny(normalized, ["clb hien tai", "current club", "club home", "trang clb"])) {
      const primaryId = firstExisting(itemsById, [clubHomeId]);
      if (primaryId) {
        return createRecipeAssistResult({
          primaryId,
          topIds: [primaryId],
          operatorTitle: itemsById.get(primaryId)?.title,
          operatorHint: t("commandPalette.smart.hintContext"),
          suggestedScope: "clubs",
          reason: t("commandPalette.smart.hintContext"),
          suggestedPrompts: [
            itemsById.get(clubNewsId)?.title,
            itemsById.get(clubEventsId)?.title,
          ].filter(Boolean),
        });
      }
    }

    if (includesAny(normalized, ["tin clb", "club news"])) {
      const primaryId = firstExisting(itemsById, [clubNewsId]);
      if (primaryId) {
        return createRecipeAssistResult({
          primaryId,
          topIds: [primaryId],
          operatorTitle: itemsById.get(primaryId)?.title,
          operatorHint: t("commandPalette.smart.hintContext"),
          suggestedScope: "clubs",
          reason: t("commandPalette.smart.hintContext"),
        });
      }
    }
  }

  if (currentTournamentId && includesAny(normalized, ["boc tham", "draw live", "draw", "live draw"])) {
    const planIds = existingPlan(itemsById, [drawStageId, drawBoardId, drawHistoryId]);

    if (isDrawLive && !includesAny(normalized, ["san khau", "stage", "bang", "board", "history", "lich su"])) {
      const clarifyChoices = [
        itemsById.get(drawStageId)?.title,
        itemsById.get(drawBoardId)?.title,
        itemsById.get(drawHistoryId)?.title,
      ].filter(Boolean);

      if (clarifyChoices.length > 1) {
        return createRecipeAssistResult({
          primaryId: firstExisting(itemsById, [drawStageId]),
          topIds: planIds,
          operatorMode: "clarify",
          operatorTitle: t("commandPalette.smart.label"),
          operatorHint: t("commandPalette.smart.hintContext"),
          clarifyQuestion: t("commandPalette.smart.clarifyDrawLive"),
          clarifyChoices,
          suggestedScope: "tournaments",
          reason: t("commandPalette.smart.hintContext"),
        });
      }
    }

    const specificPrimaryId = firstExisting(itemsById, [
      includesAny(normalized, ["san khau", "stage"]) ? drawStageId : "",
      includesAny(normalized, ["bang", "board"]) ? drawBoardId : "",
      includesAny(normalized, ["history", "lich su"]) ? drawHistoryId : "",
      drawStageId,
    ]);

    if (specificPrimaryId) {
      return createRecipeAssistResult({
        primaryId: specificPrimaryId,
        topIds: existingPlan(itemsById, [specificPrimaryId, ...planIds]),
        operatorTitle: itemsById.get(specificPrimaryId)?.title,
        operatorHint: t("commandPalette.smart.hintContext"),
        suggestedScope: "tournaments",
        reason: t("commandPalette.smart.hintContext"),
        suggestedPrompts: [
          itemsById.get(drawBoardId)?.title,
          itemsById.get(drawHistoryId)?.title,
        ].filter(Boolean),
      });
    }
  }

  return null;
}
