// services/bot/tools/index.js
// Tool registry - OpenAI function calling definitions + executors

import * as dbTools from "./dbTools.js";
import * as navTools from "./navTools.js";
import * as knowledgeTools from "./knowledgeTools.js";
import { GENERATED_PRESET_TOOL_SPECS } from "./generatedToolCatalog.js";

const TOOL_PARAM_LIBRARY = {
  tournamentId: { type: "string", description: "Tournament ID" },
  bracketId: { type: "string", description: "Bracket ID" },
  matchId: { type: "string", description: "Match ID" },
  userId: { type: "string", description: "User ID" },
  clubId: { type: "string", description: "Club ID" },
  slug: { type: "string", description: "Readable slug value" },
  keyword: { type: "string", description: "Keyword for search or lookup" },
  tag: { type: "string", description: "Tag for filtering content" },
  limit: { type: "number", description: "Maximum number of items to return" },
  courtLabel: { type: "string", description: "Exact court label" },
  courtName: { type: "string", description: "Court name filter" },
  groupName: { type: "string", description: "Group name filter" },
  role: { type: "string", description: "Role filter" },
  upcoming: { type: "boolean", description: "Whether to fetch upcoming items" },
  status: { type: "string", description: "Status filter" },
  category: { type: "string", description: "Category filter" },
  name: { type: "string", description: "Player name" },
  dob: { type: "string", description: "Date of birth in ISO format" },
  platform: { type: "string", description: "Platform filter such as ios or android" },
  provider: { type: "string", description: "Provider filter" },
  topicType: { type: "string", description: "Subscription topic type" },
};

function buildToolParameters(keys = [], required = []) {
  const properties = {};
  keys.forEach((key) => {
    if (TOOL_PARAM_LIBRARY[key]) {
      properties[key] = { ...TOOL_PARAM_LIBRARY[key] };
    }
  });

  const parameters = { type: "object", properties };
  if (required.length) {
    parameters.required = required;
  }
  return parameters;
}

function createWrapperToolSpec(name, description, keys = [], required = []) {
  return {
    name,
    description,
    parameters: buildToolParameters(keys, required),
  };
}

const EXTRA_WRAPPER_TOOL_SPECS = [
  {
    name: "get_tournament_basic_info",
    description:
      "Get a compact tournament overview with identity, status, dates, and aggregate stats.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_location_info",
    description: "Get tournament location, timezone, and active date range.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_deadlines",
    description: "Get tournament registration deadline and important dates.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_format_info",
    description: "Get tournament format and bracket structure overview.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_registration_status",
    description: "Get registration progress for a tournament, including spots left.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_checkin_status",
    description: "Get check-in progress for a tournament.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_live_overview",
    description: "Get live match overview for a tournament.",
    parameters: buildToolParameters(["tournamentId", "limit"]),
  },
  {
    name: "get_tournament_recent_results",
    description: "Get the latest finished matches for a tournament.",
    parameters: buildToolParameters(["tournamentId", "limit"]),
  },
  {
    name: "get_tournament_upcoming_schedule",
    description: "Get upcoming schedule items for a tournament.",
    parameters: buildToolParameters(["tournamentId", "courtLabel", "limit"]),
  },
  {
    name: "get_tournament_match_counts",
    description: "Get match counts and progress numbers for a tournament.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_bracket_overview",
    description: "Get overview of tournament brackets and their progress.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_draw_overview",
    description: "Get latest draw results and committed draw sessions.",
    parameters: buildToolParameters(["tournamentId", "bracketId"]),
  },
  {
    name: "get_tournament_staff_overview",
    description: "Get combined staff overview for managers and referees.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_payment_summary",
    description: "Get tournament payment and banking summary.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_referee_overview",
    description: "Get referee roster summary for a tournament.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_manager_overview",
    description: "Get tournament manager roster summary.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_court_overview",
    description: "Get court usage summary for a tournament.",
    parameters: buildToolParameters(["tournamentId"]),
  },
  {
    name: "get_tournament_rule_summary",
    description: "Get condensed tournament rules across brackets.",
    parameters: buildToolParameters(["tournamentId", "bracketId"]),
  },
  {
    name: "get_tournament_age_rule",
    description: "Get tournament age restriction information or eligibility check.",
    parameters: buildToolParameters(["tournamentId", "userId", "dob"]),
  },
  {
    name: "get_tournament_seeding_overview",
    description: "Get seeding summary for a tournament or bracket.",
    parameters: buildToolParameters(["tournamentId", "bracketId"]),
  },
  {
    name: "get_tournament_group_overview",
    description: "Get grouped team overview for a tournament or bracket.",
    parameters: buildToolParameters(["tournamentId", "bracketId", "groupName"]),
  },
  {
    name: "get_tournament_stream_overview",
    description: "Get live stream overview filtered to a tournament.",
    parameters: buildToolParameters(["tournamentId", "limit"]),
  },
  {
    name: "get_bracket_overview",
    description: "Get summary information for one bracket or a bracket set.",
    parameters: buildToolParameters(["bracketId", "tournamentId"]),
  },
  {
    name: "get_bracket_group_overview",
    description: "Get group composition for a specific bracket.",
    parameters: buildToolParameters(["bracketId", "tournamentId", "groupName"]),
  },
  {
    name: "get_bracket_tree_overview",
    description: "Get bracket tree and match flow overview.",
    parameters: buildToolParameters(["bracketId", "tournamentId"]),
  },
  {
    name: "get_match_participants",
    description: "Get participants and teams for a specific match.",
    parameters: buildToolParameters(["matchId"]),
  },
  {
    name: "get_match_schedule_info",
    description: "Get scheduling information for a match.",
    parameters: buildToolParameters(["matchId"]),
  },
  {
    name: "get_match_result_summary",
    description: "Get final result and score summary for a match.",
    parameters: buildToolParameters(["matchId"]),
  },
  {
    name: "get_match_stream_summary",
    description: "Get livestream summary for a match.",
    parameters: buildToolParameters(["matchId"]),
  },
  {
    name: "get_match_recording_summary",
    description: "Get recording summary for a match.",
    parameters: buildToolParameters(["matchId", "status"]),
  },
  {
    name: "get_match_timeline_summary",
    description: "Get condensed live timeline for a match.",
    parameters: buildToolParameters(["matchId", "limit"]),
  },
  {
    name: "get_court_schedule_overview",
    description: "Get schedule overview for one court within a tournament.",
    parameters: buildToolParameters(["tournamentId", "courtName", "limit"]),
  },
  {
    name: "get_court_live_overview",
    description: "Get live status overview for courts in a tournament.",
    parameters: buildToolParameters(["tournamentId", "courtName"]),
  },
  {
    name: "get_user_rating_snapshot",
    description: "Get a rating snapshot for a user or player.",
    parameters: buildToolParameters(["userId", "name"]),
  },
  {
    name: "get_user_reputation_snapshot",
    description: "Get a condensed reputation history snapshot for a user.",
    parameters: buildToolParameters(["userId", "limit"]),
  },
  {
    name: "get_user_registration_summary",
    description: "Get registration summary for a user.",
    parameters: buildToolParameters(["userId", "limit"]),
  },
  {
    name: "get_user_upcoming_match_summary",
    description: "Get upcoming tournament matches for a user.",
    parameters: buildToolParameters(["userId", "tournamentId", "limit"]),
  },
  {
    name: "get_user_device_summary",
    description: "Get device summary for a user.",
    parameters: buildToolParameters(["userId"]),
  },
  {
    name: "get_user_login_summary",
    description: "Get login history summary for a user.",
    parameters: buildToolParameters(["userId", "limit"]),
  },
  {
    name: "get_user_profile_summary",
    description: "Get condensed public and account profile summary for a user.",
    parameters: buildToolParameters(["userId"]),
  },
  {
    name: "get_user_match_history_summary",
    description: "Get summarized casual match history for a user.",
    parameters: buildToolParameters(["userId", "category", "status", "limit"]),
  },
  {
    name: "get_player_ranking_snapshot",
    description: "Get player ranking snapshot by user ID or name.",
    parameters: buildToolParameters(["userId", "name"]),
  },
  {
    name: "get_player_history_summary",
    description: "Get summarized tournament history for a player.",
    parameters: buildToolParameters(["userId", "limit"]),
  },
  {
    name: "get_club_member_summary",
    description: "Get condensed club member summary and sample roster.",
    parameters: buildToolParameters(["clubId", "slug", "role", "limit"]),
  },
  {
    name: "get_club_event_summary",
    description: "Get condensed club event summary.",
    parameters: buildToolParameters(["clubId", "slug", "upcoming", "limit"]),
  },
  {
    name: "get_club_announcement_summary",
    description: "Get condensed club announcement summary.",
    parameters: buildToolParameters(["clubId", "slug", "limit"]),
  },
  {
    name: "get_club_poll_summary",
    description: "Get condensed club poll summary.",
    parameters: buildToolParameters(["clubId", "slug", "limit"]),
  },
  {
    name: "get_club_activity_overview",
    description:
      "Get combined overview of club profile, members, events, announcements, and polls.",
    parameters: buildToolParameters(["clubId", "slug"]),
  },
  {
    name: "get_news_article_summary",
    description: "Get a single published article summary by slug or keyword.",
    parameters: buildToolParameters(["slug", "keyword"]),
  },
  {
    name: "get_news_feed_summary",
    description: "Get summarized published news feed results.",
    parameters: buildToolParameters(["keyword", "tag", "limit"]),
  },
];

const EXTRA_WRAPPER_TOOL_SPECS_V2 = [
  createWrapperToolSpec(
    "get_tournament_status_snapshot",
    "Get current tournament status with dates and progress snapshot.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_timeline_overview",
    "Get tournament timeline including registration deadline and event dates.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_recent_live_matches",
    "Get recent live matches for a tournament.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_recent_finished_matches",
    "Get latest finished matches for a tournament.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_unfinished_matches",
    "Get unfinished matches for a tournament.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_registration_breakdown",
    "Get registration payment breakdown for a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_checkin_breakdown",
    "Get check-in breakdown for a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_bracket_statuses",
    "Get draw and type statuses across all brackets in a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_group_statuses",
    "Get group-stage bracket counts for a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_court_load",
    "Get match load by court for a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_match_status_breakdown",
    "Get tournament match status counts.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_stream_links",
    "Get tournament live stream links and metadata.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_recording_overview",
    "Get tournament recording overview.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_draw_history",
    "Get tournament draw session history.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_staff_contacts",
    "Get tournament manager and referee contact roster summary.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_sponsor_overview",
    "Get sponsor overview for a tournament.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_tournament_event_copy",
    "Get a compact content excerpt for a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_content_summary",
    "Get content availability and summary for a tournament.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_location_snapshot",
    "Get a compact tournament location snapshot.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_tournament_participant_overview",
    "Get participant and registration overview for a tournament.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_bracket_round_overview",
    "Get round counts inside a bracket.",
    ["bracketId", "tournamentId"],
  ),
  createWrapperToolSpec(
    "get_bracket_match_statuses",
    "Get status counts for matches in a bracket.",
    ["bracketId"],
  ),
  createWrapperToolSpec(
    "get_bracket_live_matches",
    "Get live matches for a bracket.",
    ["bracketId", "limit"],
  ),
  createWrapperToolSpec(
    "get_bracket_finished_matches",
    "Get finished matches for a bracket.",
    ["bracketId", "limit"],
  ),
  createWrapperToolSpec(
    "get_bracket_upcoming_matches",
    "Get upcoming or unfinished matches for a bracket.",
    ["bracketId", "limit"],
  ),
  createWrapperToolSpec(
    "get_bracket_team_count",
    "Get team count for a bracket.",
    ["bracketId"],
  ),
  createWrapperToolSpec(
    "get_bracket_draw_status",
    "Get draw status for a bracket.",
    ["bracketId"],
  ),
  createWrapperToolSpec(
    "get_bracket_format_summary",
    "Get format summary for a bracket.",
    ["bracketId"],
  ),
  createWrapperToolSpec(
    "get_bracket_progress_snapshot",
    "Get progress snapshot for a bracket.",
    ["bracketId"],
  ),
  createWrapperToolSpec(
    "get_bracket_leaderboard_snapshot",
    "Get leaderboard snapshot for a bracket.",
    ["bracketId", "tournamentId"],
  ),
  createWrapperToolSpec(
    "get_match_scoreboard",
    "Get compact scoreboard for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_game_scores",
    "Get raw game scores for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_status_snapshot",
    "Get status timing snapshot for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_winner_summary",
    "Get winner summary for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_context_bundle",
    "Get bundled match context, log, and recordings.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_court_assignment",
    "Get court assignment for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_pair_summary",
    "Get pair and participant summary for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_progress_snapshot",
    "Get duration and progress snapshot for a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_match_log_snapshot",
    "Get compact live log snapshot for a match.",
    ["matchId", "limit"],
  ),
  createWrapperToolSpec(
    "get_match_related_recordings",
    "Get recordings related to a match.",
    ["matchId", "status"],
  ),
  createWrapperToolSpec(
    "get_court_assignment_summary",
    "Get assignment summary for a court.",
    ["tournamentId", "courtName"],
  ),
  createWrapperToolSpec(
    "get_court_match_queue",
    "Get queued and unfinished matches for a court.",
    ["tournamentId", "courtName", "limit"],
  ),
  createWrapperToolSpec(
    "get_court_recent_results",
    "Get recent finished matches on a court.",
    ["tournamentId", "courtName", "limit"],
  ),
  createWrapperToolSpec(
    "get_court_upcoming_matches",
    "Get upcoming matches on a court.",
    ["tournamentId", "courtName", "limit"],
  ),
  createWrapperToolSpec(
    "get_court_idle_status",
    "Get idle status for a court.",
    ["tournamentId", "courtName"],
  ),
  createWrapperToolSpec(
    "get_court_cluster_summary",
    "Get cluster summary for tournament courts.",
    ["tournamentId"],
  ),
  createWrapperToolSpec(
    "get_live_session_summary",
    "Get live session overview.",
    ["tournamentId", "limit"],
  ),
  createWrapperToolSpec(
    "get_live_session_match_summary",
    "Get live sessions associated with a match.",
    ["matchId"],
  ),
  createWrapperToolSpec(
    "get_live_recording_feed",
    "Get recent live recording feed.",
    ["matchId", "status", "limit"],
  ),
  createWrapperToolSpec(
    "get_live_channel_summary",
    "Get live channel directory summary.",
    ["provider"],
  ),
  createWrapperToolSpec(
    "get_user_account_snapshot",
    "Get a compact account snapshot for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_security_snapshot",
    "Get login and device security snapshot for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_subscription_summary",
    "Get subscription summary for a user.",
    ["userId", "topicType"],
  ),
  createWrapperToolSpec(
    "get_user_support_summary",
    "Get support ticket summary for a user.",
    ["userId", "status"],
  ),
  createWrapperToolSpec(
    "get_user_complaint_summary",
    "Get complaint summary for a user.",
    ["userId", "tournamentId", "status"],
  ),
  createWrapperToolSpec(
    "get_user_rating_history_summary",
    "Get rating history summary for a user.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_user_assessment_summary",
    "Get assessment summary for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_casual_overview",
    "Get casual match overview for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_registration_statuses",
    "Get registration status breakdown for a user.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_user_recent_results",
    "Get recent finished results for a user.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_user_upcoming_tournaments",
    "Get upcoming tournaments for a user.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_user_ticket_statuses",
    "Get support ticket status counts for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_subscription_statuses",
    "Get subscription topic status counts for a user.",
    ["userId", "topicType"],
  ),
  createWrapperToolSpec(
    "get_user_device_activity",
    "Get device activity summary for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_login_activity",
    "Get login activity summary for a user.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_user_profile_flags",
    "Get profile completeness and KYC flags for a user.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_user_reputation_overview",
    "Get reputation overview for a user.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_player_strength_snapshot",
    "Get player strength snapshot from ranking and evaluations.",
    ["userId", "name"],
  ),
  createWrapperToolSpec(
    "get_player_recent_form",
    "Get recent form for a player.",
    ["userId", "limit"],
  ),
  createWrapperToolSpec(
    "get_player_evaluation_summary",
    "Get evaluation summary for a player.",
    ["userId"],
  ),
  createWrapperToolSpec(
    "get_club_profile_snapshot",
    "Get compact club profile snapshot.",
    ["clubId", "slug"],
  ),
  createWrapperToolSpec(
    "get_club_join_request_summary",
    "Get club join request summary.",
    ["clubId", "slug", "status"],
  ),
  createWrapperToolSpec(
    "get_club_event_rsvp_summary",
    "Get RSVP summary across club events.",
    ["clubId", "slug"],
  ),
  createWrapperToolSpec(
    "get_club_poll_vote_summary",
    "Get poll vote summary for a club.",
    ["clubId", "slug"],
  ),
  createWrapperToolSpec(
    "get_club_news_summary",
    "Get club announcement news summary.",
    ["clubId", "slug", "limit"],
  ),
  createWrapperToolSpec(
    "get_club_member_roles",
    "Get role distribution of club members.",
    ["clubId", "slug"],
  ),
  createWrapperToolSpec(
    "get_club_upcoming_events",
    "Get upcoming events for a club.",
    ["clubId", "slug", "limit"],
  ),
  createWrapperToolSpec(
    "get_club_recent_events",
    "Get recent events for a club.",
    ["clubId", "slug", "limit"],
  ),
  createWrapperToolSpec(
    "get_club_active_polls",
    "Get active club polls.",
    ["clubId", "slug", "limit"],
  ),
  createWrapperToolSpec(
    "get_club_recent_announcements",
    "Get recent club announcements.",
    ["clubId", "slug", "limit"],
  ),
  createWrapperToolSpec(
    "get_club_growth_snapshot",
    "Get club growth snapshot.",
    ["clubId", "slug"],
  ),
  createWrapperToolSpec(
    "get_club_engagement_overview",
    "Get club engagement overview from RSVPs and votes.",
    ["clubId", "slug"],
  ),
  createWrapperToolSpec(
    "get_news_source_summary",
    "Get news source distribution summary.",
    ["keyword", "limit"],
  ),
  createWrapperToolSpec(
    "get_news_tag_summary",
    "Get news tag distribution summary.",
    ["tag", "limit"],
  ),
  createWrapperToolSpec(
    "get_news_recent_articles",
    "Get recent published articles.",
    ["limit"],
  ),
  createWrapperToolSpec(
    "get_news_search_overview",
    "Get summarized overview for a news search query.",
    ["keyword", "tag", "limit"],
  ),
  createWrapperToolSpec(
    "get_cms_block_summary",
    "Get CMS block summary by slug.",
    ["slug"],
  ),
  createWrapperToolSpec(
    "get_cms_homepage_summary",
    "Get homepage CMS summary.",
  ),
  createWrapperToolSpec(
    "get_cms_help_summary",
    "Get help or FAQ CMS summary.",
  ),
  createWrapperToolSpec(
    "get_cms_section_summary",
    "Get CMS section summary by slug or keyword.",
    ["slug", "keyword"],
  ),
  createWrapperToolSpec(
    "get_support_ticket_overview",
    "Get support ticket overview.",
    ["userId", "status"],
  ),
  createWrapperToolSpec(
    "get_subscription_plan_overview",
    "Get subscription plan overview.",
    ["userId", "topicType"],
  ),
  createWrapperToolSpec(
    "get_complaint_overview",
    "Get complaint overview.",
    ["userId", "tournamentId", "status"],
  ),
  createWrapperToolSpec(
    "get_app_release_summary",
    "Get app release summary.",
    ["platform"],
  ),
  createWrapperToolSpec(
    "get_app_update_summary",
    "Get app update summary.",
    ["platform"],
  ),
  createWrapperToolSpec(
    "get_ota_bundle_summary",
    "Get OTA bundle summary.",
    ["platform", "limit"],
  ),
  createWrapperToolSpec(
    "get_radar_presence_summary",
    "Get radar presence summary.",
    ["limit"],
  ),
  createWrapperToolSpec(
    "get_radar_intent_summary",
    "Get radar intent summary.",
    ["limit"],
  ),
  createWrapperToolSpec(
    "get_channel_directory_summary",
    "Get live channel directory overview.",
    ["provider"],
  ),
  createWrapperToolSpec(
    "get_sponsor_directory_summary",
    "Get sponsor directory overview.",
    ["limit"],
  ),
];

const ALL_EXTRA_WRAPPER_TOOL_SPECS = [
  ...EXTRA_WRAPPER_TOOL_SPECS,
  ...EXTRA_WRAPPER_TOOL_SPECS_V2,
];

const EXTRA_TOOL_EXECUTORS = Object.fromEntries(
  ALL_EXTRA_WRAPPER_TOOL_SPECS.map((spec) => [spec.name, dbTools[spec.name]]),
);

const EXTRA_WRAPPER_TOOL_DEFINITIONS = ALL_EXTRA_WRAPPER_TOOL_SPECS.map((spec) => ({
  type: "function",
  function: {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
  },
}));

const GENERATED_PRESET_TOOL_EXECUTORS = Object.fromEntries(
  GENERATED_PRESET_TOOL_SPECS.map((spec) => [
    spec.name,
    (args, ctx) => dbTools.execute_generated_preset_tool(spec.name, args, ctx),
  ]),
);

const GENERATED_PRESET_TOOL_DEFINITIONS = GENERATED_PRESET_TOOL_SPECS.map((spec) => ({
  type: "function",
  function: {
    name: spec.name,
    description: spec.description,
    parameters: buildToolParameters(spec.paramKeys, spec.required),
  },
}));

// ─────────────── TOOL EXECUTORS ───────────────
// Map tool name → function
export const TOOL_EXECUTORS = {
  search_tournaments: dbTools.search_tournaments,
  get_tournament_details: dbTools.get_tournament_details,
  count_registrations: dbTools.count_registrations,
  search_users: dbTools.search_users,
  get_my_info: dbTools.get_my_info,
  get_match_info: dbTools.get_match_info,
  get_leaderboard: dbTools.get_leaderboard,
  get_most_active_players: dbTools.get_most_active_players,
  get_my_registrations: dbTools.get_my_registrations,
  get_my_rating_changes: dbTools.get_my_rating_changes,
  query_db: dbTools.query_db,
  get_user_stats: dbTools.get_user_stats,
  get_tournament_standings: dbTools.get_tournament_standings,
  get_tournament_matches: dbTools.get_tournament_matches,
  get_tournament_brackets: dbTools.get_tournament_brackets,
  get_tournament_registrations: dbTools.get_tournament_registrations,
  get_tournament_courts: dbTools.get_tournament_courts,
  search_clubs: dbTools.search_clubs,
  get_tournament_summary: dbTools.get_tournament_summary,
  get_club_details: dbTools.get_club_details,
  get_bracket_standings: dbTools.get_bracket_standings,
  get_user_matches: dbTools.get_user_matches,
  get_club_members: dbTools.get_club_members,
  get_club_events: dbTools.get_club_events,
  search_news: dbTools.search_news,
  get_sponsors: dbTools.get_sponsors,
  get_player_evaluations: dbTools.get_player_evaluations,
  get_live_streams: dbTools.get_live_streams,
  get_club_announcements: dbTools.get_club_announcements,
  get_reg_invites: dbTools.get_reg_invites,
  get_support_tickets: dbTools.get_support_tickets,
  get_my_subscriptions: dbTools.get_my_subscriptions,
  get_casual_matches: dbTools.get_casual_matches,
  get_complaints: dbTools.get_complaints,
  get_club_polls: dbTools.get_club_polls,
  get_club_join_requests: dbTools.get_club_join_requests,
  get_tournament_managers: dbTools.get_tournament_managers,
  get_match_recordings: dbTools.get_match_recordings,
  get_draw_results: dbTools.get_draw_results,
  get_radar_nearby: dbTools.get_radar_nearby,
  get_login_history: dbTools.get_login_history,
  get_cms_content: dbTools.get_cms_content,
  get_my_devices: dbTools.get_my_devices,
  get_app_version: dbTools.get_app_version,
  get_live_channels: dbTools.get_live_channels,
  get_app_update_info: dbTools.get_app_update_info,
  check_my_registration: dbTools.check_my_registration,
  get_head_to_head: dbTools.get_head_to_head,
  get_upcoming_matches: dbTools.get_upcoming_matches,
  get_score_history: dbTools.get_score_history,
  get_event_rsvp: dbTools.get_event_rsvp,
  get_reputation_history: dbTools.get_reputation_history,
  get_live_matches: dbTools.get_live_matches,
  get_match_score_detail: dbTools.get_match_score_detail,
  compare_players: dbTools.compare_players,
  get_tournament_schedule: dbTools.get_tournament_schedule,
  get_tournament_rules: dbTools.get_tournament_rules,
  get_court_status: dbTools.get_court_status,
  get_match_live_log: dbTools.get_match_live_log,
  get_tournament_payment_info: dbTools.get_tournament_payment_info,
  get_bracket_groups: dbTools.get_bracket_groups,
  get_user_casual_stats: dbTools.get_user_casual_stats,
  get_match_rating_impact: dbTools.get_match_rating_impact,
  get_user_profile_detail: dbTools.get_user_profile_detail,
  get_tournament_progress: dbTools.get_tournament_progress,
  get_match_video: dbTools.get_match_video,
  get_tournament_referees: dbTools.get_tournament_referees,
  get_seeding_info: dbTools.get_seeding_info,
  get_player_ranking: dbTools.get_player_ranking,
  get_player_tournament_history: dbTools.get_player_tournament_history,
  get_bracket_match_tree: dbTools.get_bracket_match_tree,
  get_user_match_history: dbTools.get_user_match_history,
  get_tournament_age_check: dbTools.get_tournament_age_check,
  get_match_duration: dbTools.get_match_duration,
  ...EXTRA_TOOL_EXECUTORS,
  ...GENERATED_PRESET_TOOL_EXECUTORS,
  navigate: navTools.navigate,
  search_knowledge: knowledgeTools.search_knowledge,
};

// ─────────────── OPENAI TOOL SCHEMAS ───────────────
// Format: https://platform.openai.com/docs/guides/function-calling

const RAW_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "search_tournaments",
      description:
        "Tìm kiếm giải đấu pickleball theo tên hoặc trạng thái (upcoming, ongoing, finished)",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên giải đấu (tìm gần đúng)",
          },
          status: {
            type: "string",
            enum: ["upcoming", "ongoing", "finished"],
            description:
              "Trạng thái giải: upcoming=sắp tới, ongoing=đang diễn ra, finished=đã kết thúc",
          },
          limit: { type: "number", description: "Số lượng kết quả tối đa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_details",
      description: "Xem chi tiết 1 giải đấu cụ thể theo ID",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (ObjectId)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "count_registrations",
      description: "Đếm số đội/cặp đã đăng ký trong 1 giải đấu",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_users",
      description:
        "Tìm kiếm VĐV/người chơi theo tên. Chỉ trả về thông tin công khai (tên, nickname, rating, tỉnh). KHÔNG trả phone/email.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên VĐV cần tìm",
          },
          limit: { type: "number", description: "Số lượng tối đa" },
          sortBy: {
            type: "string",
            enum: ["ratingDoubles", "ratingSingles", "name"],
            description:
              "Sắp xếp kết quả. Dùng khi user hỏi 'điểm cao nhất', 'rating cao nhất'",
          },
        },
        required: ["name"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_info",
      description:
        "Lấy thông tin cá nhân của user hiện tại (tên, SĐT, email, rating, KYC...). Chỉ dùng khi user hỏi về BẢN THÂN.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_info",
      description:
        "Xem chi tiết trận đấu: team A/B, tỉ số từng ván (gameScores), trạng thái, winner (A hoặc B)",
      parameters: {
        type: "object",
        properties: {
          matchId: {
            type: "string",
            description:
              "ID trận đấu. Nếu user nói 'trận NÀY', dùng matchId từ context.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_leaderboard",
      description:
        "Xem bảng xếp hạng VĐV. Dùng Ranking model giống trang BXH thật. Có thể sort theo từng loại điểm và lọc theo tier xác thực (yellow=đã xác thực/Official, red=tự chấm/chưa xác thực, grey=chưa đấu).",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Số lượng top (mặc định 10)" },
          sortBy: {
            type: "string",
            enum: ["single", "double", "mix", "points", "reputation"],
            description:
              "Sort theo loại điểm nào. VD: 'single' = điểm đơn, 'double' = điểm đôi, 'mix' = điểm đánh mix, 'points' = tổng điểm, 'reputation' = uy tín. Không truyền = sort mặc định (tier→double→single→points).",
          },
          tierColor: {
            type: "string",
            enum: ["yellow", "red", "grey"],
            description:
              "Lọc theo tier xác thực. 'yellow' = điểm đã xác thực (Official/Đã duyệt), 'red' = điểm tự chấm (chưa xác thực), 'grey' = chưa đấu. Không truyền = tất cả tier.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_most_active_players",
      description:
        "Tìm top VĐV tích cực nhất (chơi nhiều trận nhất). Dùng khi user hỏi: ai chơi nhiều nhất, VĐV tích cực nhất, top trận đấu.",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Số lượng top (mặc định 10)" },
          status: {
            type: "string",
            enum: ["finished", "live", "scheduled"],
            description: "Lọc theo status trận (mặc định: finished)",
          },
          tournamentId: {
            type: "string",
            description:
              "Lọc trong 1 giải cụ thể (không truyền = toàn hệ thống)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_registrations",
      description:
        "Xem danh sách giải đấu mà user hiện tại đã đăng ký tham gia",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Số lượng tối đa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_rating_changes",
      description: "Xem lịch sử thay đổi rating của user hiện tại",
      parameters: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["singles", "doubles"],
            description: "Loại hình: đánh đơn hoặc đánh đôi",
          },
          limit: { type: "number", description: "Số lượng tối đa" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "navigate",
      description:
        "Điều hướng màn hình. QUAN TRỌNG: Nếu cần mở giải đấu/trận/bảng, PHẢI search trước để lấy ID, rồi truyền ID vào hàm này.",
      parameters: {
        type: "object",
        properties: {
          screen: {
            type: "string",
            enum: [
              "tournament_list",
              "tournament_detail",
              "bracket",
              "schedule",
              "registration",
              "court_detail",
              "profile",
              "settings",
              "leaderboard",
              "notifications",
              "home",
              "kyc",
              "clubs",
            ],
            description: "Màn hình cần mở",
          },
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC nếu mở màn hình giải đấu)",
          },
          bracketId: { type: "string", description: "ID bảng đấu (nếu cần)" },
          courtCode: { type: "string", description: "Mã sân (nếu cần)" },
        },
        required: ["screen"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_knowledge",
      description:
        "Tìm kiếm thông tin trong knowledge base: hướng dẫn, FAQ, chính sách, tính năng app, VÀ kiến thức bot đã học được từ hội thoại trước. LUÔN gọi tool này trước khi trả lời câu hỏi.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Câu hỏi hoặc từ khóa cần tìm",
          },
          category: {
            type: "string",
            enum: ["faq", "guide", "feature", "policy", "learned"],
            description: "Danh mục (không bắt buộc)",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_matches",
      description:
        "Lấy danh sách trận đấu của 1 giải đấu kèm thống kê: trận đang live, trận dài nhất, trận chênh lệch điểm nhất, tên đội, tỉ số. Dùng khi user hỏi về các trận đấu trong giải.",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
          status: {
            type: "string",
            enum: ["scheduled", "queued", "assigned", "live", "finished"],
            description: "Lọc theo trạng thái trận (tuỳ chọn)",
          },
          bracketId: {
            type: "string",
            description: "ID bảng đấu cụ thể (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số trận tối đa (mặc định 20, max 30)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_brackets",
      description:
        'Lấy danh sách bảng đấu (brackets) trong 1 giải: tên bảng, loại (knockout/group/...), luật chơi, số trận live/xong/chờ. Dùng khi user hỏi "giải có bao nhiêu bảng", "bảng đôi nam là gì".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_registrations",
      description:
        'Danh sách đội đăng ký giải hoặc trong 1 bảng đấu cụ thể. Trả tên VĐV, trạng thái thanh toán, check-in. Dùng khi user hỏi "ai đăng ký giải X", "bảng A có mấy đội", "đội nào check-in rồi". Truyền bracketId nếu hỏi về 1 bảng cụ thể.',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
          bracketId: {
            type: "string",
            description:
              "ID bảng đấu — truyền khi muốn lấy đội trong bảng cụ thể (tuỳ chọn)",
          },
          paymentStatus: {
            type: "string",
            enum: ["Paid", "Unpaid"],
            description: "Lọc theo trạng thái thanh toán (tuỳ chọn)",
          },
          hasCheckin: {
            type: "boolean",
            description: "true = đã check-in, false = chưa check-in (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số đội tối đa (mặc định 20, max 50)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_courts",
      description:
        'Danh sách sân đấu trong giải: tên sân, trạng thái (idle/live/assigned), trận đang chơi trên sân. Dùng khi user hỏi "sân nào đang trống", "sân 3 có trận gì".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_clubs",
      description:
        'Tìm câu lạc bộ (CLB) theo tên hoặc tỉnh/thành. Dùng khi user hỏi "CLB nào ở Hà Nội", "tìm CLB pickleball ABC".',
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tên CLB cần tìm (tuỳ chọn)",
          },
          province: {
            type: "string",
            description: "Tỉnh/thành phố (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số CLB tối đa (mặc định 5, max 20)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_summary",
      description:
        'Tổng quan toàn diện 1 giải đấu: thông tin cơ bản + số bảng + số đội + số trận (live/xong/chờ) + số sân + tiến độ %. Dùng khi user hỏi "cho tôi tổng quan giải X", "giải X đang như nào".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu (BẮT BUỘC)",
          },
        },
        required: ["tournamentId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_details",
      description:
        'Chi tiết đầy đủ của 1 câu lạc bộ: tên, mô tả, số thành viên, chủ CLB, tỉnh/thành, chính sách gia nhập, link MXH. Dùng khi user hỏi "CLB X ở đâu", "CLB này có bao nhiêu thành viên".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID của CLB",
          },
          slug: {
            type: "string",
            description: "Slug URL của CLB (thay cho clubId)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_standings",
      description:
        'BXH (bảng xếp hạng) của 1 bảng đấu vòng tròn/round-robin/swiss. Trả rank, tên đội, thắng/thua, điểm, hiệu sets/points. Dùng khi user hỏi "BXH bảng A", "ai đứng nhất", "thứ hạng trong bảng". KHÔNG dùng cho knockout (dùng get_tournament_standings thay vào).',
      parameters: {
        type: "object",
        properties: {
          bracketId: {
            type: "string",
            description: "ID bảng đấu (BẮT BUỘC)",
          },
          tournamentId: {
            type: "string",
            description: "ID giải đấu (tuỳ chọn)",
          },
        },
        required: ["bracketId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_matches",
      description:
        'Lịch sử trận đấu của 1 VĐV: tên đối thủ, tỷ số, thắng/thua, thời gian, sân. Dùng khi user hỏi "trận đấu của tôi", "tôi thắng mấy trận", "lịch sử thi đấu".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID của VĐV — bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Giới hạn trong 1 giải (tuỳ chọn)",
          },
          status: {
            type: "string",
            enum: ["scheduled", "live", "finished"],
            description: "Lọc trạng thái trận (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số trận tối đa (mặc định 10, max 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_members",
      description:
        'Danh sách thành viên CLB: tên, role (owner/admin/member), ngày gia nhập. Dùng khi user hỏi "CLB có ai?", "admin CLB là ai?".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID CLB (BẮT BUỘC)",
          },
          role: {
            type: "string",
            enum: ["owner", "admin", "member"],
            description: "Lọc theo role (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số thành viên tối đa (mặc định 20, max 50)",
          },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_events",
      description:
        'Sự kiện của CLB: tiêu đề, địa điểm, thời gian, số người tham dự. Dùng khi user hỏi "CLB có event gì?", "sự kiện sắp tới của CLB".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID CLB (BẮT BUỘC)",
          },
          upcoming: {
            type: "boolean",
            description: "true = sắp tới, false = đã qua (mặc định true)",
          },
          limit: {
            type: "number",
            description: "Số sự kiện tối đa (mặc định 10)",
          },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_news",
      description:
        'Tin tức Pickleball: tiêu đề, tóm tắt, nguồn, ngày đăng. Dùng khi user hỏi "tin tức mới?", "có gì mới hôm nay?".',
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "Từ khóa tìm kiếm (tuỳ chọn)",
          },
          tag: {
            type: "string",
            description: "Lọc theo tag (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số bài tối đa (mặc định 5, max 15)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sponsors",
      description:
        'Nhà tài trợ: tên, hạng (Platinum/Gold/Silver/Bronze), mô tả, website. Dùng khi user hỏi "ai tài trợ giải?", "sponsor giải này".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu — bỏ trống để lấy tất cả sponsor",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_evaluations",
      description:
        'Kết quả chấm trình VĐV: điểm singles/doubles, chi tiết kỹ năng, người chấm. Dùng khi user hỏi "trình độ của tôi?", "ai chấm tôi bao nhiêu?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID của VĐV — bỏ trống nếu hỏi về chính mình",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_streams",
      description:
        'Danh sách trực tiếp: provider (facebook/youtube/tiktok), link xem, trận đang phát. Dùng khi user hỏi "trận nào đang live?", "link xem trực tiếp".',
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["CREATED", "LIVE", "ENDED"],
            description: "Lọc trạng thái (mặc định LIVE)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_announcements",
      description:
        'Thông báo CLB: tiêu đề, nội dung, ghim, người viết. Dùng khi user hỏi "CLB có thông báo gì?", "tin tức CLB".',
      parameters: {
        type: "object",
        properties: {
          clubId: {
            type: "string",
            description: "ID CLB (BẮT BUỘC)",
          },
          limit: {
            type: "number",
            description: "Số thông báo tối đa (mặc định 10)",
          },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reg_invites",
      description:
        'Lời mời đăng ký giải: ai mời, trạng thái (pending/accepted/declined). Dùng khi user hỏi "ai mời tôi đăng ký?", "lời mời của tôi".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Lọc theo giải đấu (tuỳ chọn)",
          },
          status: {
            type: "string",
            enum: ["pending", "accepted", "declined", "cancelled", "expired"],
            description: "Lọc trạng thái (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_support_tickets",
      description:
        'Ticket hỗ trợ: tiêu đề, trạng thái, tin nhắn cuối. Dùng khi user hỏi "ticket hỗ trợ của tôi", "tôi đã gửi yêu cầu chưa?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          status: {
            type: "string",
            enum: ["open", "resolved", "closed"],
            description: "Lọc trạng thái (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_subscriptions",
      description:
        'User đang theo dõi giải/CLB nào: loại topic, tên, kênh thông báo. Dùng khi user hỏi "tôi đang theo dõi gì?", "notification của tôi".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          topicType: {
            type: "string",
            enum: ["tournament", "match", "club", "org", "global"],
            description: "Lọc loại topic (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_casual_matches",
      description:
        'Trận tự do (UserMatch) của user: trận casual, practice, club. Dùng khi user hỏi "trận tự do của tôi", "trận casual gần đây".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "User ID — bỏ trống nếu hỏi về chính mình",
          },
          status: {
            type: "string",
            enum: ["scheduled", "queued", "assigned", "live", "finished"],
            description: "Lọc trạng thái (tuỳ chọn)",
          },
          category: {
            type: "string",
            enum: [
              "casual",
              "practice",
              "club",
              "league",
              "tournament",
              "other",
            ],
            description: "Loại trận (tuỳ chọn)",
          },
          limit: {
            type: "number",
            description: "Số trận tối đa (mặc định 10, max 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_complaints",
      description:
        'Khiếu nại giải đấu: nội dung, trạng thái, phản hồi BTC. Dùng khi user hỏi "khiếu nại của tôi", "tôi đã phản ánh gì?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Lọc theo giải (tuỳ chọn)",
          },
          status: {
            type: "string",
            enum: ["pending", "reviewed", "resolved", "rejected"],
            description: "Lọc trạng thái",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_polls",
      description:
        'Bình chọn CLB: câu hỏi, lựa chọn, số vote. Dùng khi user hỏi "CLB có bình chọn gì?", "poll CLB".',
      parameters: {
        type: "object",
        properties: {
          clubId: { type: "string", description: "ID CLB (BẮT BUỘC)" },
          limit: { type: "number", description: "Số poll tối đa (mặc định 5)" },
        },
        required: ["clubId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_club_join_requests",
      description:
        'Đơn xin vào CLB: trạng thái (pending/accepted/rejected). Dùng khi user hỏi "tôi đã xin vào CLB chưa?", "đơn gia nhập CLB".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          clubId: { type: "string", description: "ID CLB" },
          status: {
            type: "string",
            enum: ["pending", "accepted", "rejected", "cancelled"],
            description: "Lọc trạng thái",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_managers",
      description:
        'Quản lý giải đấu: tên, role, SĐT. Dùng khi user hỏi "ai quản lý giải?", "liên hệ BTC".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context nếu có)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_recordings",
      description:
        'Video replay trận: trạng thái, thời lượng, dung lượng. Dùng khi user hỏi "xem lại trận", "video trận này".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (BẮT BUỘC)" },
          status: {
            type: "string",
            enum: ["recording", "merging", "ready", "failed"],
            description: "Lọc trạng thái (mặc định ready)",
          },
        },
        required: ["matchId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_draw_results",
      description:
        'Kết quả bốc thăm/xếp hạt giống: chia bảng, cặp đấu knockout. Dùng khi user hỏi "bốc thăm bảng nào?", "kết quả chia bảng".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng đấu (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context nếu có)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_radar_nearby",
      description:
        'Radar: người chơi gần đây đang muốn đánh. Dùng khi user hỏi "ai gần tôi muốn đánh?", "radar", "tìm bạn đánh".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          maxDistanceKm: {
            type: "number",
            description: "Bán kính km (mặc định 10)",
          },
          limit: {
            type: "number",
            description: "Số người tối đa (mặc định 10)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_login_history",
      description:
        'Lịch sử đăng nhập: thời gian, phương thức, thiết bị. Dùng khi user hỏi "lịch sử đăng nhập", "đăng nhập lần cuối".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          limit: { type: "number", description: "Số entries (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_cms_content",
      description:
        'Nội dung CMS (FAQ, quy định, hướng dẫn...). Không có slug → liệt kê các slug khả dụng. Dùng khi user hỏi "quy định giải", "FAQ", "hướng dẫn".',
      parameters: {
        type: "object",
        properties: {
          slug: {
            type: "string",
            description:
              "Slug CMS block (vd: hero, contact, faq). Bỏ trống để xem danh sách",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_my_devices",
      description:
        'Thiết bị đã đăng ký: tên, hãng, model, phiên bản app. Dùng khi user hỏi "thiết bị của tôi", "tôi dùng điện thoại gì?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_version",
      description:
        'Phiên bản app mới nhất: version, mô tả, bắt buộc. Dùng khi user hỏi "phiên bản mới nhất?", "cập nhật app".',
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["ios", "android"],
            description: "ios hoặc android (tuỳ chọn, mặc định cả 2)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_channels",
      description:
        'Kênh live stream: Facebook, YouTube, TikTok. Dùng khi user hỏi "kênh live nào?", "live trên đâu?".',
      parameters: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            enum: ["facebook", "youtube", "tiktok"],
            description: "Lọc theo nền tảng (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_app_update_info",
      description:
        'Thông tin cập nhật app: phiên bản store, link tải, changelog, bắt buộc cập nhật. Dùng khi user hỏi "link tải app?", "có cập nhật bắt buộc?", "changelog".',
      parameters: {
        type: "object",
        properties: {
          platform: {
            type: "string",
            enum: ["all", "ios", "android"],
            description: "Nền tảng (mặc định: tất cả)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_my_registration",
      description:
        'Kiểm tra tôi đã đăng ký giải chưa: mã đăng ký, thanh toán, check-in. Dùng khi user hỏi "tôi đăng ký chưa?", "mã đăng ký của tôi?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_head_to_head",
      description:
        'Lịch sử đối đầu giữa 2 VĐV: thắng/thua, điểm từng trận. Dùng khi user hỏi "A vs B bao nhiêu lần?", "lịch sử đối đầu".',
      parameters: {
        type: "object",
        properties: {
          playerAId: { type: "string", description: "ID VĐV A" },
          playerBId: { type: "string", description: "ID VĐV B" },
        },
        required: ["playerAId", "playerBId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_upcoming_matches",
      description:
        'Trận sắp tới của tôi: sân, giờ, đối thủ. Dùng khi user hỏi "trận tới của tôi?", "tôi đánh lúc mấy?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          tournamentId: {
            type: "string",
            description: "Lọc theo giải (tuỳ chọn)",
          },
          limit: { type: "number", description: "Số trận (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_score_history",
      description:
        'Lịch sử chấm điểm kỹ năng: single/double score theo thời gian. Dùng khi user hỏi "điểm của tôi thay đổi thế nào?", "lịch sử điểm".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          limit: { type: "number", description: "Số entries (mặc định 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_event_rsvp",
      description:
        'Danh sách RSVP sự kiện CLB: ai tham gia, ai không. Dùng khi user hỏi "ai đi sự kiện?", "tôi RSVP chưa?".',
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "ID sự kiện CLB" },
          userId: {
            type: "string",
            description: "Kiểm tra RSVP của ai (tuỳ chọn)",
          },
        },
        required: ["eventId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_reputation_history",
      description:
        'Lịch sử uy tín: bonus từ các giải. Dùng khi user hỏi "uy tín của tôi?", "reputation thay đổi?".',
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "Bỏ trống nếu hỏi về chính mình",
          },
          limit: { type: "number", description: "Số entries (mặc định 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_live_matches",
      description:
        'Trận đang live: điểm hiện tại, sân, đội. Dùng khi user hỏi "trận nào đang đánh?", "live match?", "match nào đang diễn ra?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "Lọc theo giải (tuỳ chọn, lấy từ context)",
          },
          limit: { type: "number", description: "Số trận (mặc định 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_score_detail",
      description:
        'Chi tiết điểm từng ván: scoreA, scoreB, best-of, cap. Dùng khi user hỏi "ván 1 bao nhiêu-bao nhiêu?", "chi tiết điểm trận?".',
      parameters: {
        type: "object",
        properties: {
          matchId: {
            type: "string",
            description: "ID trận (lấy từ context nếu có)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "compare_players",
      description:
        'So sánh 2 VĐV: rating, skill, reputation, số trận, số giải. Dùng khi user hỏi "so sánh A với B?", "ai giỏi hơn?".',
      parameters: {
        type: "object",
        properties: {
          playerAId: { type: "string", description: "ID VĐV A" },
          playerBId: { type: "string", description: "ID VĐV B" },
        },
        required: ["playerAId", "playerBId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_schedule",
      description:
        'Lịch thi đấu giải: trận theo ngày, sân, vòng. Dùng khi user hỏi "lịch thi đấu ngày mai?", "schedule sân 1?", "trận nào vòng 2?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          date: {
            type: "string",
            description: "Ngày lọc (YYYY-MM-DD, tuỳ chọn)",
          },
          courtLabel: { type: "string", description: "Tên sân lọc (tuỳ chọn)" },
          limit: { type: "number", description: "Số trận (mặc định 30)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_rules",
      description:
        'Luật thi đấu từng bảng: bestOf, điểm/ván, cap, seeding method, format config. Dùng khi user hỏi "luật giải?", "đánh mấy ván?", "seeding kiểu gì?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          bracketId: {
            type: "string",
            description: "ID bảng cụ thể (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_standings",
      description:
        'Bảng xếp hạng vòng bảng/RR/Swiss: W-L, điểm, set diff, points diff. Dùng khi user hỏi "bảng xếp hạng?", "ai nhất bảng A?", "standings?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          groupName: {
            type: "string",
            description: "Lọc theo tên nhóm (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_court_status",
      description:
        'Trạng thái sân real-time: idle/live/assigned, trận đang đánh. Dùng khi user hỏi "sân nào trống?", "sân 1 có ai?", "tình hình sân?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          courtName: {
            type: "string",
            description: "Lọc theo tên sân (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_live_log",
      description:
        'Diễn biến trận point-by-point: điểm, serve, undo, break. Dùng khi user hỏi "diễn biến trận?", "ai ghi điểm cuối?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
          limit: {
            type: "number",
            description: "Số events cuối (mặc định 30)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_payment_info",
      description:
        'Lệ phí đăng ký, thông tin ngân hàng, liên hệ BTC. Dùng khi user hỏi "lệ phí bao nhiêu?", "chuyển khoản đâu?", "liên hệ BTC?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_groups",
      description:
        'Thành viên từng nhóm/bảng: danh sách đội, skill score. Dùng khi user hỏi "bảng A có ai?", "nhóm của tôi?", "ai trong pool 2?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          groupName: {
            type: "string",
            description: "Lọc theo tên nhóm (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_casual_stats",
      description:
        'Thống kê trận tự do (UserMatch): W-L, winRate, điểm, phân loại. Dùng khi user hỏi "thành tích tự do?", "tôi thắng bao nhiêu trận?", "stats casual?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          category: {
            type: "string",
            description: "Lọc loại: casual/practice/club/league (tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_rating_impact",
      description:
        'Rating thay đổi sau trận: oldRating, newRating, delta mỗi VĐV. Dùng khi user hỏi "rating tôi thay đổi bao nhiêu?", "ảnh hưởng rating trận vừa rồi?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_profile_detail",
      description:
        'Thông tin chi tiết VĐV: localRatings (singles/doubles), tỉnh, CCCD, role, evaluator. Dùng khi user hỏi "thông tin VĐV X?", "rating đơn/đôi?", "profile?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_progress",
      description:
        'Tiến độ giải: % trận xong, số trận live/chờ, sân hoạt động, trạng thái bảng. Dùng khi user hỏi "giải tiến hành tới đâu?", "bao nhiêu trận xong?", "progress?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_video",
      description:
        'Link video/livestream trận: URL YouTube, FB live, embed. Dùng khi user hỏi "xem lại trận?", "có video không?", "link livestream?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_referees",
      description:
        'DS trọng tài giải: tên, nickname, tỉnh. Dùng khi user hỏi "ai làm trọng tài?", "trọng tài giải này?", "referee list?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_seeding_info",
      description:
        'Hạt giống & bốc thăm: seed number, drawSize, phương pháp seeding, ratingKey. Dùng khi user hỏi "hạt giống?", "ai seed 1?", "bốc thăm kiểu gì?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_ranking",
      description:
        'Điểm xếp hạng VĐV: single/double/mix/points, tier (Gold/Red/Grey), reputation. Dùng khi user hỏi "điểm của tôi?", "ranking VĐV X?", "hạng mấy?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          name: { type: "string", description: "Tên VĐV (tuỳ chọn)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_player_tournament_history",
      description:
        'Lịch sử tham gia giải: danh sách giải, W-L mỗi giải, seed, trạng thái. Dùng khi user hỏi "tôi đã đá mấy giải?", "giải nào tôi tham gia?", "thành tích giải?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          limit: { type: "number", description: "Số giải (mặc định 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_bracket_match_tree",
      description:
        'Cây bracket: tất cả trận theo round/order, team, winner, nextMatch. Dùng khi user hỏi "đường đấu?", "ai gặp ai vòng sau?", "bracket tree?".',
      parameters: {
        type: "object",
        properties: {
          bracketId: { type: "string", description: "ID bảng (tuỳ chọn)" },
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_match_history",
      description:
        'Lịch sử trận tự do (UserMatch): kết quả, điểm, người chơi, địa điểm. Dùng khi user hỏi "lịch sử trận tự do?", "tôi đá đâu gần đây?".',
      parameters: {
        type: "object",
        properties: {
          userId: { type: "string", description: "ID user (lấy từ context)" },
          category: {
            type: "string",
            description: "Loại: casual/practice/club/league",
          },
          status: {
            type: "string",
            description: "Trạng thái: scheduled/live/finished",
          },
          limit: { type: "number", description: "Số trận (mặc định 15)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_age_check",
      description:
        'Kiểm tra điều kiện tuổi giải: giới hạn tuổi, năm sinh. Dùng khi user hỏi "tôi đủ tuổi không?", "giải giới hạn tuổi?", "sinh năm mấy được đăng ký?".',
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải (lấy từ context)",
          },
          userId: { type: "string", description: "ID user (lấy từ context)" },
          dob: {
            type: "string",
            description: "Ngày sinh (YYYY-MM-DD, tuỳ chọn)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_match_duration",
      description:
        'Thời lượng trận: phút, hoặc trung bình cả giải. Dùng khi user hỏi "trận kéo dài bao lâu?", "trung bình mấy phút?", "trận dài nhất?".',
      parameters: {
        type: "object",
        properties: {
          matchId: { type: "string", description: "ID trận (lấy từ context)" },
          tournamentId: {
            type: "string",
            description: "ID giải (xem stats cả giải)",
          },
          limit: { type: "number", description: "(không dùng, reserved)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "query_db",
      description:
        "🔥 GENERIC: Query bất kỳ collection nào trong database. Dùng khi KHÔNG có tool chuyên biệt phù hợp. Collections: tournaments, users, registrations, matches, brackets, courts, ratingChanges, assessments, reputationEvents, scoreHistories. Filter hỗ trợ MongoDB operators ($regex, $gte, $in, $or...). Context variables: {{currentUserId}}, {{tournamentId}}, {{matchId}}, {{bracketId}}, {{courtCode}}",
      parameters: {
        type: "object",
        properties: {
          collection: {
            type: "string",
            enum: [
              "tournaments",
              "users",
              "registrations",
              "matches",
              "brackets",
              "courts",
              "ratingChanges",
              "assessments",
              "reputationEvents",
              "scoreHistories",
            ],
            description: "Tên collection cần query",
          },
          filter: {
            type: "object",
            description:
              'MongoDB filter object. Ví dụ: {"status": "upcoming"}, {"name": {"$regex": "abc", "$options": "i"}}, {"tournament": "{{tournamentId}}"}',
          },
          sort: {
            type: "object",
            description:
              'Sort object. Ví dụ: {"createdAt": -1}, {"localRatings.doubles": -1}',
          },
          limit: {
            type: "number",
            description: "Số lượng kết quả tối đa (max 20)",
          },
          populate: {
            type: "string",
            description: 'Populate relations. Ví dụ: "tournament", "user"',
          },
        },
        required: ["collection"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_user_stats",
      description:
        "Thống kê chi tiết 1 VĐV: rating, tổng trận, thắng, thua, win rate, số giải tham gia. Dùng khi user hỏi 'thành tích', 'thống kê', 'so sánh' VĐV.",
      parameters: {
        type: "object",
        properties: {
          userId: {
            type: "string",
            description: "ID VĐV (nếu đã biết)",
          },
          name: {
            type: "string",
            description: "Tên VĐV (tìm gần đúng nếu chưa có ID)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_tournament_standings",
      description:
        "Lấy kết quả xếp hạng chung cuộc của giải đấu knockout: vô địch (hạng 1), á quân (hạng 2), hạng 3 (hoặc đồng hạng 3), hạng 4. Dùng khi user hỏi 'ai vô địch', 'đội nào hạng nhất', 'kết quả chung cuộc', 'xếp hạng giải'.",
      parameters: {
        type: "object",
        properties: {
          tournamentId: {
            type: "string",
            description: "ID giải đấu",
          },
          bracketId: {
            type: "string",
            description:
              "ID bracket cụ thể (tuỳ chọn, nếu không truyền sẽ lấy tất cả bracket knockout)",
          },
        },
      },
    },
  },
];

function dedupeToolDefinitions(definitions = []) {
  const seen = new Set();
  return definitions.filter((item) => {
    const name = item?.function?.name;
    if (!name) return false;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export const TOOL_DEFINITIONS = dedupeToolDefinitions([
  ...RAW_TOOL_DEFINITIONS,
  ...EXTRA_WRAPPER_TOOL_DEFINITIONS,
  ...GENERATED_PRESET_TOOL_DEFINITIONS,
]);
