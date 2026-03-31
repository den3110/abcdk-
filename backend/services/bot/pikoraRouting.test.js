import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRouteForTest,
  looksLikeTournamentAvailabilityQuestion,
  pickTournamentStatusFromMessage,
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
