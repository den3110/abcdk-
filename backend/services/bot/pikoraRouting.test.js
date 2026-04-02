import test from "node:test";
import assert from "node:assert/strict";
import {
  buildClarificationStateForTest,
  classifyRouteForTest,
  looksLikeTournamentProgressQuestion,
  looksLikeTournamentAvailabilityQuestion,
  pickTournamentStatusFromMessage,
  resolveContextUsageMode,
} from "./pikoraService.js";

test("detects tournament status queries with and without accents", () => {
  const cases = [
    ["co Giai nao dang dien ra?", "ongoing"],
    ["co giai nao dang dien ra?", "ongoing"],
    ["Giai nao sap dien ra?", "upcoming"],
    ["giai nao sap dien ra?", "upcoming"],
    ["Co giai nao da ket thuc chua?", "finished"],
  ];

  for (const [message, expectedStatus] of cases) {
    assert.equal(
      pickTournamentStatusFromMessage(message),
      expectedStatus,
      `Unexpected status for "${message}"`,
    );
    assert.equal(
      looksLikeTournamentAvailabilityQuestion(message),
      true,
      `Expected tournament availability detection for "${message}"`,
    );
  }
});

test("routes tournament availability queries to tournament search", () => {
  const route = classifyRouteForTest("co Giai nao dang dien ra?", {}, null);

  assert.equal(route.kind, "tournament");
  assert.equal(route.toolPlan?.[0]?.name, "search_tournaments");
  assert.equal(route.toolPlan?.[0]?.args?.status, "ongoing");
});

test("keeps true knowledge queries on the knowledge route", () => {
  const route = classifyRouteForTest("Cach dang ky tai khoan la gi?", {}, null);

  assert.equal(route.kind, "knowledge");
  assert.equal(route.toolPlan?.[0]?.name, "search_knowledge");
});

test("disables memory follow-up routing when session focus override is off", () => {
  const route = classifyRouteForTest(
    "lich thi dau",
    {
      sessionFocus: {
        activeType: "tournament",
        tournament: {
          entityId: "demo-tournament-id",
          label: "Giai Demo",
          path: "/tournament/demo-tournament-id",
        },
      },
      sessionFocusOverride: {
        mode: "off",
      },
    },
    null,
  );

  assert.ok(
    !route.toolPlan?.some(
      (step) =>
        step?.name === "get_tournament_schedule" &&
        step?.args?.tournamentId === "demo-tournament-id",
    ),
  );
});

test("uses pinned session focus override for player follow-up queries", () => {
  const route = classifyRouteForTest(
    "rating bao nhieu",
    {
      sessionFocusOverride: {
        mode: "pin",
        sessionFocus: {
          activeType: "player",
          player: {
            entityId: "demo-player-id",
            label: "Nguoi choi Demo",
            path: "/user/demo-player-id",
          },
        },
      },
    },
    null,
  );

  assert.equal(route.kind, "player");
  assert.equal(route.toolPlan?.[0]?.name, "get_user_profile_detail");
  assert.equal(route.toolPlan?.[0]?.args?.userId, "demo-player-id");
});

test("keeps generic knowledge queries on knowledge route even on leaderboard pages", () => {
  const context = {
    pageType: "leaderboard",
    pageSnapshot: {
      pageType: "leaderboard",
      sectionTitle: "Bang xep hang",
      activeLabels: ["Diem trinh"],
      visibleActions: ["Ho so", "Cham trinh", "Xem KYC"],
      highlights: ["Bang xep hang"],
    },
  };

  for (const message of [
    "pickleball la gi",
    "pickleball la gi",
    "vi sao phai khoi dong ky",
  ]) {
    const route = classifyRouteForTest(message, context, null);
    assert.equal(route.kind, "knowledge");
    assert.equal(route.toolPlan?.[0]?.name, "search_knowledge");
  }
});

test("routes leaderboard top queries to leaderboard tools even on tournament list pages", () => {
  const route = classifyRouteForTest(
    "top 1 bang xep hang hien tai la ai",
    {
      pageType: "tournament_list",
      pageSnapshot: {
        pageType: "tournament_list",
        sectionTitle: "Giai dau",
        activeLabels: ["Sap dien ra"],
        stats: {
          currentTab: "upcoming",
          total: 35,
          visible: 0,
        },
      },
    },
    null,
  );

  assert.equal(route.kind, "player");
  assert.equal(route.toolPlan?.[0]?.name, "get_leaderboard");
  assert.equal(route.toolPlan?.[0]?.args?.limit, 3);
});

test("routes tournament progress questions to tournament progress tools", () => {
  const route = classifyRouteForTest(
    "giai nay con bao nhieu tran",
    {
      tournamentId: "demo-tournament-id",
      pageType: "tournament_schedule",
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.ok(
    route.toolPlan?.some((step) => step?.name === "get_tournament_progress"),
  );
});

test("detects broader tournament progress phrases", () => {
  assert.equal(looksLikeTournamentProgressQuestion("co bao nhieu tran xong roi"), true);
  assert.equal(looksLikeTournamentProgressQuestion("da xong bao nhieu tran"), true);
});

test("routes completed-match questions to tournament progress tools", () => {
  const route = classifyRouteForTest(
    "co bao nhieu tran xong roi",
    {
      tournamentId: "demo-tournament-id",
      pageType: "tournament_bracket",
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.ok(
    route.toolPlan?.some((step) => step?.name === "get_tournament_progress"),
  );
});

test("routes current article summaries to news tools instead of knowledge", () => {
  const route = classifyRouteForTest(
    "bai nay noi gi",
    {
      newsSlug: "demo-news-slug",
      pageType: "news_detail",
      pageTitle: "Demo news",
    },
    null,
  );

  assert.equal(route.kind, "news");
  assert.equal(route.toolPlan?.[0]?.name, "search_news");
});

test("routes current club updates to club tools instead of knowledge", () => {
  const route = classifyRouteForTest(
    "clb nay co gi moi",
    {
      clubId: "demo-club-id",
      pageType: "club_detail",
    },
    null,
  );

  assert.equal(route.kind, "club");
  assert.ok(
    route.toolPlan?.some((step) =>
      ["get_club_details", "search_clubs"].includes(step?.name),
    ),
  );
});

test("uses session focus memory to resolve tournament follow-up queries", () => {
  const route = classifyRouteForTest(
    "lich thi dau",
    {
      sessionFocus: {
        activeType: "tournament",
        tournament: {
          entityId: "demo-tournament-id",
          label: "Giai Demo",
          path: "/tournament/demo-tournament-id",
        },
      },
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.ok(
    route.toolPlan?.some(
      (step) =>
        step?.name === "get_tournament_schedule" &&
        step?.args?.tournamentId === "demo-tournament-id",
    ),
  );
});

test("uses session focus memory to resolve player follow-up queries", () => {
  const route = classifyRouteForTest(
    "rating bao nhieu",
    {
      sessionFocus: {
        activeType: "player",
        player: {
          entityId: "demo-player-id",
          label: "Nguoi choi Demo",
          path: "/user/demo-player-id",
        },
      },
    },
    null,
  );

  assert.equal(route.kind, "player");
  assert.equal(route.toolPlan?.[0]?.name, "get_user_profile_detail");
  assert.equal(route.toolPlan?.[0]?.args?.userId, "demo-player-id");
});

test("keeps knowledge queries on the knowledge route even when session focus exists", () => {
  const route = classifyRouteForTest(
    "pickleball la gi",
    {
      sessionFocus: {
        activeType: "tournament",
        tournament: {
          entityId: "demo-tournament-id",
          label: "Giai Demo",
          path: "/tournament/demo-tournament-id",
        },
      },
    },
    null,
  );

  assert.equal(route.kind, "knowledge");
  assert.equal(route.toolPlan?.[0]?.name, "search_knowledge");
});

test("uses context in ignore, blend, and focus modes appropriately", () => {
  assert.equal(
    resolveContextUsageMode(
      "pickleball la gi",
      { kind: "knowledge" },
      {
        pageType: "leaderboard",
        pageTitle: "Bang xep hang",
      },
    ),
    "ignore",
  );

  assert.equal(
    resolveContextUsageMode(
      "giai nao dang dien ra",
      { kind: "tournament" },
      {
        pageType: "tournament_list",
        pageTitle: "Giai dau",
      },
    ),
    "blend",
  );

  assert.equal(
    resolveContextUsageMode(
      "lich thi dau",
      { kind: "tournament" },
      {
        tournamentId: "demo-tournament-id",
        pageType: "tournament_schedule",
      },
    ),
    "focus",
  );
});

test("keeps tournament list page answers on tournament route instead of instant direct", () => {
  const route = classifyRouteForTest(
    "co giai nao dang dien ra",
    {
      pageType: "tournament_list",
      pageSnapshot: {
        pageType: "tournament_list",
        sectionTitle: "Giai dau",
        activeLabels: ["Dang dien ra"],
        stats: {
          currentTab: "ongoing",
          total: 35,
          visible: 1,
          ongoing: 1,
        },
        visibleTournaments: [
          {
            name: "Giai dau Pickletour Beta",
          },
        ],
      },
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.ok(route.directResponse);
});

test("asks for clarification on ambiguous current-context tournament questions without anchor", () => {
  const clarification = buildClarificationStateForTest(
    "lich thi dau",
    { kind: "tournament" },
    { pageType: "tournament_list" },
    { toolsUsed: [] },
    "entity_scoped",
    "low",
  );

  assert.equal(clarification?.type, "missing_current_context");
  assert.ok(Array.isArray(clarification?.hints));
  assert.ok(clarification.hints.length > 0);
});

test("routes current tournament registration checks to the dedicated registration tool", () => {
  const route = classifyRouteForTest(
    "toi da dang ky giai nay chua",
    {
      tournamentId: "demo-tournament-id",
      pageType: "tournament_registration",
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.equal(route.toolPlan?.[0]?.name, "check_my_registration");
  assert.equal(route.toolPlan?.[0]?.args?.tournamentId, "demo-tournament-id");
});

test("routes current tournament age checks to the dedicated age tool", () => {
  const route = classifyRouteForTest(
    "toi co du tuoi dang ky khong",
    {
      tournamentId: "demo-tournament-id",
      pageType: "tournament_registration",
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.equal(route.toolPlan?.[0]?.name, "get_tournament_age_check");
  assert.equal(route.toolPlan?.[0]?.args?.tournamentId, "demo-tournament-id");
});

test("routes current match duration questions to the match duration tool", () => {
  const route = classifyRouteForTest(
    "tran nay keo dai bao lau",
    {
      tournamentId: "demo-tournament-id",
      matchId: "demo-match-id",
      pageType: "tournament_live",
    },
    null,
  );

  assert.equal(route.kind, "live");
  assert.equal(route.toolPlan?.[0]?.name, "get_match_duration");
  assert.equal(route.toolPlan?.[0]?.args?.matchId, "demo-match-id");
});

test("routes current match rating-impact questions to the dedicated rating tool", () => {
  const route = classifyRouteForTest(
    "anh huong rating tran nay the nao",
    {
      tournamentId: "demo-tournament-id",
      matchId: "demo-match-id",
      pageType: "tournament_live",
    },
    null,
  );

  assert.equal(route.kind, "live");
  assert.equal(route.toolPlan?.[0]?.name, "get_match_rating_impact");
  assert.equal(route.toolPlan?.[0]?.args?.matchId, "demo-match-id");
});

test("routes bracket seeding questions to the seeding tool", () => {
  const route = classifyRouteForTest(
    "hat giong cua nhanh nay la gi",
    {
      tournamentId: "demo-tournament-id",
      bracketId: "demo-bracket-id",
      pageType: "tournament_bracket",
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.equal(route.toolPlan?.[0]?.name, "get_seeding_info");
  assert.equal(route.toolPlan?.[0]?.args?.bracketId, "demo-bracket-id");
});

test("routes personal support questions to support snapshot tools", () => {
  const route = classifyRouteForTest(
    "ho tro cua toi",
    {},
    "demo-user-id",
  );

  assert.equal(route.kind, "personal");
  assert.deepEqual(
    route.toolPlan?.map((step) => step?.name),
    ["get_support_tickets", "get_user_support_snapshot_preset"],
  );
});

test("routes personal login history questions to activity snapshot tools", () => {
  const route = classifyRouteForTest(
    "lich su dang nhap cua toi",
    {},
    "demo-user-id",
  );

  assert.equal(route.kind, "personal");
  assert.deepEqual(
    route.toolPlan?.map((step) => step?.name),
    ["get_login_history", "get_user_activity_summary_preset"],
  );
});

test("routes current club event questions to club event presets", () => {
  const route = classifyRouteForTest(
    "su kien clb nay",
    {
      clubId: "demo-club-id",
      pageType: "club_detail",
    },
    null,
  );

  assert.equal(route.kind, "club");
  assert.deepEqual(
    route.toolPlan?.map((step) => step?.name),
    ["get_club_events", "get_club_event_overview_preset"],
  );
});

test("routes current player profile follow-up questions to player presets", () => {
  const route = classifyRouteForTest(
    "rating nguoi choi nay",
    {
      profileUserId: "demo-player-id",
      pageType: "public_profile",
    },
    null,
  );

  assert.equal(route.kind, "player");
  assert.deepEqual(
    route.toolPlan?.map((step) => step?.name),
    [
      "get_user_profile_detail",
      "get_player_profile_snapshot_preset",
      "get_player_strength_snapshot_preset",
    ],
  );
});
