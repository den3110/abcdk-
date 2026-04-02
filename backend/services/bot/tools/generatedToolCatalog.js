const GENERATED_VIEWS = [
  { key: "overview", label: "overview" },
  { key: "snapshot", label: "snapshot" },
  { key: "summary", label: "summary" },
  { key: "details", label: "details" },
  { key: "recent", label: "recent" },
  { key: "breakdown", label: "breakdown" },
  { key: "trend", label: "trend" },
  { key: "digest", label: "digest" },
  { key: "report", label: "report" },
  { key: "focus", label: "focus" },
];

const GENERATED_FAMILY_CONFIGS = [
  {
    family: "tournament",
    label: "tournament",
    paramKeys: ["tournamentId", "status", "category", "bracketId", "groupName", "courtName", "limit"],
    signals: [
      { key: "status", label: "status", handlerName: "get_tournament_status_snapshot" },
      { key: "timeline", label: "timeline", handlerName: "get_tournament_timeline_overview" },
      { key: "schedule", label: "schedule", handlerName: "get_tournament_upcoming_schedule" },
      { key: "registration", label: "registration", handlerName: "get_tournament_registration_breakdown" },
      { key: "checkin", label: "check-in", handlerName: "get_tournament_checkin_breakdown" },
      { key: "bracket", label: "bracket", handlerName: "get_tournament_bracket_statuses" },
      { key: "group", label: "group", handlerName: "get_tournament_group_statuses" },
      { key: "court", label: "court", handlerName: "get_tournament_court_load" },
      { key: "stream", label: "stream", handlerName: "get_tournament_stream_links" },
      { key: "participant", label: "participant", handlerName: "get_tournament_participant_overview" },
    ],
  },
  {
    family: "bracket",
    label: "bracket",
    paramKeys: ["bracketId", "tournamentId", "groupName", "limit"],
    signals: [
      { key: "status", label: "status", handlerName: "get_bracket_match_statuses" },
      { key: "progress", label: "progress", handlerName: "get_bracket_progress_snapshot" },
      { key: "live", label: "live", handlerName: "get_bracket_live_matches" },
      { key: "upcoming", label: "upcoming", handlerName: "get_bracket_upcoming_matches" },
      { key: "finished", label: "finished", handlerName: "get_bracket_finished_matches" },
      { key: "round", label: "round", handlerName: "get_bracket_round_overview" },
      { key: "draw", label: "draw", handlerName: "get_bracket_draw_status" },
      { key: "format", label: "format", handlerName: "get_bracket_format_summary" },
      { key: "team", label: "team", handlerName: "get_bracket_team_count" },
      { key: "leaderboard", label: "leaderboard", handlerName: "get_bracket_leaderboard_snapshot" },
    ],
  },
  {
    family: "match",
    label: "match",
    paramKeys: ["matchId", "tournamentId", "status", "limit"],
    signals: [
      { key: "status", label: "status", handlerName: "get_match_status_snapshot" },
      { key: "scoreboard", label: "scoreboard", handlerName: "get_match_scoreboard" },
      { key: "games", label: "games", handlerName: "get_match_game_scores" },
      { key: "winner", label: "winner", handlerName: "get_match_winner_summary" },
      { key: "context", label: "context", handlerName: "get_match_context_bundle" },
      { key: "court", label: "court", handlerName: "get_match_court_assignment" },
      { key: "pair", label: "pair", handlerName: "get_match_pair_summary" },
      { key: "progress", label: "progress", handlerName: "get_match_progress_snapshot" },
      { key: "log", label: "log", handlerName: "get_match_log_snapshot" },
      { key: "recording", label: "recording", handlerName: "get_match_related_recordings" },
    ],
  },
  {
    family: "court",
    label: "court",
    paramKeys: ["tournamentId", "courtName", "provider", "limit"],
    signals: [
      { key: "assignment", label: "assignment", handlerName: "get_court_assignment_summary" },
      { key: "queue", label: "queue", handlerName: "get_court_match_queue" },
      { key: "results", label: "results", handlerName: "get_court_recent_results" },
      { key: "upcoming", label: "upcoming", handlerName: "get_court_upcoming_matches" },
      { key: "idle", label: "idle", handlerName: "get_court_idle_status" },
      { key: "cluster", label: "cluster", handlerName: "get_court_cluster_summary" },
      { key: "session", label: "session", handlerName: "get_live_session_summary" },
      { key: "recording", label: "recording", handlerName: "get_live_recording_feed" },
      { key: "channel", label: "channel", handlerName: "get_live_channel_summary" },
      { key: "live", label: "live", handlerName: "get_live_session_match_summary" },
    ],
  },
  {
    family: "player",
    label: "player",
    paramKeys: ["userId", "name", "tournamentId", "limit", "status", "category"],
    signals: [
      { key: "strength", label: "strength", handlerName: "get_player_strength_snapshot" },
      { key: "form", label: "form", handlerName: "get_player_recent_form" },
      { key: "evaluation", label: "evaluation", handlerName: "get_player_evaluation_summary" },
      { key: "ranking", label: "ranking", handlerName: "get_player_ranking_snapshot" },
      { key: "reputation", label: "reputation", handlerName: "get_user_reputation_overview" },
      { key: "history", label: "history", handlerName: "get_user_recent_results" },
      { key: "tournaments", label: "tournaments", handlerName: "get_user_upcoming_tournaments" },
      { key: "recent", label: "recent", handlerName: "get_user_recent_results" },
      { key: "upcoming", label: "upcoming", handlerName: "get_user_upcoming_tournaments" },
      { key: "profile", label: "profile", handlerName: "get_user_profile_summary" },
    ],
  },
  {
    family: "user",
    label: "user",
    paramKeys: ["userId", "status", "category", "topicType", "limit", "tournamentId"],
    signals: [
      { key: "account", label: "account", handlerName: "get_user_account_snapshot" },
      { key: "security", label: "security", handlerName: "get_user_security_snapshot" },
      { key: "subscription", label: "subscription", handlerName: "get_user_subscription_summary" },
      { key: "support", label: "support", handlerName: "get_user_support_summary" },
      { key: "complaint", label: "complaint", handlerName: "get_user_complaint_summary" },
      { key: "rating", label: "rating", handlerName: "get_user_rating_history_summary" },
      { key: "assessment", label: "assessment", handlerName: "get_user_assessment_summary" },
      { key: "casual", label: "casual", handlerName: "get_user_casual_overview" },
      { key: "registration", label: "registration", handlerName: "get_user_registration_statuses" },
      { key: "activity", label: "activity", handlerName: "get_user_login_activity" },
    ],
  },
  {
    family: "club",
    label: "club",
    paramKeys: ["clubId", "slug", "limit"],
    signals: [
      { key: "profile", label: "profile", handlerName: "get_club_profile_snapshot" },
      { key: "join", label: "join", handlerName: "get_club_join_request_summary" },
      { key: "event", label: "event", handlerName: "get_club_event_rsvp_summary" },
      { key: "poll", label: "poll", handlerName: "get_club_poll_vote_summary" },
      { key: "news", label: "news", handlerName: "get_club_news_summary" },
      { key: "roles", label: "roles", handlerName: "get_club_member_roles" },
      { key: "upcoming", label: "upcoming", handlerName: "get_club_upcoming_events" },
      { key: "recent", label: "recent", handlerName: "get_club_recent_events" },
      { key: "growth", label: "growth", handlerName: "get_club_growth_snapshot" },
      { key: "engagement", label: "engagement", handlerName: "get_club_engagement_overview" },
    ],
  },
  {
    family: "news",
    label: "news",
    paramKeys: ["slug", "keyword", "tag", "limit"],
    signals: [
      { key: "source", label: "source", handlerName: "get_news_source_summary" },
      { key: "tag", label: "tag", handlerName: "get_news_tag_summary" },
      { key: "recent", label: "recent", handlerName: "get_news_recent_articles" },
      { key: "search", label: "search", handlerName: "get_news_search_overview" },
      { key: "block", label: "block", handlerName: "get_cms_block_summary" },
      { key: "homepage", label: "homepage", handlerName: "get_cms_homepage_summary" },
      { key: "help", label: "help", handlerName: "get_cms_help_summary" },
      { key: "section", label: "section", handlerName: "get_cms_section_summary" },
      { key: "digest", label: "digest", handlerName: "get_news_recent_articles" },
      { key: "archive", label: "archive", handlerName: "get_news_search_overview" },
    ],
  },
  {
    family: "support",
    label: "support",
    paramKeys: ["userId", "status", "topicType", "provider", "tournamentId", "limit"],
    signals: [
      { key: "ticket", label: "ticket", handlerName: "get_support_ticket_overview" },
      { key: "complaint", label: "complaint", handlerName: "get_complaint_overview" },
      { key: "subscription", label: "subscription", handlerName: "get_subscription_plan_overview" },
      { key: "plan", label: "plan", handlerName: "get_subscription_plan_overview" },
      { key: "radar", label: "radar", handlerName: "get_radar_presence_summary" },
      { key: "intent", label: "intent", handlerName: "get_radar_intent_summary" },
      { key: "channel", label: "channel", handlerName: "get_channel_directory_summary" },
      { key: "sponsor", label: "sponsor", handlerName: "get_sponsor_directory_summary" },
      { key: "release", label: "release", handlerName: "get_app_release_summary" },
      { key: "update", label: "update", handlerName: "get_app_update_summary" },
    ],
  },
  {
    family: "ops",
    label: "ops",
    paramKeys: ["platform", "provider", "slug", "keyword", "limit"],
    signals: [
      { key: "release", label: "release", handlerName: "get_app_release_summary" },
      { key: "update", label: "update", handlerName: "get_app_update_summary" },
      { key: "ota", label: "ota", handlerName: "get_ota_bundle_summary" },
      { key: "radar_presence", label: "radar presence", handlerName: "get_radar_presence_summary" },
      { key: "radar_intent", label: "radar intent", handlerName: "get_radar_intent_summary" },
      { key: "channel_directory", label: "channel directory", handlerName: "get_channel_directory_summary" },
      { key: "sponsor_directory", label: "sponsor directory", handlerName: "get_sponsor_directory_summary" },
      { key: "cms_homepage", label: "CMS homepage", handlerName: "get_cms_homepage_summary" },
      { key: "cms_help", label: "CMS help", handlerName: "get_cms_help_summary" },
      { key: "app_version", label: "app version", handlerName: "get_app_release_summary" },
    ],
  },
];

function uniq(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function buildGeneratedDescription(familyLabel, signalLabel, viewLabel) {
  return `Get ${familyLabel} ${signalLabel} ${viewLabel} using a read-only preset tool.`;
}

export const GENERATED_PRESET_TOOL_SPECS = GENERATED_FAMILY_CONFIGS.flatMap((familyConfig) =>
  familyConfig.signals.flatMap((signalConfig) =>
    GENERATED_VIEWS.map((viewConfig) => ({
      name: `get_${familyConfig.family}_${signalConfig.key}_${viewConfig.key}_preset`,
      description: buildGeneratedDescription(
        familyConfig.label,
        signalConfig.label,
        viewConfig.label,
      ),
      family: familyConfig.family,
      signal: signalConfig.key,
      view: viewConfig.key,
      handlerName: signalConfig.handlerName,
      paramKeys: uniq([...(familyConfig.paramKeys || []), ...(signalConfig.paramKeys || [])]),
      required: uniq([...(familyConfig.required || []), ...(signalConfig.required || [])]),
    })),
  ),
);

if (GENERATED_PRESET_TOOL_SPECS.length !== 1000) {
  throw new Error(
    `Expected 1000 generated preset tools, received ${GENERATED_PRESET_TOOL_SPECS.length}`,
  );
}

export const GENERATED_PRESET_TOOL_MAP = Object.fromEntries(
  GENERATED_PRESET_TOOL_SPECS.map((spec) => [spec.name, spec]),
);

export const GENERATED_PRESET_TOOL_COUNT = GENERATED_PRESET_TOOL_SPECS.length;
