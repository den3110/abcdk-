import "@fontsource/source-code-pro/400.css";
import PropTypes from "prop-types";
import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Link as RouterLink } from "react-router-dom";
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
} from "@mui/material";
import {
  ApiRounded as ApiIcon,
  ArrowOutwardRounded as ArrowIcon,
  BoltRounded as BoltIcon,
  CheckRounded as CheckIcon,
  ContentCopyRounded as CopyIcon,
  DarkModeRounded as DarkModeIcon,
  EventRounded as EventIcon,
  GroupsRounded as GroupsIcon,
  LightModeRounded as LightModeIcon,
  LockRounded as LockIcon,
  PublicRounded as PublicIcon,
  SearchRounded as SearchIcon,
  SensorsRounded as SensorsIcon,
  SportsTennisRounded as SportsIcon,
  StreamRounded as StreamIcon,
} from "@mui/icons-material";
import { useThemeMode } from "../context/ThemeContext.jsx";

const FONT_STACK_SANS =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol"';
const FONT_STACK_MONO =
  '"Source Code Pro", Menlo, Monaco, monospace';
const STRIPE_TEXT_LIGHT = "#1a2c44";
const STRIPE_SUBTLE_LIGHT = "#50617a";
const DOCS_LIGHT = {
  pageBg: "#ffffff",
  sectionBg: "#f6f9fc",
  surface: "#ffffff",
  surfaceMuted: "#fbfdff",
  border: alpha(STRIPE_TEXT_LIGHT, 0.08),
  borderStrong: alpha(STRIPE_TEXT_LIGHT, 0.12),
  activeBg: "#edf4ff",
  headerBg: "#ffffff",
  shadow: "0 1px 2px rgba(26,44,68,0.04), 0 12px 24px rgba(26,44,68,0.03)",
  text: STRIPE_TEXT_LIGHT,
  subtle: STRIPE_SUBTLE_LIGHT,
  accentText: "#0d47bf",
  accentStrong: "#1f67ff",
  brandSurface: "#0a2540",
  buttonHover: "#082038",
  brandContrast: "#ffffff",
  codeText: "#16314f",
};

const DOCS_DARK = {
  pageBg: "#0a0f1a",
  sectionBg: "#0d1422",
  surface: "#111b2e",
  surfaceMuted: "#0d1627",
  border: alpha("#dce7ff", 0.12),
  borderStrong: alpha("#dce7ff", 0.2),
  activeBg: "rgba(76, 127, 255, 0.16)",
  headerBg: "#0a0f1a",
  shadow: "0 1px 2px rgba(0,0,0,0.32), 0 18px 36px rgba(0,0,0,0.24)",
  text: "#e7eefb",
  subtle: "#9fb0c9",
  accentText: "#9cc0ff",
  accentStrong: "#bfd2ff",
  brandSurface: "#e7eefb",
  buttonHover: "#d7e2f6",
  brandContrast: "#0a2540",
  codeText: "#dce7ff",
};
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

const USE_CASE_ENTRY_POINTS = [
  {
    id: "auth",
    title: "Onboard and sign in",
    summary: "Register users, create sessions and recover accounts.",
    recommended: "Auth, sessions and recovery",
  },
  {
    id: "profiles",
    title: "Profiles and rankings",
    summary: "Load public profiles, history and leaderboard data.",
    recommended: "Profiles, ratings and rankings",
  },
  {
    id: "clubs",
    title: "Community features",
    summary: "Create clubs, manage members and RSVP to events.",
    recommended: "Clubs, events and announcements",
  },
  {
    id: "live",
    title: "Live watch surfaces",
    summary: "Search feed items, clusters and live-ready matches.",
    recommended: "Live feed, clusters and courts",
  },
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
      {
        method: "GET",
        path: "/api/overlay/match/:id",
        auth: "Public",
        title: "Get match detail for overlay surfaces",
        summary:
          "Return the public match snapshot used by the score overlay, live studio and scoreboard surfaces.",
        request: `curl {{BASE_URL}}/api/overlay/match/match-id`,
        response: `{
  "matchId": "match-id",
  "status": "LIVE",
  "winner": "",
  "tournament": {
    "id": "tour-id",
    "name": "Open Spring Cup",
    "image": "https://cdn.example.com/tournaments/open-spring-cup.jpg",
    "nameDisplayMode": "nickname",
    "displayNameMode": "nickname",
    "eventType": "double",
    "overlay": {
      "theme": "dark",
      "accentA": "#25C2A0",
      "accentB": "#4F46E5"
    },
    "webLogoUrl": "/uploads/overlay/web-logo.png",
    "webLogoAlt": "PickleTour",
    "sponsors": [
      {
        "id": "sponsor-id",
        "name": "Demo Sponsor",
        "slug": "demo-sponsor",
        "logoUrl": "/uploads/sponsors/demo.png",
        "websiteUrl": "https://example.com",
        "refLink": "https://example.com/ref",
        "tier": "gold",
        "featured": true,
        "weight": 100
      }
    ]
  },
  "bracket": {
    "id": "bracket-id",
    "type": "knockout",
    "name": "Main Draw",
    "order": 1,
    "stage": "main",
    "overlay": {
      "theme": "dark"
    },
    "drawRounds": 4,
    "drawStatus": "ready",
    "noRankDelta": false,
    "groups": [
      {
        "id": "group-a",
        "name": "Group A",
        "expectedSize": 4,
        "size": 4
      }
    ]
  },
  "bracketType": "knockout",
  "format": "knockout",
  "branch": "main",
  "phase": null,
  "pool": {
    "id": null,
    "name": ""
  },
  "roundCode": "SF",
  "roundName": "Semi Final",
  "round": 3,
  "roundSize": 4,
  "stageType": "playoff",
  "stageName": "Bán kết",
  "seeds": {
    "A": 1,
    "B": 4
  },
  "code": "M-203",
  "labelKey": "sf-1",
  "stageIndex": 5,
  "teams": {
    "A": {
      "name": "pickle.alpha & pickle.beta",
      "displayName": "pickle.alpha & pickle.beta",
      "displayNameMode": "nickname",
      "players": [
        {
          "id": "user-a",
          "nickname": "pickle.alpha",
          "fullName": "Player Alpha",
          "name": "Player Alpha",
          "displayName": "pickle.alpha",
          "displayNameMode": "nickname",
          "shortName": "Alpha"
        },
        {
          "id": "user-b",
          "nickname": "pickle.beta",
          "fullName": "Player Beta",
          "name": "Player Beta",
          "displayName": "pickle.beta",
          "displayNameMode": "nickname",
          "shortName": "Beta"
        }
      ],
      "seed": 1,
      "label": "Team A",
      "teamName": "Alpha / Beta"
    },
    "B": {
      "name": "pickle.gamma & pickle.delta",
      "displayName": "pickle.gamma & pickle.delta",
      "displayNameMode": "nickname",
      "players": [
        {
          "id": "user-c",
          "nickname": "pickle.gamma",
          "fullName": "Player Gamma",
          "name": "Player Gamma",
          "displayName": "pickle.gamma",
          "displayNameMode": "nickname",
          "shortName": "Gamma"
        },
        {
          "id": "user-d",
          "nickname": "pickle.delta",
          "fullName": "Player Delta",
          "name": "Player Delta",
          "displayName": "pickle.delta",
          "displayNameMode": "nickname",
          "shortName": "Delta"
        }
      ],
      "seed": 4,
      "label": "Team B",
      "teamName": "Gamma / Delta"
    }
  },
  "pairA": {
    "id": "reg-a",
    "seed": 1,
    "label": "Team A",
    "teamName": "Alpha / Beta",
    "displayName": "pickle.alpha & pickle.beta",
    "displayNameMode": "nickname"
  },
  "pairB": {
    "id": "reg-b",
    "seed": 4,
    "label": "Team B",
    "teamName": "Gamma / Delta",
    "displayName": "pickle.gamma & pickle.delta",
    "displayNameMode": "nickname"
  },
  "rules": {
    "bestOf": 3,
    "pointsToWin": 11,
    "winByTwo": true,
    "cap": {
      "mode": "none",
      "points": null
    }
  },
  "currentGame": 1,
  "serve": {
    "side": "A",
    "server": 1,
    "serverId": {
      "id": "user-a",
      "name": "Player Alpha",
      "nickname": "pickle.alpha"
    }
  },
  "gameScores": [
    {
      "a": 11,
      "b": 7
    },
    {
      "a": 6,
      "b": 4
    }
  ],
  "sets": {
    "A": 1,
    "B": 0
  },
  "needSetsToWin": 2,
  "court": {
    "id": "court-id",
    "name": "Court 1",
    "number": 1,
    "code": "C1",
    "label": "Center Court",
    "zone": "A",
    "venue": "Main Hall",
    "building": "Arena 1",
    "floor": "2",
    "cluster": "Championship",
    "group": "TV"
  },
  "courtId": "court-id",
  "courtName": "Court 1",
  "courtNo": 1,
  "queueOrder": 2,
  "referees": [
    {
      "id": "referee-id",
      "name": "Referee Demo",
      "nickname": "ref.demo"
    }
  ],
  "referee": {
    "id": "referee-id",
    "name": "Referee Demo",
    "nickname": "ref.demo"
  },
  "liveBy": {
    "id": "staff-id",
    "name": "Live Operator",
    "nickname": "live.ops"
  },
  "previousA": {
    "id": "prev-match-a",
    "round": 2,
    "order": 3,
    "code": "QF-1"
  },
  "previousB": {
    "id": "prev-match-b",
    "round": 2,
    "order": 4,
    "code": "QF-2"
  },
  "nextMatch": {
    "id": "final-match-id",
    "round": 4,
    "order": 1,
    "code": "F-1",
    "slot": "A"
  },
  "scheduledAt": "2026-05-12T08:00:00.000Z",
  "assignedAt": "2026-05-12T08:20:00.000Z",
  "startedAt": "2026-05-12T08:32:10.000Z",
  "finishedAt": null,
  "updatedAt": "2026-05-12T08:39:02.000Z",
  "createdAt": "2026-05-10T03:15:00.000Z",
  "video": "https://stream.example.com/live.m3u8",
  "streams": [
    {
      "provider": "manual",
      "url": "https://stream.example.com/live.m3u8"
    }
  ],
  "liveVersion": 14,
  "liveLogTail": [
    {
      "type": "point",
      "team": "A",
      "at": "2026-05-12T08:38:41.000Z"
    }
  ],
  "participants": [
    "user-a",
    "user-b",
    "user-c",
    "user-d"
  ],
  "overlay": {
    "theme": "dark",
    "accentA": "#25C2A0",
    "accentB": "#4F46E5",
    "corner": "tl",
    "rounded": 18,
    "shadow": true,
    "showSets": true,
    "fontFamily": "",
    "nameScale": 1,
    "scoreScale": 1,
    "customCss": "",
    "size": "md",
    "scaleScore": 1,
    "enabled": true,
    "showClock": true,
    "webLogoUrl": "/uploads/overlay/web-logo.png",
    "webLogoAlt": "PickleTour",
    "sponsorLogos": [
      "/uploads/sponsors/demo.png"
    ]
  },
  "meta": {
    "broadcast": "main-stream"
  },
  "note": "Warmup completed",
  "rating": {
    "delta": 0,
    "applied": false,
    "appliedAt": null
  },
  "isBreak": {
    "active": false,
    "afterGame": null,
    "note": "",
    "startedAt": null,
    "expectedResumeAt": null
  }
}`,
        notes: [
          "This is the public snapshot endpoint currently used by /overlay/score and live studio overlay fetches.",
          "The backend accepts both regular match ids and user-match ids on this route.",
          "For user-match payloads, tournament.id can be null and tournament-level fields are reduced compared with normal tournament matches.",
          "serve.serverId may be a populated object or a raw id string, depending on what the backend resolved for that match.",
          "The controller returns no-store headers, so clients should treat the payload as live state rather than cacheable reference data.",
        ],
        cases: [
          {
            title: "Finished tournament match",
            summary:
              "Normal tournament match after completion, with winner, final score, rating flag and finished timestamps.",
            response: `{
  "matchId": "finished-match-id",
  "status": "FINISHED",
  "winner": "A",
  "stageType": "playoff",
  "stageName": "Chung kết",
  "teams": {
    "A": {
      "displayName": "pickle.alpha & pickle.beta"
    },
    "B": {
      "displayName": "pickle.gamma & pickle.delta"
    }
  },
  "gameScores": [
    {
      "a": 11,
      "b": 8
    },
    {
      "a": 9,
      "b": 11
    },
    {
      "a": 11,
      "b": 6
    }
  ],
  "sets": {
    "A": 2,
    "B": 1
  },
  "needSetsToWin": 2,
  "scheduledAt": "2026-05-12T09:00:00.000Z",
  "startedAt": "2026-05-12T09:08:14.000Z",
  "finishedAt": "2026-05-12T09:41:53.000Z",
  "updatedAt": "2026-05-12T09:41:53.000Z",
  "rating": {
    "delta": 8.5,
    "applied": true,
    "appliedAt": "2026-05-12T09:42:03.000Z"
  },
  "isBreak": {
    "active": false,
    "afterGame": null,
    "note": "",
    "startedAt": null,
    "expectedResumeAt": null
  }
}`,
          },
          {
            title: "Break active between games",
            summary:
              "Live match with an active timeout or break after a finished game.",
            response: `{
  "matchId": "break-match-id",
  "status": "LIVE",
  "currentGame": 2,
  "gameScores": [
    {
      "a": 11,
      "b": 7
    },
    {
      "a": 0,
      "b": 0
    }
  ],
  "sets": {
    "A": 1,
    "B": 0
  },
  "serve": {
    "side": "B",
    "server": 2,
    "serverId": "user-d"
  },
  "isBreak": {
    "active": true,
    "afterGame": 1,
    "note": "Medical timeout",
    "startedAt": "2026-05-12T10:04:00.000Z",
    "expectedResumeAt": "2026-05-12T10:07:00.000Z"
  },
  "overlay": {
    "theme": "dark",
    "showClock": true,
    "showSets": true,
    "enabled": true
  }
}`,
          },
          {
            title: "Invalid match id",
            summary:
              "Validation branch when the supplied id is not a Mongo object id.",
            label: "400 response",
            response: `{
  "message": "Invalid match id"
}`,
          },
          {
            title: "Match not found",
            summary:
              "Valid object id format, but no Match or UserMatch exists for that id.",
            label: "404 response",
            response: `{
  "message": "Match not found"
}`,
          },
          {
            title: "User match payload",
            summary:
              "User-created match branch, where tournament metadata is reduced and stageType becomes user_match.",
            response: `{
  "matchId": "user-match-id",
  "status": "LIVE",
  "winner": "",
  "tournament": {
    "id": null,
    "name": "Friendly Saturday Match",
    "image": "",
    "nameDisplayMode": "nickname",
    "displayNameMode": "nickname",
    "eventType": "double"
  },
  "bracket": null,
  "stageType": "user_match",
  "stageName": "Trận đấu PickleTour",
  "teams": {
    "A": {
      "displayName": "friendly.a & friendly.b"
    },
    "B": {
      "displayName": "friendly.c & friendly.d"
    }
  },
  "court": {
    "id": "court-id",
    "name": "Court 5",
    "number": 5
  },
  "participants": null,
  "overlay": {
    "theme": "dark",
    "size": "md",
    "enabled": true
  }
}`,
          },
          {
            title: "Queued match before court assignment",
            summary:
              "Pre-live state where the match exists, but court and stream fields can still be null or absent.",
            response: `{
  "matchId": "queued-match-id",
  "status": "QUEUED",
  "winner": "",
  "roundCode": "R16",
  "round": 2,
  "queueOrder": 6,
  "court": null,
  "courtId": null,
  "courtName": null,
  "video": null,
  "streams": [],
  "scheduledAt": null,
  "assignedAt": null,
  "startedAt": null,
  "finishedAt": null,
  "serve": {
    "side": "A",
    "server": 2,
    "serverId": null
  },
  "isBreak": {
    "active": false,
    "afterGame": null,
    "note": "",
    "startedAt": null,
    "expectedResumeAt": null
  }
}`,
          },
        ],
        tester: {
          title: "Run the overlay snapshot endpoint",
          summary:
            "Enter a real match id or user-match id to fetch the live overlay payload directly from this docs page.",
          method: "GET",
          pathTemplate: "/api/overlay/match/:id",
          pathParams: [
            {
              name: "id",
              label: "Match ID",
              placeholder: "663ca5f1c7b5e4a2ab123456",
              defaultValue: "",
            },
          ],
        },
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
    ...((endpoint.cases || []).flatMap((item) => [
      item.title,
      item.summary,
      item.response,
    ])),
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

function buildTesterUrl(baseUrl, pathTemplate, values = {}) {
  const normalizedBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  const resolvedPath = Object.entries(values).reduce((path, [key, value]) => {
    return path.replace(`:${key}`, encodeURIComponent(String(value || "").trim()));
  }, pathTemplate);

  return `${normalizedBase}${resolvedPath}`;
}

function CodePanel({
  label,
  code,
  language = "bash",
  docsColors,
  copyId,
  copied,
  onCopy,
}) {
  return (
    <Box
      sx={{
        minWidth: 0,
        borderRadius: 3,
        border: `1px solid ${docsColors.border}`,
        background: docsColors.surface,
        boxShadow: docsColors.shadow,
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
          borderBottom: `1px solid ${docsColors.border}`,
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
                  border: `1px solid ${docsColors.borderStrong}`,
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
          color: docsColors.codeText,
        }}
      >
        <Box component="code">{code}</Box>
      </Box>
    </Box>
  );
}

function EndpointTester({
  tester,
  docsColors,
  runtimeBaseUrl,
  copiedKey,
  onCopyCode,
}) {
  const initialParams = (tester.pathParams || []).reduce((acc, item) => {
    acc[item.name] = item.defaultValue || "";
    return acc;
  }, {});

  const [baseUrl, setBaseUrl] = useState(runtimeBaseUrl);
  const [params, setParams] = useState(initialParams);
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [requestError, setRequestError] = useState("");

  const requestUrl = buildTesterUrl(baseUrl, tester.pathTemplate, params);
  const missingRequiredParam = (tester.pathParams || []).some(
    (item) => item.required !== false && !String(params[item.name] || "").trim(),
  );

  const handleParamChange = (name, value) => {
    setParams((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const runRequest = async () => {
    if (missingRequiredParam) return;

    setIsRunning(true);
    setRequestError("");
    setStatusText("");
    setResponseText("");

    try {
      const response = await fetch(requestUrl, {
        method: tester.method || "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const rawText = await response.text();
      let prettyText = rawText;

      try {
        prettyText = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch {
        prettyText = rawText;
      }

      setStatusText(`${response.status} ${response.statusText}`.trim());
      setResponseText(prettyText || "<empty response>");
    } catch (error) {
      setRequestError(error?.message || "Request failed");
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Stack
      spacing={1.25}
      sx={{
        borderRadius: 3,
        border: `1px solid ${docsColors.border}`,
        background: docsColors.surfaceMuted,
        p: 1.4,
      }}
    >
      <Stack spacing={0.35}>
        <Typography
          sx={{
            ...STRIPE_TYPE.overline,
            color: "text.secondary",
          }}
        >
          Test environment
        </Typography>
        <Typography
          sx={{
            ...STRIPE_TYPE.label,
            color: docsColors.text,
          }}
        >
          {tester.title || "Run a live request"}
        </Typography>
        <Typography
          sx={{
            ...STRIPE_TYPE.bodySmall,
            color: "text.secondary",
          }}
        >
          {tester.summary ||
            "Browser test console for this public GET endpoint. It depends on the configured base URL and browser CORS access."}
        </Typography>
      </Stack>

      <Stack spacing={1}>
        <TextField
          label="Base URL"
          size="small"
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
          fullWidth
          sx={{
            "& .MuiOutlinedInput-root": {
              backgroundColor: docsColors.surface,
            },
          }}
        />

        {(tester.pathParams || []).map((item) => (
          <TextField
            key={item.name}
            label={item.label}
            size="small"
            value={params[item.name] || ""}
            onChange={(event) => handleParamChange(item.name, event.target.value)}
            placeholder={item.placeholder}
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                backgroundColor: docsColors.surface,
              },
            }}
          />
        ))}
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          disableElevation
          onClick={runRequest}
          disabled={isRunning || missingRequiredParam}
          sx={{
            alignSelf: "flex-start",
            borderRadius: 999,
            textTransform: "none",
            ...STRIPE_TYPE.label,
          }}
        >
          {isRunning ? "Running request..." : "Run request"}
        </Button>
        <Typography
          sx={{
            ...STRIPE_TYPE.bodySmall,
            color: "text.secondary",
            alignSelf: "center",
          }}
        >
          {statusText || requestError || "Ready"}
        </Typography>
      </Stack>

      <CodePanel
        label="Resolved request"
        code={`${tester.method || "GET"} ${requestUrl}`}
        docsColors={docsColors}
        copyId={`${tester.pathTemplate}-resolved-request`}
        copied={copiedKey === `${tester.pathTemplate}-resolved-request`}
        onCopy={onCopyCode}
      />

      {responseText ? (
        <CodePanel
          label="Live response"
          code={responseText}
          docsColors={docsColors}
          copyId={`${tester.pathTemplate}-live-response`}
          copied={copiedKey === `${tester.pathTemplate}-live-response`}
          onCopy={onCopyCode}
        />
      ) : null}
    </Stack>
  );
}

function EndpointCard({
  endpoint,
  docsColors,
  copiedKey,
  onCopyCode,
  runtimeBaseUrl,
}) {
  const isPublic = endpoint.auth === "Public";

  return (
    <Box
      sx={{
        borderRadius: 5,
        border: `1px solid ${docsColors.border}`,
        background: docsColors.surface,
        boxShadow: docsColors.shadow,
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
                ...getMethodPalette(endpoint.method, docsColors === DOCS_DARK ? "dark" : "light"),
              }}
            />
            <Chip
              icon={isPublic ? <PublicIcon /> : <LockIcon />}
              label={endpoint.auth}
              size="small"
              variant="outlined"
              sx={{
                borderRadius: 999,
                borderColor: docsColors.borderStrong,
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
              bgcolor: docsColors.sectionBg,
              color: docsColors.text,
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
            docsColors={docsColors}
            copyId={`${endpoint.method}-${endpoint.path}-request`}
            copied={copiedKey === `${endpoint.method}-${endpoint.path}-request`}
            onCopy={onCopyCode}
          />
          <CodePanel
            label="Representative response"
            code={endpoint.response}
            language={endpoint.responseLang || "json"}
            docsColors={docsColors}
            copyId={`${endpoint.method}-${endpoint.path}-response`}
            copied={copiedKey === `${endpoint.method}-${endpoint.path}-response`}
            onCopy={onCopyCode}
          />
        </Box>

        {endpoint.cases?.length ? (
          <Stack spacing={1.25}>
            <Typography
              sx={{
                ...STRIPE_TYPE.overline,
                color: "text.secondary",
              }}
            >
              Additional cases
            </Typography>
            {endpoint.cases.map((item) => (
              <Stack
                key={item.title}
                spacing={1}
                sx={{
                  borderRadius: 3,
                  border: `1px solid ${docsColors.border}`,
                  background: docsColors.surfaceMuted,
                  p: 1.4,
                }}
              >
                <Stack spacing={0.35}>
                  <Typography
                    sx={{
                      ...STRIPE_TYPE.label,
                      color: docsColors.text,
                    }}
                  >
                    {item.title}
                  </Typography>
                  <Typography
                    sx={{
                      ...STRIPE_TYPE.bodySmall,
                      color: "text.secondary",
                    }}
                  >
                    {item.summary}
                  </Typography>
                </Stack>
                <CodePanel
                  label={item.label || "Case response"}
                  code={item.response}
                  language={item.language || "json"}
                  docsColors={docsColors}
                  copyId={`${endpoint.method}-${endpoint.path}-${item.title}`}
                  copied={
                    copiedKey === `${endpoint.method}-${endpoint.path}-${item.title}`
                  }
                  onCopy={onCopyCode}
                />
              </Stack>
            ))}
          </Stack>
        ) : null}

        {endpoint.tester ? (
          <EndpointTester
            tester={endpoint.tester}
            docsColors={docsColors}
            runtimeBaseUrl={runtimeBaseUrl}
            copiedKey={copiedKey}
            onCopyCode={onCopyCode}
          />
        ) : null}

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

const testerPropType = PropTypes.shape({
  title: PropTypes.string,
  summary: PropTypes.string,
  method: PropTypes.string,
  pathTemplate: PropTypes.string.isRequired,
  pathParams: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
      placeholder: PropTypes.string,
      defaultValue: PropTypes.string,
      required: PropTypes.bool,
    }),
  ),
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
  cases: PropTypes.arrayOf(
    PropTypes.shape({
      title: PropTypes.string.isRequired,
      summary: PropTypes.string,
      label: PropTypes.string,
      language: PropTypes.string,
      response: PropTypes.string.isRequired,
    }),
  ),
  tester: testerPropType,
});

const docsColorsPropType = PropTypes.shape({
  pageBg: PropTypes.string.isRequired,
  sectionBg: PropTypes.string.isRequired,
  surface: PropTypes.string.isRequired,
  surfaceMuted: PropTypes.string.isRequired,
  border: PropTypes.string.isRequired,
  borderStrong: PropTypes.string.isRequired,
  activeBg: PropTypes.string.isRequired,
  headerBg: PropTypes.string.isRequired,
  shadow: PropTypes.string.isRequired,
  text: PropTypes.string.isRequired,
  subtle: PropTypes.string.isRequired,
  accentText: PropTypes.string.isRequired,
  accentStrong: PropTypes.string.isRequired,
  brandSurface: PropTypes.string.isRequired,
  buttonHover: PropTypes.string.isRequired,
  brandContrast: PropTypes.string.isRequired,
  codeText: PropTypes.string.isRequired,
});

CodePanel.propTypes = {
  label: PropTypes.string.isRequired,
  code: PropTypes.string.isRequired,
  language: PropTypes.string,
  docsColors: docsColorsPropType.isRequired,
  copyId: PropTypes.string,
  copied: PropTypes.bool,
  onCopy: PropTypes.func,
};

EndpointTester.propTypes = {
  tester: testerPropType.isRequired,
  docsColors: docsColorsPropType.isRequired,
  runtimeBaseUrl: PropTypes.string.isRequired,
  copiedKey: PropTypes.string,
  onCopyCode: PropTypes.func,
};

EndpointCard.propTypes = {
  endpoint: endpointPropType.isRequired,
  docsColors: docsColorsPropType.isRequired,
  copiedKey: PropTypes.string,
  onCopyCode: PropTypes.func,
  runtimeBaseUrl: PropTypes.string.isRequired,
};

export default function ApiDocsPage() {
  const { isDark, toggleTheme } = useThemeMode();
  const docsColors = isDark ? DOCS_DARK : DOCS_LIGHT;
  const DOCS_PAGE_BG = docsColors.pageBg;
  const DOCS_SECTION_BG = docsColors.sectionBg;
  const DOCS_SURFACE = docsColors.surface;
  const DOCS_SURFACE_MUTED = docsColors.surfaceMuted;
  const DOCS_BORDER = docsColors.border;
  const DOCS_BORDER_STRONG = docsColors.borderStrong;
  const DOCS_ACTIVE_BG = docsColors.activeBg;
  const DOCS_HEADER_BG = docsColors.headerBg;
  const DOCS_SHADOW = docsColors.shadow;
  const STRIPE_TEXT_LIGHT = docsColors.text;
  const STRIPE_SUBTLE_LIGHT = docsColors.subtle;
  const DOCS_ACCENT_TEXT = docsColors.accentText;
  const DOCS_BRAND_SURFACE = docsColors.brandSurface;
  const DOCS_BRAND_CONTRAST = docsColors.brandContrast;
  const DOCS_CODE_TEXT = docsColors.codeText;
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
          minHeight: "100vh",
          fontFamily: FONT_STACK_SANS,
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
          background: DOCS_PAGE_BG,
          color: STRIPE_TEXT_LIGHT,
        }}
      >
        <Box
          component="header"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 40,
            bgcolor: DOCS_HEADER_BG,
            borderBottom: `1px solid ${DOCS_BORDER}`,
          }}
        >
          <Container
            maxWidth={false}
            sx={{ maxWidth: 1440, px: { xs: 2, md: 4, xl: 6 } }}
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              spacing={2}
              sx={{ minHeight: 72 }}
            >
              <Stack direction="row" spacing={{ xs: 2, lg: 3 }} alignItems="center">
                <ButtonBase
                  component={RouterLink}
                  to="/"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.2,
                    borderRadius: 2,
                  }}
                >
                  <Box
                    sx={{
                      width: 36,
                      height: 36,
                      borderRadius: 2,
                      display: "grid",
                      placeItems: "center",
                      bgcolor: DOCS_BRAND_SURFACE,
                      color: DOCS_BRAND_CONTRAST,
                      fontFamily: FONT_STACK_SANS,
                      fontWeight: 700,
                      fontSize: "0.95rem",
                    }}
                  >
                    P
                  </Box>
                  <Stack spacing={0}>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.overline,
                        lineHeight: "0.9rem",
                        color: STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      PickleTour
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.label,
                        color: STRIPE_TEXT_LIGHT,
                      }}
                    >
                      Docs
                    </Typography>
                  </Stack>
                </ButtonBase>

                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ display: { xs: "none", lg: "flex" } }}
                >
                  {DOC_SECTIONS.map((section) => (
                    <ButtonBase
                      key={section.id}
                      onClick={() => jumpToSection(section.id)}
                      sx={{
                        px: 1.25,
                        py: 0.8,
                        borderRadius: 2,
                        color:
                          activeSection === section.id
                            ? STRIPE_TEXT_LIGHT
                            : STRIPE_SUBTLE_LIGHT,
                        bgcolor:
                          activeSection === section.id
                            ? DOCS_ACTIVE_BG
                            : "transparent",
                        ...STRIPE_TYPE.label,
                        fontWeight: activeSection === section.id ? 600 : 400,
                      }}
                    >
                      {section.eyebrow}
                    </ButtonBase>
                  ))}
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1} alignItems="center">
                <Button
                  component={RouterLink}
                  to="/"
                  variant="outlined"
                  sx={{
                    borderRadius: 999,
                    textTransform: "none",
                    borderColor: DOCS_BORDER_STRONG,
                    color: STRIPE_TEXT_LIGHT,
                    ...STRIPE_TYPE.label,
                  }}
                >
                  Back to app
                </Button>
                <IconButton
                  aria-label={
                    isDark
                      ? "Switch to light theme"
                      : "Switch to dark theme"
                  }
                  onClick={toggleTheme}
                  sx={{
                    width: 40,
                    height: 40,
                    border: `1px solid ${DOCS_BORDER_STRONG}`,
                    color: STRIPE_TEXT_LIGHT,
                  }}
                >
                  {isDark ? (
                    <LightModeIcon fontSize="small" />
                  ) : (
                    <DarkModeIcon fontSize="small" />
                  )}
                </IconButton>
              </Stack>
            </Stack>
          </Container>
        </Box>

        <Box
          sx={{
            borderBottom: `1px solid ${DOCS_BORDER}`,
            bgcolor: DOCS_SECTION_BG,
          }}
        >
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
                      bgcolor: DOCS_ACTIVE_BG,
                      color: DOCS_ACCENT_TEXT,
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
                      bgcolor: DOCS_SURFACE,
                      borderColor: DOCS_BORDER_STRONG,
                      color: STRIPE_SUBTLE_LIGHT,
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
                      bgcolor: DOCS_SURFACE,
                      borderColor: DOCS_BORDER_STRONG,
                      color: STRIPE_SUBTLE_LIGHT,
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
                      variant="overline"
                      sx={{
                        ...STRIPE_TYPE.overline,
                        color: STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      Common use cases
                    </Typography>
                    <Typography
                      variant="h1"
                      sx={{
                        ...STRIPE_TYPE.sectionTitle,
                        fontSize: { xs: "2.3rem", md: "3rem" },
                        lineHeight: { xs: "2.8rem", md: "3.5rem" },
                        maxWidth: 860,
                        color: STRIPE_TEXT_LIGHT,
                      }}
                    >
                      Build user-facing flows with the same endpoints the PickleTour clients already use.
                    </Typography>

                    <Typography
                      sx={{
                        ...STRIPE_TYPE.bodyLarge,
                        color: STRIPE_SUBTLE_LIGHT,
                        maxWidth: 780,
                      }}
                    >
                      Browse the auth, profile, tournament, club and live APIs
                      already wired into the current web and mobile clients. The
                      page starts with common entry points, then moves into the
                      full endpoint reference.
                    </Typography>

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
                            backgroundColor: DOCS_SURFACE,
                            fontFamily: FONT_STACK_SANS,
                            color: STRIPE_TEXT_LIGHT,
                            "& fieldset": {
                              borderColor: DOCS_BORDER_STRONG,
                            },
                            "&:hover fieldset": {
                              borderColor: DOCS_BORDER_STRONG,
                            },
                            "&.Mui-focused fieldset": {
                              borderColor: DOCS_ACCENT_TEXT,
                            },
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
                                  ? DOCS_ACTIVE_BG
                                  : DOCS_SURFACE,
                              borderColor: DOCS_BORDER_STRONG,
                              color:
                                accessFilter === filter.value
                                  ? DOCS_ACCENT_TEXT
                                  : STRIPE_TEXT_LIGHT,
                            }}
                          />
                        ))}
                      </Stack>
                    </Stack>

                    <Box
                      sx={{
                        borderRadius: 4,
                        border: `1px solid ${DOCS_BORDER}`,
                        background: DOCS_SURFACE,
                        overflow: "hidden",
                      }}
                    >
                      <Box
                        sx={{
                          display: { xs: "none", md: "grid" },
                          gridTemplateColumns:
                            "minmax(0, 0.92fr) minmax(260px, 0.75fr)",
                          columnGap: 2,
                          px: 2.2,
                          py: 1.35,
                          borderBottom: `1px solid ${DOCS_BORDER}`,
                          bgcolor: DOCS_SURFACE_MUTED,
                        }}
                      >
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.overline,
                            color: STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          Use case
                        </Typography>
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.overline,
                            color: STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          Recommended flow
                        </Typography>
                      </Box>

                      {USE_CASE_ENTRY_POINTS.map((item, index) => (
                        <ButtonBase
                          key={item.id}
                          onClick={() => jumpToSection(item.id)}
                          sx={{
                            width: "100%",
                            textAlign: "left",
                            justifyContent: "flex-start",
                            borderRadius: 0,
                            px: 2.2,
                            py: 1.7,
                            borderBottom:
                              index === USE_CASE_ENTRY_POINTS.length - 1
                                ? "none"
                                : `1px solid ${DOCS_BORDER}`,
                          }}
                        >
                          <Box
                            sx={{
                              width: "100%",
                              display: "grid",
                              gridTemplateColumns: {
                                xs: "1fr",
                                md: "minmax(0, 0.92fr) minmax(260px, 0.75fr)",
                              },
                              gap: { xs: 1, md: 2 },
                              alignItems: "center",
                            }}
                          >
                            <Stack spacing={0.45}>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.cardTitle,
                                  fontSize: "1.125rem",
                                  lineHeight: "1.5rem",
                                }}
                              >
                                {item.title}
                              </Typography>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.bodySmall,
                                  color: STRIPE_SUBTLE_LIGHT,
                                  maxWidth: 620,
                                }}
                              >
                                {item.summary}
                              </Typography>
                            </Stack>

                            <Stack
                              direction="row"
                              spacing={1}
                              justifyContent="space-between"
                              alignItems="center"
                              sx={{ minWidth: 0 }}
                            >
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.body,
                                  color: STRIPE_SUBTLE_LIGHT,
                                }}
                              >
                                {item.recommended}
                              </Typography>
                              <ArrowIcon
                                sx={{
                                  color: STRIPE_SUBTLE_LIGHT,
                                  fontSize: 18,
                                  flexShrink: 0,
                                }}
                              />
                            </Stack>
                          </Box>
                        </ButtonBase>
                      ))}
                    </Box>
                  </Stack>

                  <Box
                    sx={{
                      borderRadius: 5,
                      border: `1px solid ${DOCS_BORDER_STRONG}`,
                      background: DOCS_SURFACE,
                      boxShadow: DOCS_SHADOW,
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
                            color: STRIPE_SUBTLE_LIGHT,
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
                        docsColors={docsColors}
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
                              border: `1px solid ${DOCS_BORDER}`,
                              bgcolor: DOCS_SURFACE_MUTED,
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
                                  color: STRIPE_TEXT_LIGHT,
                                }}
                              >
                                {header.name}
                              </Typography>
                              <Typography
                                component="code"
                                sx={{
                                  ...STRIPE_TYPE.mono,
                                  color: DOCS_CODE_TEXT,
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
                    border: `1px solid ${DOCS_BORDER}`,
                    background: DOCS_SURFACE_MUTED,
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
                        color: STRIPE_SUBTLE_LIGHT,
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
                          border: `1px solid ${active ? DOCS_BORDER_STRONG : DOCS_BORDER}`,
                          background: active
                            ? DOCS_ACTIVE_BG
                            : DOCS_SURFACE,
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
                                ? alpha(section.accent, 0.12)
                                : DOCS_SECTION_BG,
                              color: active ? section.accent : "text.secondary",
                              flexShrink: 0,
                            }}
                          >
                            <Icon fontSize="small" />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              sx={{
                                ...STRIPE_TYPE.overline,
                                color: STRIPE_SUBTLE_LIGHT,
                                mb: 0.15,
                              }}
                            >
                              {section.eyebrow}
                            </Typography>
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
                                color: STRIPE_SUBTLE_LIGHT,
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
                    border: `1px solid ${DOCS_BORDER}`,
                    background: DOCS_SURFACE_MUTED,
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
                        color: STRIPE_SUBTLE_LIGHT,
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
                        borderColor: DOCS_BORDER_STRONG,
                        color: STRIPE_TEXT_LIGHT,
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
                    border: `1px solid ${DOCS_BORDER}`,
                    background: DOCS_SURFACE,
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
                        color: STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      Try a broader keyword or switch the access filter back to
                      `All endpoints`.
                    </Typography>
                  </Stack>
                </Box>
              ) : null}

              {filteredSections.map((section, sectionIndex) => {
                const Icon = section.icon;

                return (
                  <Box
                    key={section.id}
                    id={section.id}
                    sx={{
                      scrollMarginTop: { xs: 96, md: 132 },
                      pt: sectionIndex === 0 ? 0 : { xs: 3.5, md: 4.5 },
                      borderTop:
                        sectionIndex === 0 ? "none" : `1px solid ${DOCS_BORDER}`,
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
                              bgcolor: alpha(section.accent, 0.1),
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
                            color: STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          {section.summary}
                        </Typography>

                        <Box
                          sx={{
                            borderRadius: 3,
                            px: 1.4,
                            py: 1.2,
                            bgcolor: DOCS_SECTION_BG,
                            color: STRIPE_TEXT_LIGHT,
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
                            docsColors={docsColors}
                            copiedKey={copiedKey}
                            onCopyCode={copyCode}
                            runtimeBaseUrl={runtimeBaseUrl}
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

