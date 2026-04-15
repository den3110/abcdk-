import "@fontsource/source-code-pro/400.css";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Chip,
  Container,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from "@mui/material";
import {
  ApiRounded as ApiIcon,
  ArrowOutwardRounded as ArrowIcon,
  BoltRounded as BoltIcon,
  CheckRounded as CheckIcon,
  ContentCopyRounded as CopyIcon,
  EventRounded as EventIcon,
  GroupsRounded as GroupsIcon,
  LockRounded as LockIcon,
  PublicRounded as PublicIcon,
  SearchRounded as SearchIcon,
  SensorsRounded as SensorsIcon,
  SportsTennisRounded as SportsIcon,
  StreamRounded as StreamIcon,
} from "@mui/icons-material";

const FONT_STACK_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"';
const FONT_STACK_MONO =
  '"Source Code Pro", Menlo, Monaco, monospace';
const STRIPE_TEXT_LIGHT = "#1a2c44";
const STRIPE_SUBTLE_LIGHT = "#50617a";
const STRIPE_TYPE = {
  overline: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 600,
    fontSize: "0.75rem",
    lineHeight: "1rem",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  label: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 600,
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  body: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 400,
    fontSize: "1rem",
    lineHeight: "1.5rem",
  },
  bodyLarge: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 400,
    fontSize: "1.125rem",
    lineHeight: "1.75rem",
  },
  bodySmall: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 400,
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
  cardTitle: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 600,
    fontSize: "1.25rem",
    lineHeight: "1.75rem",
    letterSpacing: "-0.01em",
  },
  panelTitle: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 400,
    fontSize: "1.5rem",
    lineHeight: "2rem",
    letterSpacing: "-0.02em",
  },
  sectionTitle: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 400,
    fontSize: { xs: "2rem", md: "2.5rem" },
    lineHeight: { xs: "2.5rem", md: "3rem" },
    letterSpacing: "-0.03em",
  },
  display: {
    fontFamily: FONT_STACK_SANS,
    fontWeight: 400,
    fontSize: { xs: "2.75rem", md: "3.5rem" },
    lineHeight: { xs: "3rem", md: "4rem" },
    letterSpacing: "-0.045em",
  },
  mono: {
    fontFamily: FONT_STACK_MONO,
    fontWeight: 400,
    fontSize: "0.875rem",
    lineHeight: "1.25rem",
  },
};

const METHOD_STYLES = {
  GET: {
    bgLight: "#e7f1ff",
    fgLight: "#0d5bf2",
    bgDark: "rgba(72, 133, 255, 0.18)",
    fgDark: "#9cc0ff",
  },
  POST: {
    bgLight: "#eaf8f0",
    fgLight: "#177245",
    bgDark: "rgba(40, 167, 98, 0.18)",
    fgDark: "#8dd6b0",
  },
  PUT: {
    bgLight: "#fff1e6",
    fgLight: "#a14a12",
    bgDark: "rgba(255, 144, 67, 0.18)",
    fgDark: "#ffc494",
  },
  PATCH: {
    bgLight: "#fff7de",
    fgLight: "#8a6110",
    bgDark: "rgba(214, 177, 45, 0.18)",
    fgDark: "#f5db90",
  },
  DELETE: {
    bgLight: "#ffe7e7",
    fgLight: "#b42318",
    bgDark: "rgba(255, 87, 87, 0.18)",
    fgDark: "#ffb0b0",
  },
};

const CLIENT_HEADERS = [
  {
    name: "Authorization",
    value: "Bearer <token>",
    detail: "Sent automatically when the current client has an auth token.",
  },
  {
    name: "X-Request-Id",
    value: "uuid",
    detail: "Useful for tracing a request through logs and monitoring.",
  },
  {
    name: "X-Timezone",
    value: "Asia/Saigon",
    detail: "The web client also sends GMT and minute offset variants.",
  },
  {
    name: "X-Device-Id",
    value: "web-visitor-id",
    detail: "Included by current clients together with X-Device-Name.",
  },
];

const ACCESS_FILTERS = [
  { value: "all", label: "All endpoints" },
  { value: "public", label: "Public only" },
  { value: "bearer", label: "Auth required" },
];

const DOC_SECTIONS = [
  {
    id: "auth",
    eyebrow: "Identity",
    title: "Auth and session APIs",
    summary:
      "Create accounts, sign in from web, rotate sessions and recover passwords.",
    icon: LockIcon,
    accent: "#1f67ff",
    note:
      "The current web flow uses /api/users/auth/web and signup runs without OTP.",
    endpoints: [
      {
        method: "POST",
        path: "/api/users",
        auth: "Public",
        title: "Register a user",
        summary:
          "Create a new player account with profile basics, contact details and optional avatar.",
        body: [
          "name",
          "nickname",
          "phone",
          "dob",
          "email",
          "password",
          "cccd",
          "province",
          "gender",
          "avatar?",
        ],
        request: `curl -X POST {{BASE_URL}}/api/users \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Player Demo",
    "nickname": "pickle.demo",
    "phone": "0901234567",
    "dob": "1996-05-14",
    "email": "player@example.com",
    "password": "secret123",
    "cccd": "079123456789",
    "province": "Ho Chi Minh",
    "gender": "male",
    "avatar": "https://cdn.example.com/avatar.jpg"
  }'`,
        response: `{
  "_id": "65f3c0c1...",
  "name": "Player Demo",
  "nickname": "pickle.demo",
  "email": "player@example.com",
  "token": "jwt-token"
}`,
      },
      {
        method: "POST",
        path: "/api/users/auth/web",
        auth: "Public",
        title: "Create a web session",
        summary:
          "Authenticate with email or phone plus password and return the signed-in user payload.",
        body: ["identifier", "password"],
        request: `curl -X POST {{BASE_URL}}/api/users/auth/web \\
  -H "Content-Type: application/json" \\
  -d '{
    "identifier": "player@example.com",
    "password": "secret123"
  }'`,
        response: `{
  "_id": "65f3c0c1...",
  "name": "Player Demo",
  "role": "user",
  "token": "jwt-token"
}`,
        notes: [
          "Mobile clients still have a separate /api/users/auth route.",
          "Current web clients send requests with credentials enabled.",
        ],
      },
      {
        method: "POST",
        path: "/api/users/logout",
        auth: "Bearer",
        title: "End the current session",
        summary:
          "Logs the active user out and clears the web session on the backend.",
        request: `curl -X POST {{BASE_URL}}/api/users/logout \\
  -H "Authorization: Bearer <token>"`,
        response: `{
  "message": "Logged out successfully"
}`,
      },
      {
        method: "POST",
        path: "/api/users/forgot-password",
        auth: "Public",
        title: "Start password recovery",
        summary:
          "Request a password reset flow by sending the account email.",
        body: ["email"],
        request: `curl -X POST {{BASE_URL}}/api/users/forgot-password \\
  -H "Content-Type: application/json" \\
  -d '{
    "email": "player@example.com"
  }'`,
        response: `{
  "message": "Reset instructions sent",
  "masked": "pl***@example.com"
}`,
      },
      {
        method: "POST",
        path: "/api/users/reset-password",
        auth: "Public",
        title: "Confirm password reset",
        summary:
          "Finalize the reset flow with the reset token and the new password.",
        body: ["token", "password"],
        request: `curl -X POST {{BASE_URL}}/api/users/reset-password \\
  -H "Content-Type: application/json" \\
  -d '{
    "token": "reset-token",
    "password": "newSecret123"
  }'`,
        response: `{
  "message": "Password updated successfully"
}`,
      },
    ],
  },
  {
    id: "profiles",
    eyebrow: "Profiles",
    title: "Profile and ranking APIs",
    summary:
      "Fetch user profiles, match history and ranking data used across the public app.",
    icon: SportsIcon,
    accent: "#0f766e",
    note:
      "Response examples below are representative. Some list endpoints are normalized client-side from array or wrapper payloads.",
    endpoints: [
      {
        method: "GET",
        path: "/api/users/profile",
        auth: "Bearer",
        title: "Get the current profile",
        summary:
          "Return the signed-in profile that powers account pages and session refresh.",
        request: `curl {{BASE_URL}}/api/users/profile \\
  -H "Authorization: Bearer <token>"`,
        response: `{
  "_id": "65f3c0c1...",
  "name": "Player Demo",
  "nickname": "pickle.demo",
  "email": "player@example.com",
  "province": "Ho Chi Minh"
}`,
      },
      {
        method: "PUT",
        path: "/api/users/profile",
        auth: "Bearer",
        title: "Update the current profile",
        summary:
          "Persist editable profile fields such as nickname, avatar or province.",
        body: ["name?", "nickname?", "avatar?", "province?", "gender?"],
        request: `curl -X PUT {{BASE_URL}}/api/users/profile \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "nickname": "pickle.demo.pro",
    "province": "Da Nang",
    "avatar": "https://cdn.example.com/new-avatar.jpg"
  }'`,
        response: `{
  "_id": "65f3c0c1...",
  "nickname": "pickle.demo.pro",
  "province": "Da Nang"
}`,
      },
      {
        method: "GET",
        path: "/api/users/:id/public",
        auth: "Public",
        title: "Get a public player profile",
        summary:
          "Load a profile card for public pages, rankings and club/member views.",
        request: `curl {{BASE_URL}}/api/users/65f3c0c1/public`,
        response: `{
  "_id": "65f3c0c1...",
  "name": "Player Demo",
  "nickname": "pickle.demo",
  "avatar": "https://cdn.example.com/avatar.jpg",
  "ranking": {
    "single": 4.21,
    "double": 4.38
  }
}`,
      },
      {
        method: "GET",
        path: "/api/users/:id/ratings",
        auth: "Public",
        title: "Get rating history",
        summary:
          "Fetch rating history for charts and player profile timelines.",
        query: ["page?", "limit?", "all=1?"],
        request: `curl "{{BASE_URL}}/api/users/65f3c0c1/ratings?page=1&limit=12"`,
        response: `{
  "items": [
    {
      "_id": "rating-history-id",
      "value": 4.38,
      "createdAt": "2026-04-11T03:24:00.000Z"
    }
  ],
  "page": 1,
  "pages": 3
}`,
      },
      {
        method: "GET",
        path: "/api/users/:id/matches",
        auth: "Public",
        title: "Get match history",
        summary:
          "Return paginated match history for a player profile.",
        query: ["page?", "limit?", "all=1?"],
        request: `curl "{{BASE_URL}}/api/users/65f3c0c1/matches?page=1&limit=10"`,
        response: `{
  "items": [
    {
      "_id": "match-id",
      "tournamentName": "Open Spring Cup",
      "status": "finished",
      "playedAt": "2026-04-09T09:00:00.000Z"
    }
  ],
  "page": 1,
  "pages": 8
}`,
      },
      {
        method: "GET",
        path: "/api/rankings/rankings/v2",
        auth: "Public",
        title: "List public rankings",
        summary:
          "Primary ranking list endpoint used by the public rankings screen.",
        query: ["cursor?", "page?", "limit?", "keyword?"],
        request: `curl "{{BASE_URL}}/api/rankings/rankings/v2?page=1&limit=12&keyword=demo"`,
        response: `{
  "docs": [
    {
      "_id": "65f3c0c1...",
      "nickname": "pickle.demo",
      "single": 4.21,
      "double": 4.38
    }
  ],
  "page": 1,
  "totalPages": 14
}`,
      },
      {
        method: "GET",
        path: "/api/rankings/podium30d",
        auth: "Public",
        title: "Get 30-day podiums",
        summary:
          "Return leaderboard highlights for the public rankings landing experience.",
        request: `curl {{BASE_URL}}/api/rankings/podium30d`,
        response: `{
  "podiums30d": {
    "single": [{ "_id": "user-a", "nickname": "alpha" }],
    "double": [{ "_id": "user-b", "nickname": "beta" }]
  }
}`,
      },
    ],
  },
  {
    id: "tournaments",
    eyebrow: "Competition",
    title: "Tournament APIs",
    summary:
      "Browse tournaments, inspect brackets, register for events and support check-in flows.",
    icon: EventIcon,
    accent: "#b45309",
    note:
      "Current clients use these endpoints for the public tournament list, detail pages, registration and check-in UX.",
    endpoints: [
      {
        method: "GET",
        path: "/api/tournaments",
        auth: "Public",
        title: "List tournaments",
        summary:
          "Fetch tournaments for cards, search, command palette and home surfaces.",
        query: ["limit?", "sort?", "keyword?", "sportType?", "groupId?"],
        request: `curl "{{BASE_URL}}/api/tournaments?limit=12&sort=-updatedAt"`,
        response: `[
  {
    "_id": "tour-id",
    "name": "Open Spring Cup",
    "startDate": "2026-05-12T00:00:00.000Z",
    "status": "open"
  }
]`,
        notes: [
          "The web client tolerates array responses and wrapped list responses.",
        ],
      },
      {
        method: "GET",
        path: "/api/tournaments/:id",
        auth: "Public",
        title: "Get tournament detail",
        summary:
          "Load a single tournament with overview information for the public detail page.",
        request: `curl {{BASE_URL}}/api/tournaments/tour-id`,
        response: `{
  "_id": "tour-id",
  "name": "Open Spring Cup",
  "eventType": "double",
  "location": "Ho Chi Minh City",
  "registrationOpen": true
}`,
      },
      {
        method: "POST",
        path: "/api/tournaments/:id/registrations",
        auth: "Bearer",
        title: "Create a tournament registration",
        summary:
          "Submit a user registration or roster entry, depending on event type and tournament mode.",
        body: [
          "player1Id",
          "player2Id?",
          "teamFactionId?",
          "message?",
          "eventType?",
        ],
        request: `curl -X POST {{BASE_URL}}/api/tournaments/tour-id/registrations \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "player1Id": "user-a",
    "player2Id": "user-b",
    "message": "Ready to play doubles",
    "eventType": "double"
  }'`,
        response: `{
  "_id": "registration-id",
  "status": "pending",
  "tournamentId": "tour-id"
}`,
        notes: [
          "Payload varies by event type and tournament configuration.",
        ],
      },
      {
        method: "GET",
        path: "/api/tournaments/:id/brackets",
        auth: "Public",
        title: "List brackets",
        summary:
          "Return bracket collections for a tournament detail or draw viewer.",
        request: `curl {{BASE_URL}}/api/tournaments/tour-id/brackets`,
        response: `[
  {
    "_id": "bracket-id",
    "name": "Mixed Doubles A",
    "format": "single_elimination"
  }
]`,
      },
      {
        method: "GET",
        path: "/api/tournaments/:id/matches",
        auth: "Public",
        title: "List tournament matches",
        summary:
          "Power schedule views, bracket views and match lookups for a tournament.",
        query: ["page?", "limit?", "status?", "bracketId?", "view?"],
        request: `curl "{{BASE_URL}}/api/tournaments/tour-id/matches?view=schedule&page=1&limit=20"`,
        response: `{
  "list": [
    {
      "_id": "match-id",
      "status": "queued",
      "courtName": "Court 2",
      "startTime": "2026-05-12T08:30:00.000Z"
    }
  ],
  "total": 64
}`,
      },
      {
        method: "GET",
        path: "/api/tournaments/checkin/search",
        auth: "Public",
        title: "Search registrations for check-in",
        summary:
          "Search by phone or nickname to prepare the user-facing check-in flow.",
        query: ["tournamentId", "q"],
        request: `curl "{{BASE_URL}}/api/tournaments/checkin/search?tournamentId=tour-id&q=0901"`,
        response: `{
  "items": [
    {
      "_id": "registration-id",
      "playerName": "Player Demo",
      "status": "pending_checkin"
    }
  ]
}`,
      },
      {
        method: "POST",
        path: "/api/tournaments/checkin",
        auth: "Bearer",
        title: "Confirm user check-in",
        summary:
          "Complete check-in for the current user after a registration lookup.",
        body: ["tournamentId", "q", "regId"],
        request: `curl -X POST {{BASE_URL}}/api/tournaments/checkin \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tournamentId": "tour-id",
    "q": "0901234567",
    "regId": "registration-id"
  }'`,
        response: `{
  "message": "Check-in successful",
  "registrationId": "registration-id"
}`,
      },
    ],
  },
  {
    id: "clubs",
    eyebrow: "Community",
    title: "Club APIs",
    summary:
      "Support club discovery, membership workflows, announcements and event participation.",
    icon: GroupsIcon,
    accent: "#0f4c81",
    note:
      "Club detail routes accept both object ids and slugs on the current backend.",
    endpoints: [
      {
        method: "GET",
        path: "/api/clubs",
        auth: "Public",
        title: "List clubs",
        summary:
          "Discover public clubs or filter down to the current user's memberships.",
        query: ["page?", "limit?", "q?", "mine?"],
        request: `curl "{{BASE_URL}}/api/clubs?page=1&limit=12"`,
        response: `{
  "items": [
    {
      "_id": "club-id",
      "name": "Saigon Smashers",
      "visibility": "public",
      "memberCount": 124
    }
  ],
  "count": 1
}`,
      },
      {
        method: "GET",
        path: "/api/clubs/:id",
        auth: "Public",
        title: "Get a club detail page",
        summary:
          "Load a public club, or a hidden club for members/admins when authorized.",
        request: `curl {{BASE_URL}}/api/clubs/saigon-smashers`,
        response: `{
  "_id": "club-id",
  "name": "Saigon Smashers",
  "description": "Competitive pickleball community",
  "joinPolicy": "approval"
}`,
      },
      {
        method: "POST",
        path: "/api/clubs",
        auth: "Public",
        title: "Create a club",
        summary:
          "Create a new club with branding, visibility and membership settings.",
        body: [
          "name",
          "description",
          "sportTypes",
          "visibility",
          "joinPolicy",
          "memberVisibility",
          "province",
          "city",
          "shortCode?",
          "logoUrl?",
          "coverUrl?",
        ],
        request: `curl -X POST {{BASE_URL}}/api/clubs \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Saigon Smashers",
    "description": "Competitive pickleball community",
    "sportTypes": ["pickleball"],
    "visibility": "public",
    "joinPolicy": "approval",
    "memberVisibility": "admins",
    "province": "Ho Chi Minh",
    "city": "Thu Duc",
    "shortCode": "SSM",
    "logoUrl": "https://cdn.example.com/club-logo.jpg"
  }'`,
        response: `{
  "_id": "club-id",
  "name": "Saigon Smashers",
  "slug": "saigon-smashers"
}`,
      },
      {
        method: "POST",
        path: "/api/clubs/:id/join",
        auth: "Bearer",
        title: "Request to join a club",
        summary:
          "Join immediately for open clubs or create a pending approval request.",
        body: ["message?"],
        request: `curl -X POST {{BASE_URL}}/api/clubs/club-id/join \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "message": "Looking for weekend doubles sessions"
  }'`,
        response: `{
  "joined": false,
  "message": "Join request submitted"
}`,
      },
      {
        method: "GET",
        path: "/api/clubs/:id/events",
        auth: "Public",
        title: "List club events",
        summary:
          "Return club events for calendars, upcoming sessions and event cards.",
        query: ["page?", "limit?", "from?", "to?"],
        request: `curl "{{BASE_URL}}/api/clubs/club-id/events?page=1&limit=10"`,
        response: `{
  "items": [
    {
      "_id": "event-id",
      "title": "Saturday social ladder",
      "startsAt": "2026-04-19T01:00:00.000Z",
      "capacity": 24
    }
  ],
  "page": 1
}`,
      },
      {
        method: "POST",
        path: "/api/clubs/:id/events/:eventId/rsvp",
        auth: "Bearer",
        title: "RSVP to a club event",
        summary:
          "Mark the current user as going, not going or clear the RSVP state.",
        body: ["status"],
        request: `curl -X POST {{BASE_URL}}/api/clubs/club-id/events/event-id/rsvp \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "going"
  }'`,
        response: `{
  "status": "going",
  "attendeeCount": 19
}`,
        notes: ['Accepted values: "going", "not_going", "none".'],
      },
      {
        method: "GET",
        path: "/api/clubs/:id/events/:eventId/ics",
        auth: "Public",
        title: "Download an ICS invite",
        summary:
          "Generate a calendar file for a club event so users can add it to their device calendar.",
        request: `curl -OJ {{BASE_URL}}/api/clubs/club-id/events/event-id/ics`,
        response: `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:Saturday social ladder
END:VEVENT
END:VCALENDAR`,
        responseLang: "text",
      },
      {
        method: "GET",
        path: "/api/clubs/:id/announcements",
        auth: "Public",
        title: "List club announcements",
        summary:
          "Fetch announcement posts for club home feeds and admin moderation views.",
        query: ["page?", "limit?"],
        request: `curl "{{BASE_URL}}/api/clubs/club-id/announcements?page=1&limit=10"`,
        response: `{
  "items": [
    {
      "_id": "announcement-id",
      "title": "Court booking reminder",
      "createdAt": "2026-04-14T09:00:00.000Z"
    }
  ],
  "page": 1
}`,
      },
    ],
  },
  {
    id: "live",
    eyebrow: "Streaming",
    title: "Live and feed APIs",
    summary:
      "Power live match shelves, public streaming feeds and court cluster pages.",
    icon: SensorsIcon,
    accent: "#2455d1",
    note:
      "Live feed endpoints already support pagination, filtering and search in the current public frontend.",
    endpoints: [
      {
        method: "GET",
        path: "/api/live/matches",
        auth: "Public",
        title: "List live-capable matches",
        summary:
          "Query scheduled, queued, assigned or live matches for dashboards and live court pages.",
        query: [
          "statuses?",
          "excludeFinished?",
          "windowMs?",
          "q?",
          "tournamentId?",
          "page?",
          "limit?",
          "all?",
        ],
        request: `curl "{{BASE_URL}}/api/live/matches?statuses=scheduled,queued,assigned,live&windowMs=28800000&page=1&limit=12"`,
        response: `{
  "items": [
    {
      "_id": "match-id",
      "status": "live",
      "video": "https://stream.example.com/live.m3u8"
    }
  ],
  "count": 34,
  "page": 1,
  "pages": 3,
  "countLive": 8
}`,
      },
      {
        method: "GET",
        path: "/api/live/feed",
        auth: "Public",
        title: "List the public live feed",
        summary:
          "Primary feed endpoint for the public live watch experience with smart sorting.",
        query: [
          "page",
          "limit",
          "q?",
          "tournamentId?",
          "mode?",
          "source?",
          "replayState?",
          "sort?",
        ],
        request: `curl "{{BASE_URL}}/api/live/feed?page=1&limit=8&mode=all&source=all&replayState=all&sort=smart"`,
        response: `{
  "items": [
    {
      "_id": "feed-item-id",
      "title": "Court 2 live now",
      "source": "manual",
      "mode": "live"
    }
  ],
  "count": 18,
  "page": 1,
  "pages": 3,
  "limit": 8
}`,
      },
      {
        method: "GET",
        path: "/api/live/feed/search",
        auth: "Public",
        title: "Search inside the feed",
        summary:
          "Low-latency search endpoint used for live feed autocomplete and quick filtering.",
        query: [
          "q?",
          "tournamentId?",
          "mode?",
          "source?",
          "replayState?",
          "sort?",
          "limit?",
        ],
        request: `curl "{{BASE_URL}}/api/live/feed/search?q=semi&limit=8"`,
        response: `{
  "items": [
    {
      "_id": "feed-item-id",
      "title": "Semi-final court stream"
    }
  ],
  "count": 4,
  "limit": 8
}`,
      },
      {
        method: "GET",
        path: "/api/live/clusters",
        auth: "Public",
        title: "List live clusters",
        summary:
          "Return public cluster collections that group together courts or streams.",
        request: `curl {{BASE_URL}}/api/live/clusters`,
        response: `{
  "items": [
    {
      "_id": "cluster-id",
      "name": "Championship cluster",
      "courtCount": 4
    }
  ]
}`,
      },
      {
        method: "GET",
        path: "/api/live/clusters/:clusterId",
        auth: "Public",
        title: "Get one live cluster",
        summary:
          "Load a cluster page with its courts, streams and metadata.",
        request: `curl {{BASE_URL}}/api/live/clusters/cluster-id`,
        response: `{
  "_id": "cluster-id",
  "name": "Championship cluster",
  "courts": [
    {
      "_id": "court-id",
      "name": "Court 1"
    }
  ]
}`,
      },
      {
        method: "GET",
        path: "/api/live/courts/:courtStationId",
        auth: "Public",
        title: "Get one live court",
        summary:
          "Return a single public court station with active stream and next-match context.",
        request: `curl {{BASE_URL}}/api/live/courts/court-id`,
        response: `{
  "_id": "court-id",
  "name": "Court 1",
  "stream": {
    "status": "live",
    "video": "https://stream.example.com/live.m3u8"
  }
}`,
      },
    ],
  },
];

function getMethodPalette(method, mode) {
  const palette = METHOD_STYLES[method] || METHOD_STYLES.GET;
  return mode === "dark"
    ? { backgroundColor: palette.bgDark, color: palette.fgDark }
    : { backgroundColor: palette.bgLight, color: palette.fgLight };
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesAccessFilter(endpoint, accessFilter) {
  if (accessFilter === "public") {
    return normalizeText(endpoint.auth) === "public";
  }

  if (accessFilter === "bearer") {
    return normalizeText(endpoint.auth) !== "public";
  }

  return true;
}

function endpointMatchesSearch(endpoint, searchTerm) {
  const query = normalizeText(searchTerm);
  if (!query) return true;

  const haystack = [
    endpoint.method,
    endpoint.path,
    endpoint.title,
    endpoint.summary,
    endpoint.auth,
    ...(endpoint.query || []),
    ...(endpoint.body || []),
    ...(endpoint.notes || []),
  ]
    .map(normalizeText)
    .join(" ");

  return haystack.includes(query);
}

function sectionMatchesSearch(section, searchTerm) {
  const query = normalizeText(searchTerm);
  if (!query) return true;

  const haystack = [section.eyebrow, section.title, section.summary, section.note]
    .map(normalizeText)
    .join(" ");

  return haystack.includes(query);
}

function CodePanel({
  label,
  code,
  language = "bash",
  theme,
  copyId,
  copied,
  onCopy,
}) {
  const dark = theme.palette.mode === "dark";

  return (
    <Box
      sx={{
        minWidth: 0,
        borderRadius: 3,
        border: `1px solid ${alpha(theme.palette.common.black, dark ? 0 : 0.06)}`,
        background:
          theme.palette.mode === "dark"
            ? "linear-gradient(180deg, rgba(14,19,32,0.95), rgba(10,14,25,0.98))"
            : "linear-gradient(180deg, #ffffff, #f8fafc)",
        boxShadow:
          theme.palette.mode === "dark"
            ? "0 20px 42px rgba(0,0,0,0.28)"
            : "0 20px 42px rgba(15, 23, 42, 0.06)",
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        sx={{
          px: 2,
          py: 1.25,
          borderBottom: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.06)}`,
        }}
      >
        <Typography
          variant="overline"
          sx={{
            ...STRIPE_TYPE.overline,
            color: "text.secondary",
          }}
        >
          {label}
        </Typography>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography
            variant="caption"
            sx={{
              ...STRIPE_TYPE.overline,
              color: "text.secondary",
            }}
          >
            {language}
          </Typography>
          {onCopy ? (
            <Tooltip title={copied ? "Copied" : "Copy code"}>
              <IconButton
                size="small"
                aria-label={copied ? "Copied" : "Copy code"}
                onClick={() => onCopy(copyId, code)}
                sx={{
                  color: copied ? "success.main" : "text.secondary",
                  border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.12 : 0.08)}`,
                  borderRadius: 2,
                }}
              >
                {copied ? (
                  <CheckIcon sx={{ fontSize: 16 }} />
                ) : (
                  <CopyIcon sx={{ fontSize: 16 }} />
                )}
              </IconButton>
            </Tooltip>
          ) : null}
        </Stack>
      </Stack>
      <Box
        component="pre"
        sx={{
          m: 0,
          p: 2,
          overflowX: "auto",
          ...STRIPE_TYPE.mono,
          color:
            theme.palette.mode === "dark" ? "#dce7ff" : STRIPE_TEXT_LIGHT,
        }}
      >
        <Box component="code">{code}</Box>
      </Box>
    </Box>
  );
}

function EndpointCard({ endpoint, theme, copiedKey, onCopyCode }) {
  const dark = theme.palette.mode === "dark";
  const isPublic = endpoint.auth === "Public";

  return (
    <Box
      sx={{
        borderRadius: 5,
        border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.08)}`,
        background:
          theme.palette.mode === "dark"
            ? "linear-gradient(180deg, rgba(18,24,39,0.92), rgba(10,14,25,0.98))"
            : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,250,252,0.96))",
        boxShadow:
          theme.palette.mode === "dark"
            ? "0 26px 60px rgba(0,0,0,0.28)"
            : "0 26px 60px rgba(15, 23, 42, 0.07)",
        p: { xs: 2.2, md: 3 },
      }}
    >
      <Stack spacing={2.4}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.2}
          justifyContent="space-between"
          alignItems={{ xs: "flex-start", sm: "center" }}
        >
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Chip
              label={endpoint.method}
              size="small"
              sx={{
                fontFamily: FONT_STACK_SANS,
                fontWeight: 600,
                letterSpacing: "0.06em",
                borderRadius: 999,
                ...getMethodPalette(endpoint.method, theme.palette.mode),
              }}
            />
            <Chip
              icon={isPublic ? <PublicIcon /> : <LockIcon />}
              label={endpoint.auth}
              size="small"
              variant="outlined"
              sx={{
                borderRadius: 999,
                borderColor: alpha(theme.palette.text.primary, dark ? 0.16 : 0.12),
                color: "text.secondary",
              }}
            />
          </Stack>
          <Box
            component="code"
            sx={{
              px: 1.4,
              py: 0.85,
              borderRadius: 2.5,
              bgcolor: alpha(theme.palette.text.primary, dark ? 0.08 : 0.04),
              color: dark ? "#e8f0ff" : STRIPE_TEXT_LIGHT,
              fontSize: "0.8rem",
              fontFamily: FONT_STACK_MONO,
              overflowX: "auto",
              maxWidth: "100%",
            }}
          >
            {endpoint.path}
          </Box>
        </Stack>

        <Stack spacing={0.85}>
          <Typography
            variant="h5"
            sx={{
              ...STRIPE_TYPE.cardTitle,
            }}
          >
            {endpoint.title}
          </Typography>
          <Typography
            sx={{
              ...STRIPE_TYPE.body,
              color: "text.secondary",
              maxWidth: 920,
            }}
          >
            {endpoint.summary}
          </Typography>
        </Stack>

        <Stack direction={{ xs: "column", md: "row" }} spacing={1.2} flexWrap="wrap">
          {endpoint.query?.length ? (
            <Stack direction="row" spacing={0.9} flexWrap="wrap" useFlexGap>
              <Typography
                variant="caption"
                sx={{
                  ...STRIPE_TYPE.overline,
                  alignSelf: "center",
                  color: "text.secondary",
                }}
              >
                Query
              </Typography>
              {endpoint.query.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  size="small"
                  variant="outlined"
                  sx={{ borderRadius: 999 }}
                />
              ))}
            </Stack>
          ) : null}

          {endpoint.body?.length ? (
            <Stack direction="row" spacing={0.9} flexWrap="wrap" useFlexGap>
              <Typography
                variant="caption"
                sx={{
                  ...STRIPE_TYPE.overline,
                  alignSelf: "center",
                  color: "text.secondary",
                }}
              >
                Body
              </Typography>
              {endpoint.body.map((item) => (
                <Chip
                  key={item}
                  label={item}
                  size="small"
                  variant="outlined"
                  sx={{ borderRadius: 999 }}
                />
              ))}
            </Stack>
          ) : null}
        </Stack>

        <Box
          sx={{
            display: "grid",
            gap: 1.5,
            gridTemplateColumns: { xs: "1fr", xl: "1fr 1fr" },
          }}
        >
          <CodePanel
            label="Request"
            code={endpoint.request}
            theme={theme}
            copyId={`${endpoint.method}-${endpoint.path}-request`}
            copied={copiedKey === `${endpoint.method}-${endpoint.path}-request`}
            onCopy={onCopyCode}
          />
          <CodePanel
            label="Representative response"
            code={endpoint.response}
            language={endpoint.responseLang || "json"}
            theme={theme}
            copyId={`${endpoint.method}-${endpoint.path}-response`}
            copied={copiedKey === `${endpoint.method}-${endpoint.path}-response`}
            onCopy={onCopyCode}
          />
        </Box>

        {endpoint.notes?.length ? (
          <Stack spacing={0.6}>
            {endpoint.notes.map((note) => (
              <Typography
                key={note}
                variant="body2"
                sx={{
                  color: "text.secondary",
                  fontFamily: FONT_STACK_SANS,
                  lineHeight: 1.65,
                }}
              >
                {note}
              </Typography>
            ))}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  );
}

const themePropType = PropTypes.shape({
  palette: PropTypes.shape({
    mode: PropTypes.oneOf(["light", "dark"]).isRequired,
    common: PropTypes.shape({
      black: PropTypes.string.isRequired,
    }).isRequired,
    text: PropTypes.shape({
      primary: PropTypes.string.isRequired,
    }).isRequired,
  }).isRequired,
});

const endpointPropType = PropTypes.shape({
  method: PropTypes.string.isRequired,
  path: PropTypes.string.isRequired,
  auth: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  summary: PropTypes.string.isRequired,
  query: PropTypes.arrayOf(PropTypes.string),
  body: PropTypes.arrayOf(PropTypes.string),
  request: PropTypes.string.isRequired,
  response: PropTypes.string.isRequired,
  responseLang: PropTypes.string,
  notes: PropTypes.arrayOf(PropTypes.string),
});

CodePanel.propTypes = {
  label: PropTypes.string.isRequired,
  code: PropTypes.string.isRequired,
  language: PropTypes.string,
  theme: themePropType.isRequired,
  copyId: PropTypes.string,
  copied: PropTypes.bool,
  onCopy: PropTypes.func,
};

EndpointCard.propTypes = {
  endpoint: endpointPropType.isRequired,
  theme: themePropType.isRequired,
  copiedKey: PropTypes.string,
  onCopyCode: PropTypes.func,
};

export default function ApiDocsPage() {
  const theme = useTheme();
  const dark = theme.palette.mode === "dark";
  const sectionIds = DOC_SECTIONS.map((section) => section.id);
  const [activeSection, setActiveSection] = useState(sectionIds[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [copiedKey, setCopiedKey] = useState("");
  const endpointCount = DOC_SECTIONS.reduce(
    (total, section) => total + section.endpoints.length,
    0,
  );
  const filteredSections = useMemo(() => {
    return DOC_SECTIONS.map((section) => {
      const endpoints = section.endpoints.filter(
        (endpoint) =>
          matchesAccessFilter(endpoint, accessFilter) &&
          (endpointMatchesSearch(endpoint, searchTerm) ||
            sectionMatchesSearch(section, searchTerm)),
      );

      return {
        ...section,
        endpoints,
      };
    }).filter((section) => {
      if (section.endpoints.length > 0) return true;
      return sectionMatchesSearch(section, searchTerm);
    });
  }, [accessFilter, searchTerm]);
  const filteredEndpointCount = filteredSections.reduce(
    (total, section) => total + section.endpoints.length,
    0,
  );
  const visibleSectionIds = useMemo(
    () => filteredSections.map((section) => section.id),
    [filteredSections],
  );
  const runtimeBaseUrl =
    String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "") ||
    (typeof window !== "undefined"
      ? window.location.origin.replace(/\/+$/, "")
      : "https://pickletour.vn");

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);

        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      {
        rootMargin: "-18% 0px -56% 0px",
        threshold: [0.15, 0.3, 0.55],
      },
    );

    visibleSectionIds.forEach((id) => {
      const node = document.getElementById(id);
      if (node) observer.observe(node);
    });

    return () => observer.disconnect();
  }, [visibleSectionIds]);

  useEffect(() => {
    if (!copiedKey) return undefined;

    const timeoutId = window.setTimeout(() => {
      setCopiedKey("");
    }, 1800);

    return () => window.clearTimeout(timeoutId);
  }, [copiedKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return;

    const node = document.getElementById(hash);
    if (!node) return;

    window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveSection(hash);
    });
  }, []);

  useEffect(() => {
    if (!visibleSectionIds.length) return;
    if (visibleSectionIds.includes(activeSection)) return;
    setActiveSection(visibleSectionIds[0]);
  }, [activeSection, visibleSectionIds]);

  const jumpToSection = (id) => {
    if (typeof window === "undefined") return;
    const node = document.getElementById(id);
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActiveSection(id);
  };

  const copyCode = async (key, text) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
      }
    } catch (error) {
      console.error("Cannot copy code block", error);
    }
  };

  return (
    <>
      <Helmet>
        <title>PickleTour User API Docs</title>
        <meta
          name="description"
          content="User-facing API documentation for PickleTour auth, profiles, tournaments, clubs and live features."
        />
      </Helmet>

      <Box
        sx={{
          minHeight: "100%",
          fontFamily: FONT_STACK_SANS,
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          background:
            theme.palette.mode === "dark"
              ? "linear-gradient(180deg, #07101f 0%, #091221 38%, #050912 100%)"
              : "linear-gradient(180deg, #f4f7fb 0%, #f8fafc 28%, #ffffff 100%)",
          color: theme.palette.mode === "dark" ? "text.primary" : STRIPE_TEXT_LIGHT,
        }}
      >
        <Box
          sx={{
            position: "relative",
            overflow: "hidden",
            borderBottom: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.06)}`,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              background: dark
                ? `
                  radial-gradient(circle at 12% 18%, rgba(31,103,255,0.2), transparent 32%),
                  radial-gradient(circle at 88% 12%, rgba(15,118,110,0.18), transparent 30%),
                  radial-gradient(circle at 78% 62%, rgba(36,85,209,0.18), transparent 34%)
                `
                : `
                  radial-gradient(circle at 12% 18%, rgba(31,103,255,0.12), transparent 30%),
                  radial-gradient(circle at 88% 12%, rgba(15,118,110,0.12), transparent 28%),
                  radial-gradient(circle at 78% 62%, rgba(36,85,209,0.1), transparent 32%)
                `,
            }}
          />

          <Container
            maxWidth={false}
            sx={{ maxWidth: 1440, px: { xs: 2, md: 4, xl: 6 } }}
          >
            <Box
              sx={{
                pt: { xs: 5, md: 8 },
                pb: { xs: 4.5, md: 6.5 },
                position: "relative",
              }}
            >
              <Stack spacing={3.2}>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Chip
                    icon={<ApiIcon />}
                    label="User API docs"
                    sx={{
                      borderRadius: 999,
                      bgcolor: alpha("#1f67ff", dark ? 0.18 : 0.1),
                      color: dark ? "#b8cfff" : "#0d47bf",
                      fontFamily: FONT_STACK_SANS,
                      fontWeight: 600,
                    }}
                  />
                  <Chip
                    icon={<BoltIcon />}
                    label={
                      filteredEndpointCount === endpointCount
                        ? `${endpointCount} reference endpoints`
                        : `${filteredEndpointCount}/${endpointCount} endpoints shown`
                    }
                    sx={{
                      borderRadius: 999,
                      fontFamily: FONT_STACK_SANS,
                      fontWeight: 600,
                    }}
                    variant="outlined"
                  />
                  <Chip
                    icon={<StreamIcon />}
                    label="REST + JSON"
                    sx={{
                      borderRadius: 999,
                      fontFamily: FONT_STACK_SANS,
                      fontWeight: 600,
                    }}
                    variant="outlined"
                  />
                </Stack>

                <Box
                  sx={{
                    display: "grid",
                    gap: { xs: 3, lg: 4 },
                    gridTemplateColumns: {
                      xs: "1fr",
                      xl: "minmax(0, 1.15fr) minmax(360px, 0.85fr)",
                    },
                    alignItems: "start",
                  }}
                >
                  <Stack spacing={2.2}>
                    <Typography
                      variant="h1"
                      sx={{
                        ...STRIPE_TYPE.display,
                        maxWidth: 920,
                        color: dark ? "text.primary" : STRIPE_TEXT_LIGHT,
                      }}
                    >
                      Ship user flows on top of the same APIs the PickleTour clients already use.
                    </Typography>

                    <Typography
                      sx={{
                        ...STRIPE_TYPE.bodyLarge,
                        color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                        maxWidth: 820,
                      }}
                    >
                      This page documents the user-facing auth, profile, tournament,
                      club and live endpoints currently wired into the web and mobile
                      clients. The structure follows a docs landing plus reference
                      layout, with use-case entry points first and concrete request
                      examples right after.
                    </Typography>

                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.2}>
                      <Button
                        variant="contained"
                        disableElevation
                        onClick={() => jumpToSection("auth")}
                        endIcon={<ArrowIcon />}
                        sx={{
                          alignSelf: "flex-start",
                          px: 2.4,
                          py: 1.15,
                          borderRadius: 999,
                          textTransform: "none",
                          ...STRIPE_TYPE.label,
                          backgroundColor: "#0f172a",
                          color: "#fff",
                          "&:hover": {
                            backgroundColor: "#0b1220",
                          },
                        }}
                      >
                        Start with auth
                      </Button>
                      <Button
                        variant="outlined"
                        onClick={() => jumpToSection("tournaments")}
                        sx={{
                          alignSelf: "flex-start",
                          px: 2.4,
                          py: 1.15,
                          borderRadius: 999,
                          textTransform: "none",
                          ...STRIPE_TYPE.label,
                        }}
                      >
                        Browse collections
                      </Button>
                    </Stack>

                    <Stack spacing={1.4}>
                      <TextField
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        placeholder="Search by endpoint path, method, or feature"
                        fullWidth
                        InputProps={{
                          startAdornment: (
                            <SearchIcon
                              sx={{
                                mr: 1,
                                color: "text.secondary",
                                alignSelf: "center",
                              }}
                            />
                          ),
                        }}
                        sx={{
                          maxWidth: 760,
                          "& .MuiOutlinedInput-root": {
                            borderRadius: 999,
                            backgroundColor: alpha(
                              theme.palette.background.paper,
                              dark ? 0.28 : 0.86,
                            ),
                            backdropFilter: "blur(12px)",
                            fontFamily: FONT_STACK_SANS,
                            color: dark ? "text.primary" : STRIPE_TEXT_LIGHT,
                          },
                          "& .MuiOutlinedInput-input": {
                            ...STRIPE_TYPE.body,
                          },
                        }}
                      />

                      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                        {ACCESS_FILTERS.map((filter) => (
                          <Chip
                            key={filter.value}
                            label={filter.label}
                            clickable
                            onClick={() => setAccessFilter(filter.value)}
                            variant={
                              accessFilter === filter.value ? "filled" : "outlined"
                            }
                            sx={{
                              borderRadius: 999,
                              ...STRIPE_TYPE.label,
                              bgcolor:
                                accessFilter === filter.value
                                  ? alpha("#1f67ff", dark ? 0.24 : 0.14)
                                  : "transparent",
                              color:
                                accessFilter === filter.value
                                  ? dark
                                    ? "#bfd2ff"
                                    : "#0d47bf"
                                  : "text.primary",
                            }}
                          />
                        ))}
                      </Stack>
                    </Stack>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 1.2,
                        gridTemplateColumns: {
                          xs: "1fr",
                          sm: "repeat(2, minmax(0, 1fr))",
                        },
                      }}
                    >
                      {[
                        {
                          id: "auth",
                          title: "Onboard and sign in",
                          detail:
                            "Register users, create sessions and recover accounts.",
                          icon: LockIcon,
                        },
                        {
                          id: "profiles",
                          title: "Profiles and rankings",
                          detail:
                            "Load public profiles, history and public leaderboard data.",
                          icon: SportsIcon,
                        },
                        {
                          id: "clubs",
                          title: "Community features",
                          detail:
                            "Create clubs, join members and RSVP to events.",
                          icon: GroupsIcon,
                        },
                        {
                          id: "live",
                          title: "Live watch surfaces",
                          detail:
                            "Search feed items, clusters and live-ready matches.",
                          icon: SensorsIcon,
                        },
                      ].map((item) => {
                        const Icon = item.icon;
                        return (
                          <ButtonBase
                            key={item.id}
                            onClick={() => jumpToSection(item.id)}
                            sx={{
                              textAlign: "left",
                              borderRadius: 4,
                              border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.1 : 0.08)}`,
                              background:
                                theme.palette.mode === "dark"
                                  ? "linear-gradient(180deg, rgba(17,24,39,0.9), rgba(10,14,25,0.96))"
                                  : "linear-gradient(180deg, rgba(255,255,255,0.92), rgba(248,250,252,0.94))",
                              boxShadow:
                                theme.palette.mode === "dark"
                                  ? "0 20px 44px rgba(0,0,0,0.22)"
                                  : "0 20px 44px rgba(15, 23, 42, 0.06)",
                              px: 2,
                              py: 1.8,
                              justifyContent: "flex-start",
                              alignItems: "stretch",
                            }}
                          >
                            <Stack spacing={1.05} sx={{ width: "100%" }}>
                              <Stack
                                direction="row"
                                justifyContent="space-between"
                                alignItems="center"
                              >
                                <Box
                                  sx={{
                                    width: 42,
                                    height: 42,
                                    borderRadius: 3,
                                    display: "grid",
                                    placeItems: "center",
                                    bgcolor: alpha("#1f67ff", dark ? 0.18 : 0.1),
                                    color: dark ? "#bfd2ff" : "#1f67ff",
                                  }}
                                >
                                  <Icon fontSize="small" />
                                </Box>
                                <ArrowIcon
                                  sx={{ color: "text.secondary", fontSize: 18 }}
                                />
                              </Stack>
                              <Typography
                                variant="h6"
                                sx={{
                                  ...STRIPE_TYPE.cardTitle,
                                }}
                              >
                                {item.title}
                              </Typography>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.body,
                                  color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                                }}
                              >
                                {item.detail}
                              </Typography>
                            </Stack>
                          </ButtonBase>
                        );
                      })}
                    </Box>
                  </Stack>

                  <Box
                    sx={{
                      borderRadius: 5,
                      border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.12 : 0.08)}`,
                      background:
                        theme.palette.mode === "dark"
                          ? "linear-gradient(180deg, rgba(16,22,36,0.95), rgba(9,13,24,0.98))"
                          : "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(246,249,252,0.98))",
                      boxShadow:
                        theme.palette.mode === "dark"
                          ? "0 26px 60px rgba(0,0,0,0.26)"
                          : "0 26px 60px rgba(15, 23, 42, 0.08)",
                      p: { xs: 2.2, md: 2.6 },
                    }}
                  >
                    <Stack spacing={2}>
                      <Stack spacing={0.75}>
                        <Typography
                          variant="overline"
                          sx={{
                            ...STRIPE_TYPE.overline,
                            color: "text.secondary",
                          }}
                        >
                          Integration basics
                        </Typography>
                        <Typography
                          variant="h5"
                          sx={{
                            ...STRIPE_TYPE.panelTitle,
                          }}
                        >
                          Base URL and request contract
                        </Typography>
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.body,
                            color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          Current frontend clients use a shared base query with
                          credentialed requests, trace headers and timezone context.
                        </Typography>
                      </Stack>

                      <CodePanel
                        label="Quickstart"
                        code={`curl "${runtimeBaseUrl}/api/tournaments?limit=12&sort=-updatedAt" \\
  -H "Accept: application/json" \\
  -H "X-Request-Id: docs-demo-001"`}
                        theme={theme}
                        copyId="quickstart"
                        copied={copiedKey === "quickstart"}
                        onCopy={copyCode}
                      />

                      <Stack spacing={1}>
                        {CLIENT_HEADERS.map((header) => (
                          <Box
                            key={header.name}
                            sx={{
                              borderRadius: 3,
                              border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.06)}`,
                              px: 1.6,
                              py: 1.4,
                            }}
                          >
                            <Stack
                              direction={{ xs: "column", sm: "row" }}
                              spacing={0.8}
                              justifyContent="space-between"
                            >
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.label,
                                  color: dark ? "text.primary" : STRIPE_TEXT_LIGHT,
                                }}
                              >
                                {header.name}
                              </Typography>
                              <Typography
                                component="code"
                                sx={{
                                  ...STRIPE_TYPE.mono,
                                  color: dark ? "#dce7ff" : "#16314f",
                                }}
                              >
                                {header.value}
                              </Typography>
                            </Stack>
                            <Typography
                              sx={{
                                ...STRIPE_TYPE.bodySmall,
                                color: "text.secondary",
                                mt: 0.6,
                              }}
                            >
                              {header.detail}
                            </Typography>
                          </Box>
                        ))}
                      </Stack>
                    </Stack>
                  </Box>
                </Box>
              </Stack>
            </Box>
          </Container>
        </Box>
        <Container
          maxWidth={false}
          sx={{ maxWidth: 1440, px: { xs: 2, md: 4, xl: 6 } }}
        >
          <Box
            sx={{
              display: "grid",
              gap: { xs: 3, lg: 4 },
              gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0, 1fr)" },
              py: { xs: 3, md: 4.5 },
            }}
          >
            <Box
              sx={{
                position: { lg: "sticky" },
                top: { lg: 120 },
                alignSelf: "start",
              }}
            >
              <Stack spacing={2}>
                <Box
                  sx={{
                    borderRadius: 4,
                    border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.08)}`,
                    background:
                      theme.palette.mode === "dark"
                        ? "linear-gradient(180deg, rgba(17,24,39,0.92), rgba(10,14,25,0.98))"
                        : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.98))",
                    p: 2,
                  }}
                >
                  <Stack spacing={0.8}>
                    <Typography
                      variant="overline"
                      sx={{
                        ...STRIPE_TYPE.overline,
                        color: "text.secondary",
                      }}
                    >
                      Collections
                    </Typography>
                    <Typography
                      variant="h4"
                      sx={{
                        ...STRIPE_TYPE.display,
                        fontSize: "3rem",
                        lineHeight: "3.5rem",
                      }}
                    >
                      {filteredSections.length}
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.body,
                        color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      {filteredEndpointCount} visible endpoints across the current
                      filtered collections.
                    </Typography>
                  </Stack>
                </Box>

                <Stack spacing={1}>
                  {filteredSections.map((section) => {
                    const Icon = section.icon;
                    const active = activeSection === section.id;

                    return (
                      <ButtonBase
                        key={section.id}
                        onClick={() => jumpToSection(section.id)}
                        sx={{
                          width: "100%",
                          textAlign: "left",
                          justifyContent: "flex-start",
                          borderRadius: 3.5,
                          border: `1px solid ${alpha(theme.palette.text.primary, active ? 0.14 : dark ? 0.08 : 0.07)}`,
                          background: active
                            ? alpha(section.accent, dark ? 0.18 : 0.08)
                            : "transparent",
                          px: 1.4,
                          py: 1.3,
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={1.2}
                          alignItems="center"
                          sx={{ width: "100%" }}
                        >
                          <Box
                            sx={{
                              width: 38,
                              height: 38,
                              borderRadius: 2.8,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: active
                                ? alpha(section.accent, dark ? 0.2 : 0.12)
                                : alpha(theme.palette.text.primary, dark ? 0.08 : 0.04),
                              color: active ? section.accent : "text.secondary",
                              flexShrink: 0,
                            }}
                          >
                            <Icon fontSize="small" />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              sx={{
                                ...STRIPE_TYPE.label,
                                fontSize: "1rem",
                                lineHeight: "1.5rem",
                              }}
                            >
                              {section.title}
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{
                                ...STRIPE_TYPE.bodySmall,
                                color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {section.endpoints.length} endpoints
                            </Typography>
                          </Box>
                        </Stack>
                      </ButtonBase>
                    );
                  })}
                </Stack>

                <Box
                  sx={{
                    borderRadius: 4,
                    border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.08)}`,
                    background:
                      theme.palette.mode === "dark"
                        ? "linear-gradient(180deg, rgba(17,24,39,0.92), rgba(10,14,25,0.98))"
                        : "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(248,250,252,0.98))",
                    p: 2,
                  }}
                >
                  <Stack spacing={1.1}>
                    <Typography
                      variant="h6"
                      sx={{
                        ...STRIPE_TYPE.panelTitle,
                        fontSize: "1.25rem",
                        lineHeight: "1.75rem",
                      }}
                    >
                      Support
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.body,
                        color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      Need a new endpoint group or an OpenAPI export for these
                      user flows?
                    </Typography>
                    <Button
                      component="a"
                      href="mailto:support@pickletour.vn"
                      variant="outlined"
                      sx={{
                        alignSelf: "flex-start",
                        borderRadius: 999,
                        textTransform: "none",
                        ...STRIPE_TYPE.label,
                      }}
                    >
                      support@pickletour.vn
                    </Button>
                  </Stack>
                </Box>
              </Stack>
            </Box>

            <Stack spacing={4}>
              {!filteredSections.length ? (
                <Box
                  sx={{
                    borderRadius: 5,
                    border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.06)}`,
                    background:
                      theme.palette.mode === "dark"
                        ? "linear-gradient(180deg, rgba(12,18,32,0.86), rgba(7,10,18,0.95))"
                        : "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.88))",
                    p: { xs: 2.2, md: 3 },
                  }}
                >
                  <Stack spacing={1}>
                    <Typography
                      variant="h4"
                      sx={{
                        ...STRIPE_TYPE.panelTitle,
                      }}
                    >
                      No matching endpoints
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.body,
                        color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      Try a broader keyword or switch the access filter back to
                      `All endpoints`.
                    </Typography>
                  </Stack>
                </Box>
              ) : null}

              {filteredSections.map((section) => {
                const Icon = section.icon;

                return (
                  <Box
                    key={section.id}
                    id={section.id}
                    sx={{
                      scrollMarginTop: { xs: 96, md: 132 },
                      borderRadius: 5,
                      border: `1px solid ${alpha(theme.palette.text.primary, dark ? 0.08 : 0.06)}`,
                      background:
                        theme.palette.mode === "dark"
                          ? "linear-gradient(180deg, rgba(12,18,32,0.86), rgba(7,10,18,0.95))"
                          : "linear-gradient(180deg, rgba(255,255,255,0.72), rgba(255,255,255,0.88))",
                      p: { xs: 2, md: 2.6 },
                    }}
                  >
                    <Stack spacing={2.4}>
                      <Stack spacing={1.15}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Box
                            sx={{
                              width: 44,
                              height: 44,
                              borderRadius: 3,
                              display: "grid",
                              placeItems: "center",
                              bgcolor: alpha(section.accent, dark ? 0.2 : 0.1),
                              color: section.accent,
                            }}
                          >
                            <Icon fontSize="small" />
                          </Box>
                          <Box>
                            <Typography
                              variant="overline"
                              sx={{
                                ...STRIPE_TYPE.overline,
                                color: "text.secondary",
                              }}
                            >
                              {section.eyebrow}
                            </Typography>
                            <Typography
                              variant="h3"
                              sx={{
                                ...STRIPE_TYPE.sectionTitle,
                              }}
                            >
                              {section.title}
                            </Typography>
                          </Box>
                        </Stack>

                        <Typography
                          sx={{
                            ...STRIPE_TYPE.body,
                            color: dark ? "text.secondary" : STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          {section.summary}
                        </Typography>

                        <Box
                          sx={{
                            borderRadius: 3,
                            px: 1.4,
                            py: 1.2,
                            bgcolor: alpha(section.accent, dark ? 0.12 : 0.06),
                            color: dark ? "#dce7ff" : STRIPE_TEXT_LIGHT,
                          }}
                        >
                          <Typography
                            sx={{
                              ...STRIPE_TYPE.body,
                            }}
                          >
                            {section.note}
                          </Typography>
                        </Box>
                      </Stack>

                      <Stack spacing={2}>
                        {section.endpoints.map((endpoint) => (
                          <EndpointCard
                            key={`${endpoint.method}-${endpoint.path}`}
                            endpoint={endpoint}
                            theme={theme}
                            copiedKey={copiedKey}
                            onCopyCode={copyCode}
                          />
                        ))}
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Box>
        </Container>
      </Box>
    </>
  );
}
