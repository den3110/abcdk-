import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRouteForTest,
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
      sectionTitle: "Bảng xếp hạng",
      activeLabels: ["Điểm trình"],
      visibleActions: ["Hồ sơ", "Chấm trình", "Xem KYC"],
      highlights: ["Bảng xếp hạng"],
    },
  };

  for (const message of [
    "pickleball là gì",
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
    "top 1 bảng xếp hạng hiện tại là ai",
    {
      pageType: "tournament_list",
      pageSnapshot: {
        pageType: "tournament_list",
        sectionTitle: "Giải đấu",
        activeLabels: ["Sắp diễn ra"],
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
    "lịch thi đấu",
    {
      sessionFocus: {
        activeType: "tournament",
        tournament: {
          entityId: "demo-tournament-id",
          label: "Giải Demo",
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
    "rating bao nhiêu",
    {
      sessionFocus: {
        activeType: "player",
        player: {
          entityId: "demo-player-id",
          label: "Người chơi Demo",
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
    "pickleball là gì",
    {
      sessionFocus: {
        activeType: "tournament",
        tournament: {
          entityId: "demo-tournament-id",
          label: "Giải Demo",
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
      "pickleball là gì",
      { kind: "knowledge" },
      {
        pageType: "leaderboard",
        pageTitle: "Bảng xếp hạng",
      },
    ),
    "ignore",
  );

  assert.equal(
    resolveContextUsageMode(
      "giải nào đang diễn ra",
      { kind: "tournament" },
      {
        pageType: "tournament_list",
        pageTitle: "Giải đấu",
      },
    ),
    "blend",
  );

  assert.equal(
    resolveContextUsageMode(
      "lịch thi đấu",
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
    "có giải nào đang diễn ra",
    {
      pageType: "tournament_list",
      pageSnapshot: {
        pageType: "tournament_list",
        sectionTitle: "Giải đấu",
        activeLabels: ["Đang diễn ra"],
        stats: {
          currentTab: "ongoing",
          total: 35,
          visible: 1,
          ongoing: 1,
        },
        visibleTournaments: [
          {
            name: "Giải đấu Pickletour Beta",
          },
        ],
      },
    },
    null,
  );

  assert.equal(route.kind, "tournament");
  assert.ok(route.directResponse);
});
