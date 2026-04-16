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
  AutoAwesomeRounded as SparkleIcon,
  ArrowOutwardRounded as ArrowIcon,
  BoltRounded as BoltIcon,
  CheckRounded as CheckIcon,
  ContentCopyRounded as CopyIcon,
  DarkModeRounded as DarkModeIcon,
  EventRounded as EventIcon,
  GroupsRounded as GroupsIcon,
  LightModeRounded as LightModeIcon,
  LockRounded as LockIcon,
  KeyboardArrowDownRounded as ChevronDownIcon,
  PublicRounded as PublicIcon,
  SearchRounded as SearchIcon,
  SensorsRounded as SensorsIcon,
  SportsTennisRounded as SportsIcon,
  StreamRounded as StreamIcon,
} from "@mui/icons-material";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useThemeMode } from "../context/ThemeContext.jsx";
import { useGetPublicGuideLinkQuery } from "../slices/overlayApiSlice";

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

const DOCS_PRIMARY_NAV = [
  { label: "Get started", kind: "hero" },
  { label: "Identity", sectionId: "auth" },
  { label: "Profiles", sectionId: "profiles" },
  { label: "Competition", sectionId: "tournaments" },
  { label: "Community", sectionId: "clubs" },
  { label: "Streaming", sectionId: "live" },
];

const DOCS_SECONDARY_NAV = [
  { label: "APIs & SDKs", kind: "reference" },
  { label: "Help", href: "mailto:support@pickletour.vn" },
];

const DOCS_LANDING_COLUMNS = [
  {
    title: "Identity",
    links: [
      { label: "Create accounts", sectionId: "auth" },
      { label: "Sign in from web", sectionId: "auth" },
      { label: "Recover passwords", sectionId: "auth" },
    ],
  },
  {
    title: "Competition",
    links: [
      { label: "Browse tournaments", sectionId: "tournaments" },
      { label: "Register players", sectionId: "tournaments" },
      { label: "Check-in flows", sectionId: "tournaments" },
    ],
  },
  {
    title: "Developers",
    links: [
      { label: "Configure base URL", kind: "reference" },
      { label: "Test overlay detail", sectionId: "live" },
      { label: "Browse full reference", kind: "reference" },
    ],
  },
];

const LANDING_PLAYGROUND_CASES = [
  {
    id: "session",
    label: "Create a web session",
    detail:
      "Authenticate with email or phone plus password and return the signed-in user payload.",
    status: "POST /api/users/auth/web",
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
  },
  {
    id: "tournaments",
    label: "List tournaments",
    detail:
      "Fetch tournaments for cards, search, command palette and home surfaces.",
    status: "GET /api/tournaments",
    request: `curl "{{BASE_URL}}/api/tournaments?limit=12&sort=-updatedAt"`,
    response: `[
  {
    "_id": "tour-id",
    "name": "Open Spring Cup",
    "startDate": "2026-05-12T00:00:00.000Z",
    "status": "open"
  }
]`,
  },
  {
    id: "overlay",
    label: "Get overlay match detail",
    detail:
      "Load the match detail payload used by the public overlay and live presentation surfaces.",
    status: "GET /api/overlay/match/:id",
    request: `curl "{{BASE_URL}}/api/overlay/match/681d00f9f0d17f18f88a1001"`,
    response: `{
  "success": true,
  "match": {
    "_id": "681d00f9f0d17f18f88a1001",
    "status": "live",
    "court": { "name": "Court 1" },
    "players": [
      { "name": "Player A" },
      { "name": "Player B" }
    ]
  }
}`,
  },
  {
    id: "court-current",
    label: "Get current court match",
    detail:
      "Load the public court station payload together with the rich currentMatch snapshot used by live and overlay-style surfaces.",
    status: "GET /api/live/courts/:courtStationId",
    request: `curl "{{BASE_URL}}/api/live/courts/663ca5f1c7b5e4a2ab123456"`,
    response: `{
  "cluster": {
    "_id": "cluster-id",
    "name": "Championship cluster"
  },
  "station": {
    "_id": "court-id",
    "name": "Court 1",
    "status": "live"
  },
  "currentMatch": {
    "_id": "match-id",
    "status": "live",
    "displayCode": "M-203"
  }
}`,
  },
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

const DOCS_UI_TEXT = {
  en: {
    metaTitle: "PickleTour User API Docs",
    metaDescription:
      "User-facing API documentation for PickleTour auth, profiles, tournaments, clubs and live features.",
    searchPlaceholder: "Search",
    referenceSearchPlaceholder: "Search by endpoint path, method, or feature",
    askAi: "Ask AI",
    createAccount: "Create account",
    signIn: "Sign in",
    switchToLightTheme: "Switch to light theme",
    switchToDarkTheme: "Switch to dark theme",
    primaryNav: DOCS_PRIMARY_NAV,
    secondaryNav: DOCS_SECONDARY_NAV,
    landingColumns: DOCS_LANDING_COLUMNS,
    playgroundCases: LANDING_PLAYGROUND_CASES,
    useCaseEntryPoints: USE_CASE_ENTRY_POINTS,
    clientHeaders: CLIENT_HEADERS,
    accessFilters: ACCESS_FILTERS,
    heroTitle: "Documentation",
    heroSummary:
      "Explore guides, reference endpoints and testable examples to integrate PickleTour user flows.",
    heroPrimaryCta: "Get started with PickleTour",
    heroSecondaryCta: "Explore API reference",
    recentlyViewed: "Recently viewed",
    apiBase: "API base",
    local: "Local",
    configured: "Configured",
    publicBaseUrl: "Public base URL",
    referenceEndpoints: "Reference endpoints",
    floatingCardSummary:
      "Test directly from the docs landing, then continue into the full endpoint reference below.",
    tryItOutTitle: "Try it out",
    tryItOutSummary:
      "Start with a common request, then continue into the full API reference with search and filters.",
    integrationBasics: "Integration basics",
    baseUrlAndContract: "Base URL and request contract",
    integrationSummary:
      "Current frontend clients use a shared base query with credentialed requests, trace headers and timezone context.",
    quickstart: "Quickstart",
    apiReferenceOverline: "API reference",
    browseEndpointsTitle: "Browse endpoints by collection",
    browseEndpointsSummary:
      "Search the user API surface, filter by access level, then jump into the full endpoint cards below.",
    userApiDocs: "User API docs",
    restJson: "REST + JSON",
    collections: "Collections",
    support: "Support",
    supportSummary:
      "Need a new endpoint group or an OpenAPI export for these user flows?",
    noMatchingEndpoints: "No matching endpoints",
    noMatchingEndpointsSummary:
      "Try a broader keyword or switch the access filter back to `All endpoints`.",
    query: "Query",
    body: "Body",
    request: "Request",
    representativeResponse: "Representative response",
    additionalCases: "Additional cases",
    caseResponse: "Case response",
    testEnvironment: "Test environment",
    runLiveRequest: "Run a live request",
    testerDefaultSummary:
      "Direct browser tester for this endpoint. It supports path params, query params, headers, and JSON body when needed. Results still depend on the configured base URL and browser CORS access.",
    baseUrl: "Base URL",
    pathParameters: "Path parameters",
    queryParameters: "Query parameters",
    headersJson: "Headers (JSON)",
    bodyJson: "Body (JSON)",
    runRequest: "Run request",
    runningRequest: "Running request...",
    ready: "Ready",
    resolvedRequest: "Resolved request",
    liveResponse: "Live response",
    emptyResponse: "<empty response>",
    requestFailed: "Request failed",
    invalidHeadersJson: "Headers must be a valid JSON object",
    invalidBodyJson: "Body must be valid JSON",
    copyCode: "Copy code",
    copied: "Copied",
    authLabels: {
      Public: "Public",
      Bearer: "Bearer",
    },
    referenceEndpointsChip: (visible, total) =>
      visible === total
        ? `${total} reference endpoints`
        : `${visible}/${total} endpoints shown`,
    visibleEndpointsSummary: (count) =>
      `${count} visible endpoints across the current filtered collections.`,
    endpointsCountLabel: (count) => `${count} endpoints`,
  },
  vi: {
    metaTitle: "Tài liệu User API PickleTour",
    metaDescription:
      "Tài liệu API cho người dùng của PickleTour gồm xác thực, hồ sơ, giải đấu, câu lạc bộ và live.",
    searchPlaceholder: "Tìm kiếm",
    referenceSearchPlaceholder: "Tìm theo path endpoint, method hoặc tính năng",
    askAi: "Hỏi AI",
    createAccount: "Tạo tài khoản",
    signIn: "Đăng nhập",
    switchToLightTheme: "Chuyển sang giao diện sáng",
    switchToDarkTheme: "Chuyển sang giao diện tối",
    primaryNav: [
      { label: "Bắt đầu", kind: "hero" },
      { label: "Danh tính", sectionId: "auth" },
      { label: "Hồ sơ", sectionId: "profiles" },
      { label: "Giải đấu", sectionId: "tournaments" },
      { label: "Cộng đồng", sectionId: "clubs" },
      { label: "Phát trực tiếp", sectionId: "live" },
    ],
    secondaryNav: [
      { label: "API & SDK", kind: "reference" },
      { label: "Hỗ trợ", href: "mailto:support@pickletour.vn" },
    ],
    landingColumns: [
      {
        title: "Danh tính",
        links: [
          { label: "Tạo tài khoản", sectionId: "auth" },
          { label: "Đăng nhập web", sectionId: "auth" },
          { label: "Khôi phục mật khẩu", sectionId: "auth" },
        ],
      },
      {
        title: "Giải đấu",
        links: [
          { label: "Xem giải đấu", sectionId: "tournaments" },
          { label: "Đăng ký người chơi", sectionId: "tournaments" },
          { label: "Luồng check-in", sectionId: "tournaments" },
        ],
      },
      {
        title: "Nhà phát triển",
        links: [
          { label: "Cấu hình Base URL", kind: "reference" },
          { label: "Test chi tiết overlay", sectionId: "live" },
          { label: "Xem API reference", kind: "reference" },
        ],
      },
    ],
    playgroundCases: [
      {
        id: "session",
        label: "Tạo phiên web",
        detail:
          "Xác thực bằng email hoặc số điện thoại cùng mật khẩu và trả về payload người dùng đã đăng nhập.",
        status: "POST /api/users/auth/web",
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
      },
      {
        id: "tournaments",
        label: "Liệt kê giải đấu",
        detail:
          "Lấy danh sách giải đấu để render card, tìm kiếm, command palette và các bề mặt trang chủ.",
        status: "GET /api/tournaments",
        request: `curl "{{BASE_URL}}/api/tournaments?limit=12&sort=-updatedAt"`,
        response: `[
  {
    "_id": "tour-id",
    "name": "Open Spring Cup",
    "startDate": "2026-05-12T00:00:00.000Z",
    "status": "open"
  }
]`,
      },
      {
        id: "overlay",
        label: "Lấy chi tiết trận overlay",
        detail:
          "Tải payload chi tiết trận dùng cho overlay public và các bề mặt trình chiếu live.",
        status: "GET /api/overlay/match/:id",
        request: `curl "{{BASE_URL}}/api/overlay/match/681d00f9f0d17f18f88a1001"`,
        response: `{
  "success": true,
  "match": {
    "_id": "681d00f9f0d17f18f88a1001",
    "status": "live",
    "court": { "name": "Court 1" },
    "players": [
      { "name": "Player A" },
      { "name": "Player B" }
    ]
  }
}`,
      },
      {
        id: "court-current",
        label: "Lấy trận hiện tại của sân",
        detail:
          "Tải chi tiết court station public kèm currentMatch để render giao diện sân live và các bề mặt giống overlay.",
        status: "GET /api/live/courts/:courtStationId",
        request: `curl "{{BASE_URL}}/api/live/courts/663ca5f1c7b5e4a2ab123456"`,
        response: `{
  "cluster": {
    "_id": "cluster-id",
    "name": "Championship cluster"
  },
  "station": {
    "_id": "court-id",
    "name": "Court 1",
    "status": "live"
  },
  "currentMatch": {
    "_id": "match-id",
    "status": "live",
    "displayCode": "M-203"
  }
}`,
      },
    ],
    useCaseEntryPoints: [
      {
        id: "auth",
        title: "Onboard và đăng nhập",
        summary: "Đăng ký người dùng, tạo phiên và khôi phục tài khoản.",
        recommended: "Xác thực, phiên và khôi phục",
      },
      {
        id: "profiles",
        title: "Hồ sơ và xếp hạng",
        summary: "Tải hồ sơ public, lịch sử và dữ liệu bảng xếp hạng.",
        recommended: "Hồ sơ, rating và ranking",
      },
      {
        id: "clubs",
        title: "Tính năng cộng đồng",
        summary: "Tạo câu lạc bộ, quản lý thành viên và RSVP sự kiện.",
        recommended: "CLB, sự kiện và thông báo",
      },
      {
        id: "live",
        title: "Bề mặt xem live",
        summary: "Tìm feed item, cluster và các trận có thể phát trực tiếp.",
        recommended: "Feed live, cluster và sân",
      },
    ],
    clientHeaders: [
      {
        name: "Authorization",
        value: "Bearer <token>",
        detail:
          "Được gửi tự động khi client hiện tại đang có auth token.",
      },
      {
        name: "X-Request-Id",
        value: "uuid",
        detail:
          "Hữu ích để lần vết request qua log và hệ thống giám sát.",
      },
      {
        name: "X-Timezone",
        value: "Asia/Saigon",
        detail:
          "Web client cũng gửi thêm biến thể GMT và minute offset.",
      },
      {
        name: "X-Device-Id",
        value: "web-visitor-id",
        detail:
          "Được gửi kèm với X-Device-Name bởi các client hiện tại.",
      },
    ],
    accessFilters: [
      { value: "all", label: "Tất cả endpoint" },
      { value: "public", label: "Chỉ public" },
      { value: "bearer", label: "Cần xác thực" },
    ],
    heroTitle: "Tài liệu API",
    heroSummary:
      "Khám phá hướng dẫn, endpoint tham chiếu và ví dụ có thể test để tích hợp các user flow của PickleTour.",
    heroPrimaryCta: "Bắt đầu với PickleTour",
    heroSecondaryCta: "Xem API reference",
    recentlyViewed: "Đã xem gần đây",
    apiBase: "API base",
    local: "Local",
    configured: "Đã cấu hình",
    publicBaseUrl: "Public base URL",
    referenceEndpoints: "Số endpoint tham chiếu",
    floatingCardSummary:
      "Thử trực tiếp từ landing của docs rồi chuyển xuống phần API reference đầy đủ bên dưới.",
    tryItOutTitle: "Thử nhanh",
    tryItOutSummary:
      "Bắt đầu với một request phổ biến rồi chuyển sang API reference đầy đủ với tìm kiếm và bộ lọc.",
    integrationBasics: "Cơ bản khi tích hợp",
    baseUrlAndContract: "Base URL và hợp đồng request",
    integrationSummary:
      "Frontend hiện tại dùng chung base query với credentialed requests, trace headers và ngữ cảnh múi giờ.",
    quickstart: "Khởi động nhanh",
    apiReferenceOverline: "API reference",
    browseEndpointsTitle: "Duyệt endpoint theo nhóm",
    browseEndpointsSummary:
      "Tìm trên bề mặt User API, lọc theo mức truy cập rồi mở từng endpoint card chi tiết bên dưới.",
    userApiDocs: "Tài liệu User API",
    restJson: "REST + JSON",
    collections: "Nhóm",
    support: "Hỗ trợ",
    supportSummary:
      "Cần thêm nhóm endpoint mới hoặc file OpenAPI export cho các user flow này?",
    noMatchingEndpoints: "Không có endpoint phù hợp",
    noMatchingEndpointsSummary:
      "Hãy thử từ khóa rộng hơn hoặc chuyển bộ lọc truy cập về `Tất cả endpoint`.",
    query: "Query",
    body: "Body",
    request: "Request",
    representativeResponse: "Response mẫu",
    additionalCases: "Các case bổ sung",
    caseResponse: "Response của case",
    testEnvironment: "Môi trường test",
    runLiveRequest: "Chạy request thật",
    testerDefaultSummary:
      "Khung test trực tiếp trong trình duyệt cho endpoint này. Hỗ trợ path params, query params, headers và JSON body khi cần. Kết quả vẫn phụ thuộc vào base URL đã cấu hình và quyền CORS của trình duyệt.",
    baseUrl: "Base URL",
    pathParameters: "Tham số path",
    queryParameters: "Tham số query",
    headersJson: "Headers (JSON)",
    bodyJson: "Body (JSON)",
    runRequest: "Chạy request",
    runningRequest: "Đang chạy request...",
    ready: "Sẵn sàng",
    resolvedRequest: "Request đã resolve",
    liveResponse: "Response thật",
    emptyResponse: "<response rỗng>",
    requestFailed: "Request thất bại",
    invalidHeadersJson: "Headers phải là một object JSON hợp lệ",
    invalidBodyJson: "Body phải là JSON hợp lệ",
    copyCode: "Sao chép mã",
    copied: "Đã sao chép",
    authLabels: {
      Public: "Công khai",
      Bearer: "Bearer",
    },
    referenceEndpointsChip: (visible, total) =>
      visible === total
        ? `${total} endpoint tham chiếu`
        : `Hiển thị ${visible}/${total} endpoint`,
    visibleEndpointsSummary: (count) =>
      `${count} endpoint đang hiển thị trong các nhóm đã lọc.`,
    endpointsCountLabel: (count) => `${count} endpoint`,
  },
};

const DOC_SECTION_TRANSLATIONS = {
  vi: {
    auth: {
      eyebrow: "Danh tính",
      title: "API xác thực và phiên đăng nhập",
      summary:
        "Tạo tài khoản, đăng nhập từ web, xoay vòng phiên và khôi phục mật khẩu.",
      note:
        "Luồng web hiện tại dùng /api/users/auth/web và đăng ký không yêu cầu OTP.",
      endpoints: {
        "POST /api/users": {
          title: "Đăng ký người dùng",
          summary:
            "Tạo tài khoản người chơi mới với thông tin hồ sơ cơ bản, liên hệ và avatar tùy chọn.",
        },
        "POST /api/users/auth/web": {
          title: "Tạo phiên web",
          summary:
            "Xác thực bằng email hoặc số điện thoại cùng mật khẩu và trả về payload người dùng đã đăng nhập.",
          notes: [
            "Client mobile hiện vẫn dùng route /api/users/auth riêng.",
            "Web client hiện tại gửi request với credentials được bật.",
          ],
        },
        "POST /api/users/logout": {
          title: "Kết thúc phiên hiện tại",
          summary:
            "Đăng xuất người dùng hiện tại và xóa web session ở backend.",
        },
        "POST /api/users/forgot-password": {
          title: "Bắt đầu khôi phục mật khẩu",
          summary:
            "Khởi tạo luồng đặt lại mật khẩu bằng cách gửi email tài khoản.",
        },
        "POST /api/users/reset-password": {
          title: "Xác nhận đặt lại mật khẩu",
          summary:
            "Hoàn tất luồng reset với reset token và mật khẩu mới.",
        },
      },
    },
    profiles: {
      eyebrow: "Hồ sơ",
      title: "API hồ sơ và xếp hạng",
      summary:
        "Lấy hồ sơ người dùng, lịch sử trận đấu và dữ liệu xếp hạng dùng trên ứng dụng public.",
      note:
        "Các response bên dưới là ví dụ đại diện. Một số endpoint danh sách được client normalize từ array hoặc wrapper payload.",
      endpoints: {
        "GET /api/users/profile": {
          title: "Lấy hồ sơ hiện tại",
          summary:
            "Trả về hồ sơ của người dùng đã đăng nhập dùng cho trang tài khoản và refresh session.",
        },
        "PUT /api/users/profile": {
          title: "Cập nhật hồ sơ hiện tại",
          summary:
            "Lưu các trường hồ sơ có thể chỉnh sửa như nickname, avatar hoặc tỉnh thành.",
        },
        "GET /api/users/:id/public": {
          title: "Lấy hồ sơ người chơi public",
          summary:
            "Tải profile card cho trang public, bảng xếp hạng và giao diện xem thành viên/câu lạc bộ.",
        },
        "GET /api/users/:id/ratings": {
          title: "Lấy lịch sử rating",
          summary:
            "Lấy lịch sử rating để render biểu đồ và timeline hồ sơ người chơi.",
        },
        "GET /api/users/:id/matches": {
          title: "Lấy lịch sử trận đấu",
          summary:
            "Trả về lịch sử trận có phân trang cho hồ sơ người chơi.",
        },
        "GET /api/rankings/rankings/v2": {
          title: "Liệt kê bảng xếp hạng public",
          summary:
            "Endpoint danh sách ranking chính đang được dùng ở màn public rankings.",
        },
        "GET /api/rankings/podium30d": {
          title: "Lấy podium 30 ngày",
          summary:
            "Trả về các leaderboard highlight cho trải nghiệm landing rankings public.",
        },
      },
    },
    tournaments: {
      eyebrow: "Giải đấu",
      title: "API giải đấu",
      summary:
        "Duyệt giải đấu, xem bracket, đăng ký nội dung thi đấu và hỗ trợ luồng check-in.",
      note:
        "Client hiện tại dùng các endpoint này cho danh sách giải public, trang chi tiết, đăng ký và UX check-in.",
      endpoints: {
        "GET /api/tournaments": {
          title: "Liệt kê giải đấu",
          summary:
            "Lấy danh sách giải để render card, tìm kiếm, command palette và các bề mặt trang chủ.",
        },
        "GET /api/tournaments/:id": {
          title: "Lấy chi tiết giải đấu",
          summary:
            "Tải một giải đấu với thông tin tổng quan cho trang chi tiết public.",
        },
        "POST /api/tournaments/:id/registrations": {
          title: "Tạo đăng ký giải đấu",
          summary:
            "Gửi đăng ký người chơi hoặc roster tùy theo loại nội dung thi đấu và cấu hình giải.",
          notes: [
            "Payload thay đổi theo event type và cấu hình của giải đấu.",
          ],
        },
        "GET /api/tournaments/:id/brackets": {
          title: "Liệt kê bracket",
          summary:
            "Trả về danh sách bracket cho trang chi tiết giải hoặc màn hình xem draw.",
        },
        "GET /api/tournaments/:id/matches": {
          title: "Liệt kê trận trong giải",
          summary:
            "Phục vụ lịch thi đấu, bracket view và tra cứu trận cho một giải.",
        },
        "GET /api/tournaments/checkin/search": {
          title: "Tìm đăng ký để check-in",
          summary:
            "Tìm theo số điện thoại hoặc nickname để chuẩn bị cho luồng check-in phía người dùng.",
        },
        "POST /api/tournaments/checkin": {
          title: "Xác nhận check-in người dùng",
          summary:
            "Hoàn tất check-in cho người dùng hiện tại sau khi đã tra cứu đăng ký.",
        },
      },
    },
    clubs: {
      eyebrow: "Cộng đồng",
      title: "API câu lạc bộ",
      summary:
        "Hỗ trợ khám phá câu lạc bộ, luồng thành viên, thông báo và tham gia sự kiện.",
      note:
        "Route chi tiết câu lạc bộ ở backend hiện tại chấp nhận cả object id lẫn slug.",
      endpoints: {
        "GET /api/clubs": {
          title: "Liệt kê câu lạc bộ",
          summary:
            "Khám phá các câu lạc bộ public hoặc lọc về các câu lạc bộ mà người dùng hiện tại đã tham gia.",
        },
        "GET /api/clubs/:id": {
          title: "Lấy trang chi tiết câu lạc bộ",
          summary:
            "Tải một câu lạc bộ public, hoặc câu lạc bộ ẩn nếu người dùng có quyền thành viên/admin.",
        },
        "POST /api/clubs": {
          title: "Tạo câu lạc bộ",
          summary:
            "Tạo câu lạc bộ mới với branding, visibility và cấu hình thành viên.",
        },
        "POST /api/clubs/:id/join": {
          title: "Gửi yêu cầu tham gia câu lạc bộ",
          summary:
            "Tham gia ngay nếu câu lạc bộ mở, hoặc tạo yêu cầu chờ duyệt nếu cần phê duyệt.",
        },
        "GET /api/clubs/:id/events": {
          title: "Liệt kê sự kiện của câu lạc bộ",
          summary:
            "Trả về sự kiện CLB cho lịch, upcoming sessions và event cards.",
        },
        "POST /api/clubs/:id/events/:eventId/rsvp": {
          title: "RSVP cho sự kiện CLB",
          summary:
            "Đánh dấu người dùng hiện tại là tham gia, không tham gia hoặc xóa trạng thái RSVP.",
          notes: ['Giá trị chấp nhận: "going", "not_going", "none".'],
        },
        "GET /api/clubs/:id/events/:eventId/ics": {
          title: "Tải file mời ICS",
          summary:
            "Tạo file lịch cho sự kiện CLB để người dùng thêm vào lịch trên thiết bị.",
        },
        "GET /api/clubs/:id/announcements": {
          title: "Liệt kê thông báo của câu lạc bộ",
          summary:
            "Lấy bài thông báo cho feed trang chủ CLB và giao diện moderation của admin.",
        },
      },
    },
    live: {
      eyebrow: "Phát trực tiếp",
      title: "API live và feed",
      summary:
        "Phục vụ kệ trận live, feed stream public, chi tiết sân và các trang cluster.",
      note:
        "Các endpoint feed/live hiện đã hỗ trợ phân trang, lọc và tìm kiếm trong frontend public.",
      endpoints: {
        "GET /api/live/matches": {
          title: "Liệt kê trận có thể live",
          summary:
            "Truy vấn các trận scheduled, queued, assigned hoặc live cho dashboard và trang sân live.",
        },
        "GET /api/live/feed": {
          title: "Liệt kê feed live public",
          summary:
            "Endpoint feed chính cho trải nghiệm xem live public với cách sắp xếp thông minh.",
        },
        "GET /api/live/feed/search": {
          title: "Tìm trong feed",
          summary:
            "Endpoint tìm kiếm độ trễ thấp cho autocomplete và lọc nhanh feed live.",
        },
        "GET /api/live/clusters": {
          title: "Liệt kê live cluster",
          summary:
            "Trả về các cluster public gom nhóm nhiều sân hoặc stream.",
        },
        "GET /api/live/clusters/:clusterId": {
          title: "Lấy một live cluster",
          summary:
            "Tải trang cluster với danh sách sân, stream và metadata liên quan.",
        },
        "GET /api/live/courts/:courtStationId": {
          title: "Lấy sân live và trận hiện tại",
          summary:
            "Trả về chi tiết cụm sân, court station runtime và payload currentMatch chi tiết cho bề mặt live/overlay.",
          notes: [
            "Response có cả station.currentMatch dạng summary và currentMatch dạng chi tiết ở top-level.",
            "Nếu sân chưa có trận đang diễn ra thì currentMatch sẽ là null.",
          ],
          tester: {
            title: "Chạy thử endpoint sân hiện tại",
            summary:
              "Nhập court station id thật để lấy chi tiết sân và trận hiện tại trực tiếp từ trang docs.",
            pathParams: {
              courtStationId: {
                label: "ID sân",
                placeholder: "663ca5f1c7b5e4a2ab123456",
              },
            },
          },
          cases: [
            {
              title: "Sân tồn tại nhưng chưa có trận hiện tại",
              summary:
                "currentMatch sẽ là null, còn cluster và station vẫn được trả về để frontend tiếp tục render trạng thái sân.",
              label: "Response khi chưa có currentMatch",
            },
            {
              title: "courtStationId không hợp lệ",
              summary:
                "Backend trả lỗi 400 khi id không phải ObjectId hợp lệ.",
              label: "Response 400",
            },
            {
              title: "Không tìm thấy sân",
              summary:
                "Backend trả lỗi 404 khi court station không tồn tại.",
              label: "Response 404",
            },
          ],
        },
        "GET /api/live/courts/:courtStationId/current-match-overlay": {
          title: "Lấy trận live hiện tại của sân theo định dạng overlay",
          summary:
            "Trả về cluster, court station và payload currentMatch cùng cấu trúc với /api/overlay/match/:id cho trận đang live của sân.",
          notes: [
            "Endpoint này chỉ phục vụ khi sân đang có trận live; nếu sân đang idle hoặc chỉ mới gán trận thì backend sẽ trả 404.",
            "Dùng endpoint này khi frontend đã đứng trong ngữ cảnh một sân và cần payload overlay chi tiết mà không phải gọi thêm /api/overlay/match/:id.",
          ],
          tester: {
            title: "Chạy thử endpoint trận live dạng overlay của sân",
            summary:
              "Nhập court station id thật để lấy cluster, station và payload currentMatch kiểu overlay trực tiếp từ trang docs.",
            pathParams: {
              courtStationId: {
                label: "ID sân",
                placeholder: "663ca5f1c7b5e4a2ab123456",
              },
            },
          },
          cases: [
            {
              title: "Sân tồn tại nhưng chưa có trận live",
              summary:
                "Endpoint này không trả currentMatch = null mà trả 404 để báo rõ sân chưa có trận live sẵn sàng cho overlay.",
              label: "Response 404 khi chưa có trận live",
            },
            {
              title: "courtStationId không hợp lệ",
              summary:
                "Backend trả lỗi 400 khi id không phải ObjectId hợp lệ.",
              label: "Response 400",
            },
            {
              title: "Không tìm thấy sân",
              summary:
                "Backend trả lỗi 404 khi court station không tồn tại.",
              label: "Response 404",
            },
          ],
        },
        "GET /api/overlay/match/:id/current": {
          title: "Lấy trận hiện tại theo ngữ cảnh sân của trận",
          summary:
            "Nhận match id, dò xem trận đó đang thuộc sân/cụm sân nào, rồi trả payload overlay của trận đang live trên chính sân đó nếu có.",
          notes: [
            "Nếu chính trận được truyền vào đang live thì response sẽ là overlay của chính trận đó.",
            "Nếu trận được truyền vào chưa live nhưng sân của nó đang phát một trận live khác thì response sẽ tự chuyển sang trận đang live đó.",
            "Nếu không tìm được sân phù hợp hoặc sân chưa có trận live nào thì endpoint sẽ fallback về payload overlay của chính trận được truyền vào.",
          ],
          tester: {
            title: "Chạy thử endpoint trận hiện tại theo match id",
            summary:
              "Nhập match id để backend tự kiểm tra sân hiện tại của trận và trả payload overlay của trận đang live theo đúng ngữ cảnh sân.",
            pathParams: {
              id: {
                label: "Match ID",
                placeholder: "663ca5f1c7b5e4a2ab123456",
              },
            },
          },
          cases: [
            {
              title: "Chính trận được gọi đang live",
              summary:
                "Endpoint trả payload overlay của đúng trận được yêu cầu vì đó đã là trận live hiện tại của sân.",
              label: "Response của chính trận live",
            },
            {
              title: "Sân đang live trận khác",
              summary:
                "response.matchId sẽ đổi sang match id của trận đang live trên cùng sân, thay vì giữ match id ở path.",
              label: "Response chuyển sang trận live của sân",
            },
            {
              title: "match id không hợp lệ",
              summary:
                "Backend trả lỗi 400 khi id không phải ObjectId hợp lệ.",
              label: "Response 400",
            },
            {
              title: "Không tìm thấy trận",
              summary:
                "Backend trả lỗi 404 khi không tồn tại Match hoặc UserMatch tương ứng.",
              label: "Response 404",
            },
          ],
        },
        "GET /api/overlay/match/:id": {
          title: "Lấy chi tiết trận cho overlay",
          summary:
            "Trả về snapshot public của trận dùng cho score overlay, live studio và các bề mặt bảng điểm.",
          tester: {
            title: "Chạy thử endpoint overlay snapshot",
            summary:
              "Nhập match id thật hoặc user-match id để lấy payload overlay trực tiếp từ trang docs.",
            pathParams: {
              id: {
                label: "Match ID",
                placeholder: "663ca5f1c7b5e4a2ab123456",
              },
            },
          },
        },
      },
    },
  },
};

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
          "Return the public cluster, station runtime payload and the detailed currentMatch payload for a single court station.",
        request: `curl {{BASE_URL}}/api/live/courts/court-id`,
        response: `{
  "cluster": {
    "_id": "cluster-id",
    "name": "Championship cluster",
    "slug": "championship-cluster",
    "venueName": "PickleTour Arena",
    "color": "#2455d1"
  },
  "station": {
    "_id": "court-id",
    "name": "Court 1",
    "code": "C1",
    "status": "live",
    "isActive": true,
    "currentMatch": {
      "_id": "match-id",
      "status": "live",
      "code": "M-203",
      "displayCode": "M-203",
      "teamAName": "pickle.alpha & pickle.beta",
      "teamBName": "pickle.gamma & pickle.delta",
      "courtStationId": "court-id",
      "courtStationName": "Court 1",
      "score": {
        "a": 11,
        "b": 8
      }
    },
    "currentTournament": {
      "_id": "tour-id",
      "name": "Open Spring Cup",
      "image": "https://cdn.example.com/tournaments/open-spring-cup.jpg",
      "status": "live"
    }
  },
  "currentMatch": {
    "_id": "match-id",
    "status": "live",
    "displayCode": "M-203",
    "roundLabel": "Semi Final",
    "stageType": "playoff",
    "currentGame": 1,
    "gameScores": [
      { "a": 11, "b": 8 },
      { "a": 6, "b": 4 }
    ],
    "teams": {
      "A": {
        "name": "pickle.alpha & pickle.beta",
        "players": [
          { "id": "user-a", "displayName": "pickle.alpha" },
          { "id": "user-b", "displayName": "pickle.beta" }
        ]
      },
      "B": {
        "name": "pickle.gamma & pickle.delta",
        "players": [
          { "id": "user-c", "displayName": "pickle.gamma" },
          { "id": "user-d", "displayName": "pickle.delta" }
        ]
      }
    },
    "tournament": {
      "_id": "tour-id",
      "name": "Open Spring Cup",
      "eventType": "double",
      "nameDisplayMode": "nickname"
    },
    "courtStationId": "court-id",
    "courtStationName": "Court 1",
    "courtClusterId": "cluster-id",
    "courtClusterName": "Championship cluster",
    "serve": {
      "side": "A",
      "server": 2,
      "opening": true
    },
    "video": "https://stream.example.com/live.m3u8"
  }
}`,
        notes: [
          "Use this endpoint when the public UI needs the current court state and the detailed match snapshot in one request.",
          "Top-level currentMatch is richer than station.currentMatch and is the better source for overlay-style UIs.",
        ],
        cases: [
          {
            title: "Court exists but has no current match",
            summary:
              "The court and cluster still resolve, but currentMatch is null until a live or assigned match is linked.",
            label: "Response without currentMatch",
            response: `{
  "cluster": {
    "_id": "cluster-id",
    "name": "Championship cluster"
  },
  "station": {
    "_id": "court-id",
    "name": "Court 3",
    "status": "idle",
    "currentMatch": null,
    "currentTournament": null
  },
  "currentMatch": null
}`,
          },
          {
            title: "Invalid courtStationId",
            summary:
              "The backend returns a 400 error when the path param is not a valid ObjectId.",
            label: "400 response",
            response: `{
  "message": "Invalid courtStationId"
}`,
          },
          {
            title: "Court station not found",
            summary:
              "The backend returns a 404 error when the station does not exist.",
            label: "404 response",
            response: `{
  "message": "Court station not found"
}`,
          },
        ],
        tester: {
          title: "Run the public court snapshot endpoint",
          summary:
            "Enter a real court station id to fetch the cluster, station and currentMatch payload directly from this docs page.",
          method: "GET",
          pathTemplate: "/api/live/courts/:courtStationId",
          pathParams: [
            {
              name: "courtStationId",
              label: "Court station ID",
              placeholder: "663ca5f1c7b5e4a2ab123456",
              defaultValue: "",
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/api/live/courts/:courtStationId/current-match-overlay",
        auth: "Public",
        title: "Get the current live court match in overlay format",
        summary:
          "Return the public cluster, station runtime payload and the current live match in the same response shape used by /api/overlay/match/:id.",
        request: `curl {{BASE_URL}}/api/live/courts/court-id/current-match-overlay`,
        response: `{
  "cluster": {
    "_id": "cluster-id",
    "name": "Championship cluster",
    "slug": "championship-cluster",
    "venueName": "PickleTour Arena",
    "color": "#2455d1"
  },
  "station": {
    "_id": "court-id",
    "name": "Court 1",
    "code": "C1",
    "status": "live",
    "isActive": true,
    "currentMatch": {
      "_id": "match-id",
      "status": "live",
      "code": "M-203",
      "displayCode": "M-203"
    }
  },
  "currentMatch": {
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
      }
    },
    "bracket": {
      "id": "bracket-id",
      "type": "knockout",
      "name": "Main Draw",
      "stage": "main",
      "drawRounds": 4
    },
    "roundCode": "SF",
    "roundName": "Semi Final",
    "round": 3,
    "roundSize": 4,
    "stageType": "playoff",
    "stageName": "Semi Final",
    "code": "M-203",
    "teams": {
      "A": {
        "name": "pickle.alpha & pickle.beta",
        "displayName": "pickle.alpha & pickle.beta",
        "players": [
          {
            "id": "user-a",
            "nickname": "pickle.alpha",
            "displayName": "pickle.alpha",
            "shortName": "Alpha"
          },
          {
            "id": "user-b",
            "nickname": "pickle.beta",
            "displayName": "pickle.beta",
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
        "players": [
          {
            "id": "user-c",
            "nickname": "pickle.gamma",
            "displayName": "pickle.gamma",
            "shortName": "Gamma"
          },
          {
            "id": "user-d",
            "nickname": "pickle.delta",
            "displayName": "pickle.delta",
            "shortName": "Delta"
          }
        ],
        "seed": 4,
        "label": "Team B",
        "teamName": "Gamma / Delta"
      }
    },
    "score": {
      "bestOf": 3,
      "gamesToWin": 2,
      "pointsToWin": 11,
      "winByTwo": true,
      "setsWon": {
        "A": 1,
        "B": 0
      },
      "gameScores": [
        { "a": 11, "b": 8 },
        { "a": 6, "b": 4 }
      ]
    },
    "court": {
      "courtId": "court-id",
      "courtName": "Court 1",
      "courtExtra": {
        "label": "Court 1",
        "cluster": "Championship cluster"
      }
    },
    "referee": {
      "name": "Referee Demo"
    },
    "liveBy": {
      "name": "Streaming Operator"
    },
    "serve": {
      "team": "A",
      "server": 2,
      "opening": true
    },
    "video": "https://stream.example.com/live.m3u8"
  }
}`,
        notes: [
          "Use this endpoint when the client is already scoped to a court station and needs the overlay payload for the live match in one request.",
          "This endpoint returns 404 instead of currentMatch: null when the court does not have a live match. Keep using /api/live/courts/:courtStationId if you need idle court state.",
        ],
        cases: [
          {
            title: "Court exists but no live match is active",
            summary:
              "The station resolves, but the endpoint rejects the request because it only serves live overlay payloads.",
            label: "404 response without an active live match",
            response: `{
  "message": "No live match found for this court station"
}`,
          },
          {
            title: "Invalid courtStationId",
            summary:
              "The backend returns a 400 error when the path param is not a valid ObjectId.",
            label: "400 response",
            response: `{
  "message": "Invalid courtStationId"
}`,
          },
          {
            title: "Court station not found",
            summary:
              "The backend returns a 404 error when the station does not exist.",
            label: "404 response",
            response: `{
  "message": "Court station not found"
}`,
          },
        ],
        tester: {
          title: "Run the live court overlay endpoint",
          summary:
            "Enter a real court station id to fetch the cluster, station and overlay-style currentMatch payload directly from this docs page.",
          method: "GET",
          pathTemplate: "/api/live/courts/:courtStationId/current-match-overlay",
          pathParams: [
            {
              name: "courtStationId",
              label: "Court station ID",
              placeholder: "663ca5f1c7b5e4a2ab123456",
              defaultValue: "",
            },
          ],
        },
      },
      {
        method: "GET",
        path: "/api/overlay/match/:id/current",
        auth: "Public",
        title: "Get the current live overlay match from a match context",
        summary:
          "Accept a match id, inspect the court station and cluster that match belongs to, then return the overlay payload for the live match currently running on that station when applicable.",
        request: `curl {{BASE_URL}}/api/overlay/match/match-id/current`,
        response: `{
  "matchId": "live-match-id",
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
    "webLogoAlt": "PickleTour"
  },
  "bracket": {
    "id": "bracket-id",
    "type": "knockout",
    "name": "Main Draw",
    "order": 1,
    "stage": "main",
    "drawRounds": 4,
    "drawStatus": "ready"
  },
  "roundCode": "SF",
  "roundName": "Semi Final",
  "round": 3,
  "roundSize": 4,
  "stageType": "playoff",
  "stageName": "Bán kết",
  "code": "M-207",
  "teams": {
    "A": {
      "displayName": "pickle.alpha & pickle.beta"
    },
    "B": {
      "displayName": "pickle.gamma & pickle.delta"
    }
  },
  "score": {
    "bestOf": 3,
    "gamesToWin": 2,
    "pointsToWin": 11,
    "winByTwo": true,
    "setsWon": {
      "A": 1,
      "B": 0
    },
    "gameScores": [
      { "a": 11, "b": 8 },
      { "a": 6, "b": 4 }
    ]
  },
  "court": {
    "courtId": "court-id",
    "courtName": "Court 1",
    "courtExtra": {
      "label": "Court 1",
      "cluster": "Championship cluster"
    }
  },
  "serve": {
    "team": "A",
    "server": 2,
    "opening": true
  },
  "video": "https://stream.example.com/live.m3u8"
}`,
        notes: [
          "The response shape matches the overlay endpoint. Compare the requested path id with response.matchId if you need to know whether the backend resolved to another live match on the same court.",
          "Use this endpoint when the caller starts from a match id but still wants the currently live overlay payload for the same court context.",
        ],
        cases: [
          {
            title: "The requested match is already live",
            summary:
              "The endpoint returns the overlay payload for the requested match itself because it is already the live match on that court.",
            label: "Response for the requested live match",
            response: `{
  "matchId": "requested-match-id",
  "status": "LIVE",
  "code": "M-203"
}`,
          },
          {
            title: "Another match is currently live on the same court",
            summary:
              "The response payload switches to the court station's live match, so response.matchId can differ from the path id.",
            label: "Response for the station's current live match",
            response: `{
  "matchId": "live-match-id",
  "status": "LIVE",
  "code": "M-207"
}`,
          },
          {
            title: "Invalid match id",
            summary:
              "The backend returns a 400 error when the path param is not a valid ObjectId.",
            label: "400 response",
            response: `{
  "message": "Invalid match id"
}`,
          },
          {
            title: "Match not found",
            summary:
              "The backend returns a 404 error when neither Match nor UserMatch exists for the requested id.",
            label: "404 response",
            response: `{
  "message": "Match not found"
}`,
          },
        ],
        tester: {
          title: "Run the resolved current overlay endpoint",
          summary:
            "Enter a match id to fetch the overlay payload for the live match currently active on the same court context.",
          method: "GET",
          pathTemplate: "/api/overlay/match/:id/current",
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

function buildTesterUrl(
  baseUrl,
  pathTemplate,
  pathValues = {},
  queryValues = {},
) {
  const normalizedBase = String(baseUrl || "").trim().replace(/\/+$/, "");
  const resolvedPath = Object.entries(pathValues).reduce((path, [key, value]) => {
    return path.replace(`:${key}`, encodeURIComponent(String(value || "").trim()));
  }, pathTemplate);
  const searchParams = new URLSearchParams();

  Object.entries(queryValues).forEach(([key, value]) => {
    const normalizedValue = String(value ?? "").trim();
    if (!normalizedValue) return;
    searchParams.append(key, normalizedValue);
  });

  const queryString = searchParams.toString();
  return `${normalizedBase}${resolvedPath}${queryString ? `?${queryString}` : ""}`;
}

function extractPathParamNames(pathTemplate) {
  return Array.from(
    String(pathTemplate || "").matchAll(/:([A-Za-z0-9_]+)/g),
    (match) => match[1],
  );
}

function humanizeDocFieldLabel(name) {
  return String(name || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) =>
      /^id$/i.test(part)
        ? "ID"
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

function parseEndpointFieldSpec(field) {
  const raw = String(field || "").trim();
  if (!raw) return null;

  const optional = raw.endsWith("?");
  const normalized = optional ? raw.slice(0, -1) : raw;
  const separatorIndex = normalized.indexOf("=");
  const name =
    separatorIndex >= 0
      ? normalized.slice(0, separatorIndex).trim()
      : normalized.trim();
  const defaultValue =
    separatorIndex >= 0 ? normalized.slice(separatorIndex + 1).trim() : "";

  if (!name) return null;

  return {
    name,
    label: humanizeDocFieldLabel(name),
    placeholder: name,
    defaultValue,
    required: !optional,
  };
}

function buildTesterFieldsFromSpecs(fields = []) {
  return fields
    .map((item) => parseEndpointFieldSpec(item))
    .filter(Boolean);
}

function extractCurlHeaders(requestCode = "") {
  const headers = {};
  const pattern = /-H\s+["']([^"']+)["']/g;
  let match;

  while ((match = pattern.exec(String(requestCode || ""))) !== null) {
    const rawHeader = match[1];
    const separatorIndex = rawHeader.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = rawHeader.slice(0, separatorIndex).trim();
    const value = rawHeader.slice(separatorIndex + 1).trim();
    if (!key) continue;
    headers[key] = value;
  }

  return headers;
}

function extractCurlBody(requestCode = "") {
  const singleQuoteMatch = String(requestCode || "").match(/-d\s+'([\s\S]*?)'/);
  if (singleQuoteMatch?.[1]) {
    return singleQuoteMatch[1].trim();
  }

  const doubleQuoteMatch = String(requestCode || "").match(/-d\s+"([\s\S]*?)"/);
  return doubleQuoteMatch?.[1]?.trim() || "";
}

function extractCurlRequestTarget(requestCode = "") {
  const match = String(requestCode || "").match(
    /(?:\{\{BASE_URL\}\}|https?:\/\/|\/api)[^"'`\s\\]+/,
  );
  return match?.[0] || "";
}

function extractCurlQueryDefaults(requestCode = "") {
  const requestTarget = extractCurlRequestTarget(requestCode);
  if (!requestTarget) return {};

  try {
    const normalizedTarget = requestTarget.startsWith("http")
      ? requestTarget
      : requestTarget.replace("{{BASE_URL}}", "https://example.com");
    const parsedUrl = new URL(normalizedTarget, "https://example.com");
    return Object.fromEntries(parsedUrl.searchParams.entries());
  } catch {
    return {};
  }
}

function buildDefaultTesterBody(bodyFields = []) {
  const payload = bodyFields.reduce((acc, item) => {
    const field = parseEndpointFieldSpec(item);
    if (!field) return acc;
    acc[field.name] = field.defaultValue || "";
    return acc;
  }, {});

  return Object.keys(payload).length
    ? JSON.stringify(payload, null, 2)
    : "";
}

function buildDefaultTesterHeaders(endpoint, method, bodyText) {
  const defaultAccept =
    endpoint.responseLang === "text" ? "text/plain" : "application/json";
  const headers = {
    Accept: defaultAccept,
    ...extractCurlHeaders(endpoint.request),
  };

  if (endpoint.auth !== "Public" && !headers.Authorization) {
    headers.Authorization = "Bearer <token>";
  }

  if (String(bodyText || "").trim() && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  return JSON.stringify(headers, null, 2);
}

function buildResolvedRequestPreview({
  method,
  requestUrl,
  headersText,
  bodyText,
  supportsBody,
  uiText,
}) {
  const preview = [`${method} ${requestUrl}`];

  if (String(headersText || "").trim()) {
    preview.push("", `${uiText.headersJson}:`, String(headersText || "").trim());
  }

  if (supportsBody && String(bodyText || "").trim()) {
    preview.push("", `${uiText.bodyJson}:`, String(bodyText || "").trim());
  }

  return preview.join("\n");
}

function buildEndpointTester(endpoint, uiText = DOCS_UI_TEXT.en) {
  const method = endpoint.tester?.method || endpoint.method || "GET";
  const pathTemplate = endpoint.tester?.pathTemplate || endpoint.path;
  const queryDefaults = extractCurlQueryDefaults(endpoint.request);
  const pathParams =
    endpoint.tester?.pathParams?.length
      ? endpoint.tester.pathParams
      : extractPathParamNames(pathTemplate).map((name) => ({
          name,
          label: humanizeDocFieldLabel(name),
          placeholder: name,
          defaultValue: "",
          required: true,
        }));
  const queryParams =
    endpoint.tester?.queryParams?.length
      ? endpoint.tester.queryParams
      : buildTesterFieldsFromSpecs(endpoint.query).map((item) => ({
          ...item,
          defaultValue: queryDefaults[item.name] ?? item.defaultValue ?? "",
        }));
  const extractedBody = extractCurlBody(endpoint.request);
  const bodyText =
    endpoint.tester?.bodyText ??
    (extractedBody || buildDefaultTesterBody(endpoint.body));
  const supportsBody =
    endpoint.tester?.supportsBody ??
    (Boolean(String(bodyText || "").trim()) ||
      ["POST", "PUT", "PATCH", "DELETE"].includes(method));
  const headersText =
    endpoint.tester?.headersText ||
    buildDefaultTesterHeaders(endpoint, method, supportsBody ? bodyText : "");

  return {
    title: endpoint.tester?.title || `${uiText.runRequest}: ${method} ${pathTemplate}`,
    summary: endpoint.tester?.summary || uiText.testerDefaultSummary,
    method,
    pathTemplate,
    pathParams,
    queryParams,
    headersText,
    bodyText: supportsBody ? bodyText : "",
    supportsBody,
    responseLanguage: endpoint.responseLang || "json",
  };
}

function resolveDocsBaseUrl(code, runtimeBaseUrl) {
  return String(code || "").replaceAll("{{BASE_URL}}", runtimeBaseUrl);
}

function mergeTesterTranslation(tester, testerTranslation = {}) {
  if (!tester) return tester;

  const {
    pathParams: pathParamTranslations,
    queryParams: queryParamTranslations,
    ...testerTextTranslations
  } =
    testerTranslation;

  const translatedPathParams = Array.isArray(tester.pathParams)
    ? tester.pathParams.map((param) => ({
        ...param,
        ...(pathParamTranslations?.[param.name] || {}),
      }))
    : tester.pathParams;

  const translatedQueryParams = Array.isArray(tester.queryParams)
    ? tester.queryParams.map((param) => ({
        ...param,
        ...(queryParamTranslations?.[param.name] || {}),
      }))
    : tester.queryParams;

  return {
    ...tester,
    ...testerTextTranslations,
    pathParams: translatedPathParams,
    queryParams: translatedQueryParams,
  };
}

function mergeCaseTranslations(cases = [], caseTranslations = []) {
  if (!Array.isArray(cases)) return cases;
  return cases.map((item, index) => ({
    ...item,
    ...((Array.isArray(caseTranslations) ? caseTranslations[index] : null) || {}),
  }));
}

function localizeDocSections(sections, language) {
  if (language !== "vi") return sections;

  return sections.map((section) => {
    const sectionTranslation = DOC_SECTION_TRANSLATIONS.vi?.[section.id];
    if (!sectionTranslation) return section;

    return {
      ...section,
      eyebrow: sectionTranslation.eyebrow || section.eyebrow,
      title: sectionTranslation.title || section.title,
      summary: sectionTranslation.summary || section.summary,
      note: sectionTranslation.note || section.note,
      endpoints: Array.isArray(section.endpoints)
        ? section.endpoints.map((endpoint) => {
            const endpointKey = `${endpoint.method} ${endpoint.path}`;
            const endpointTranslation =
              sectionTranslation.endpoints?.[endpointKey];

            if (!endpointTranslation) return endpoint;

            return {
              ...endpoint,
              title: endpointTranslation.title || endpoint.title,
              summary: endpointTranslation.summary || endpoint.summary,
              notes: endpointTranslation.notes || endpoint.notes,
              tester: mergeTesterTranslation(
                endpoint.tester,
                endpointTranslation.tester,
              ),
              cases: mergeCaseTranslations(
                endpoint.cases,
                endpointTranslation.cases,
              ),
            };
          })
        : section.endpoints,
    };
  });
}

function getEndpointAuthLabel(auth, uiText) {
  return uiText?.authLabels?.[auth] || auth;
}

function CodePanel({
  label,
  code,
  language = "bash",
  docsColors,
  uiText = DOCS_UI_TEXT.en,
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
            <Tooltip title={copied ? uiText.copied : uiText.copyCode}>
              <IconButton
                size="small"
                aria-label={copied ? uiText.copied : uiText.copyCode}
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
  uiText = DOCS_UI_TEXT.en,
  runtimeBaseUrl,
  copiedKey,
  onCopyCode,
}) {
  const pathParamSignature = JSON.stringify(tester.pathParams || []);
  const queryParamSignature = JSON.stringify(tester.queryParams || []);
  const initialParams = useMemo(() => {
    return (tester.pathParams || []).reduce((acc, item) => {
      acc[item.name] = item.defaultValue || "";
      return acc;
    }, {});
  }, [tester.pathParams]);
  const initialQueryParams = useMemo(() => {
    return (tester.queryParams || []).reduce((acc, item) => {
      acc[item.name] = item.defaultValue || "";
      return acc;
    }, {});
  }, [tester.queryParams]);

  const [baseUrl, setBaseUrl] = useState(runtimeBaseUrl);
  const [params, setParams] = useState(initialParams);
  const [queryParams, setQueryParams] = useState(initialQueryParams);
  const [headersText, setHeadersText] = useState(tester.headersText || "");
  const [bodyText, setBodyText] = useState(tester.bodyText || "");
  const [isRunning, setIsRunning] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [responseText, setResponseText] = useState("");
  const [responseLanguage, setResponseLanguage] = useState(
    tester.responseLanguage || "json",
  );
  const [requestError, setRequestError] = useState("");

  useEffect(() => {
    setBaseUrl(runtimeBaseUrl);
    setParams(initialParams);
    setQueryParams(initialQueryParams);
    setHeadersText(tester.headersText || "");
    setBodyText(tester.bodyText || "");
    setResponseLanguage(tester.responseLanguage || "json");
  }, [
    runtimeBaseUrl,
    pathParamSignature,
    queryParamSignature,
    tester.bodyText,
    tester.headersText,
    tester.responseLanguage,
    initialParams,
    initialQueryParams,
  ]);

  const requestUrl = buildTesterUrl(
    baseUrl,
    tester.pathTemplate,
    params,
    queryParams,
  );
  const missingRequiredParam = (tester.pathParams || []).some(
    (item) => item.required !== false && !String(params[item.name] || "").trim(),
  );
  const missingRequiredQueryParam = (tester.queryParams || []).some(
    (item) =>
      item.required !== false &&
      !String(queryParams[item.name] || "").trim(),
  );
  const resolvedRequestPreview = buildResolvedRequestPreview({
    method: tester.method || "GET",
    requestUrl,
    headersText,
    bodyText,
    supportsBody: tester.supportsBody,
    uiText,
  });

  const handleParamChange = (name, value) => {
    setParams((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleQueryParamChange = (name, value) => {
    setQueryParams((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const runRequest = async () => {
    if (missingRequiredParam || missingRequiredQueryParam) return;

    setIsRunning(true);
    setRequestError("");
    setStatusText("");
    setResponseText("");

    try {
      let parsedHeaders = {};
      if (String(headersText || "").trim()) {
        try {
          const headerPayload = JSON.parse(headersText);
          if (
            !headerPayload ||
            Array.isArray(headerPayload) ||
            typeof headerPayload !== "object"
          ) {
            throw new Error(uiText.invalidHeadersJson);
          }

          parsedHeaders = Object.fromEntries(
            Object.entries(headerPayload)
              .filter(([key, value]) => {
                return (
                  String(key || "").trim() &&
                  value !== null &&
                  value !== undefined &&
                  String(value).trim() !== ""
                );
              })
              .map(([key, value]) => [String(key), String(value)]),
          );
        } catch {
          throw new Error(uiText.invalidHeadersJson);
        }
      }

      let requestBody;
      if (tester.supportsBody && String(bodyText || "").trim()) {
        try {
          requestBody = JSON.stringify(JSON.parse(bodyText));
        } catch {
          throw new Error(uiText.invalidBodyJson);
        }
      }

      const response = await fetch(requestUrl, {
        method: tester.method || "GET",
        headers: parsedHeaders,
        body: requestBody,
        credentials: "include",
      });

      const rawText = await response.text();
      let prettyText = rawText;
      let nextLanguage = tester.responseLanguage || "text";

      try {
        prettyText = JSON.stringify(JSON.parse(rawText), null, 2);
        nextLanguage = "json";
      } catch {
        prettyText = rawText;
        nextLanguage = tester.responseLanguage || "text";
      }

      setStatusText(`${response.status} ${response.statusText}`.trim());
      setResponseLanguage(nextLanguage);
      setResponseText(prettyText || uiText.emptyResponse);
    } catch (error) {
      setRequestError(error?.message || uiText.requestFailed);
      setResponseLanguage("text");
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
          {uiText.testEnvironment}
        </Typography>
        <Typography
          sx={{
            ...STRIPE_TYPE.label,
            color: docsColors.text,
          }}
        >
          {tester.title || uiText.runLiveRequest}
        </Typography>
        <Typography
          sx={{
            ...STRIPE_TYPE.bodySmall,
            color: "text.secondary",
          }}
        >
          {tester.summary ||
            uiText.testerDefaultSummary}
        </Typography>
      </Stack>

      <Stack spacing={1}>
        <TextField
          label={uiText.baseUrl}
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

        {tester.pathParams?.length ? (
          <Typography
            sx={{
              ...STRIPE_TYPE.overline,
              color: "text.secondary",
              pt: 0.4,
            }}
          >
            {uiText.pathParameters}
          </Typography>
        ) : null}

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

        {tester.queryParams?.length ? (
          <Typography
            sx={{
              ...STRIPE_TYPE.overline,
              color: "text.secondary",
              pt: 0.4,
            }}
          >
            {uiText.queryParameters}
          </Typography>
        ) : null}

        {(tester.queryParams || []).map((item) => (
          <TextField
            key={item.name}
            label={item.label}
            size="small"
            value={queryParams[item.name] || ""}
            onChange={(event) =>
              handleQueryParamChange(item.name, event.target.value)
            }
            placeholder={item.placeholder}
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                backgroundColor: docsColors.surface,
              },
            }}
          />
        ))}

        <TextField
          label={uiText.headersJson}
          size="small"
          value={headersText}
          onChange={(event) => setHeadersText(event.target.value)}
          fullWidth
          multiline
          minRows={4}
          sx={{
            "& .MuiOutlinedInput-root": {
              backgroundColor: docsColors.surface,
              fontFamily: FONT_STACK_MONO,
            },
          }}
        />

        {tester.supportsBody ? (
          <TextField
            label={uiText.bodyJson}
            size="small"
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            fullWidth
            multiline
            minRows={6}
            sx={{
              "& .MuiOutlinedInput-root": {
                backgroundColor: docsColors.surface,
                fontFamily: FONT_STACK_MONO,
              },
            }}
          />
        ) : null}
      </Stack>

      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        <Button
          variant="contained"
          disableElevation
          onClick={runRequest}
          disabled={isRunning || missingRequiredParam || missingRequiredQueryParam}
          sx={{
            alignSelf: "flex-start",
            borderRadius: 999,
            textTransform: "none",
            ...STRIPE_TYPE.label,
          }}
        >
          {isRunning ? uiText.runningRequest : uiText.runRequest}
        </Button>
        <Typography
          sx={{
            ...STRIPE_TYPE.bodySmall,
            color: "text.secondary",
            alignSelf: "center",
          }}
        >
          {statusText || requestError || uiText.ready}
        </Typography>
      </Stack>

      <CodePanel
        label={uiText.resolvedRequest}
        code={resolvedRequestPreview}
        language="http"
        docsColors={docsColors}
        uiText={uiText}
        copyId={`${tester.pathTemplate}-resolved-request`}
        copied={copiedKey === `${tester.pathTemplate}-resolved-request`}
        onCopy={onCopyCode}
      />

      {responseText ? (
        <CodePanel
          label={uiText.liveResponse}
          code={responseText}
          language={responseLanguage}
          docsColors={docsColors}
          uiText={uiText}
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
  uiText = DOCS_UI_TEXT.en,
  copiedKey,
  onCopyCode,
  runtimeBaseUrl,
}) {
  const isPublic = endpoint.auth === "Public";
  const resolvedRequestCode = resolveDocsBaseUrl(
    endpoint.request,
    runtimeBaseUrl,
  );
  const testerConfig = useMemo(
    () => buildEndpointTester(endpoint, uiText),
    [endpoint, uiText],
  );

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
              label={getEndpointAuthLabel(endpoint.auth, uiText)}
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
                {uiText.query}
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
                {uiText.body}
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
            label={uiText.request}
            code={resolvedRequestCode}
            docsColors={docsColors}
            uiText={uiText}
            copyId={`${endpoint.method}-${endpoint.path}-request`}
            copied={copiedKey === `${endpoint.method}-${endpoint.path}-request`}
            onCopy={onCopyCode}
          />
          <CodePanel
            label={uiText.representativeResponse}
            code={endpoint.response}
            language={endpoint.responseLang || "json"}
            docsColors={docsColors}
            uiText={uiText}
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
              {uiText.additionalCases}
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
                  label={item.label || uiText.caseResponse}
                  code={item.response}
                  language={item.language || "json"}
                  docsColors={docsColors}
                  uiText={uiText}
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

        <EndpointTester
          tester={testerConfig}
          docsColors={docsColors}
          uiText={uiText}
          runtimeBaseUrl={runtimeBaseUrl}
          copiedKey={copiedKey}
          onCopyCode={onCopyCode}
        />

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

const testerFieldPropType = PropTypes.shape({
  name: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  placeholder: PropTypes.string,
  defaultValue: PropTypes.string,
  required: PropTypes.bool,
});

const testerPropType = PropTypes.shape({
  title: PropTypes.string,
  summary: PropTypes.string,
  method: PropTypes.string,
  pathTemplate: PropTypes.string.isRequired,
  pathParams: PropTypes.arrayOf(testerFieldPropType),
  queryParams: PropTypes.arrayOf(testerFieldPropType),
  headersText: PropTypes.string,
  bodyText: PropTypes.string,
  supportsBody: PropTypes.bool,
  responseLanguage: PropTypes.string,
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

const docsUiPropType = PropTypes.object;

CodePanel.propTypes = {
  label: PropTypes.string.isRequired,
  code: PropTypes.string.isRequired,
  language: PropTypes.string,
  docsColors: docsColorsPropType.isRequired,
  uiText: docsUiPropType,
  copyId: PropTypes.string,
  copied: PropTypes.bool,
  onCopy: PropTypes.func,
};

EndpointTester.propTypes = {
  tester: testerPropType.isRequired,
  docsColors: docsColorsPropType.isRequired,
  uiText: docsUiPropType,
  runtimeBaseUrl: PropTypes.string.isRequired,
  copiedKey: PropTypes.string,
  onCopyCode: PropTypes.func,
};

EndpointCard.propTypes = {
  endpoint: endpointPropType.isRequired,
  docsColors: docsColorsPropType.isRequired,
  uiText: docsUiPropType,
  copiedKey: PropTypes.string,
  onCopyCode: PropTypes.func,
  runtimeBaseUrl: PropTypes.string.isRequired,
};

export default function ApiDocsPage() {
  const { language } = useLanguage();
  const { isDark, toggleTheme } = useThemeMode();
  const docsUi = DOCS_UI_TEXT[language] || DOCS_UI_TEXT.en;
  const primaryNav = docsUi.primaryNav || DOCS_UI_TEXT.en.primaryNav;
  const secondaryNav = docsUi.secondaryNav || DOCS_UI_TEXT.en.secondaryNav;
  const landingColumns = docsUi.landingColumns || DOCS_UI_TEXT.en.landingColumns;
  const landingPlaygroundCasesConfig =
    docsUi.playgroundCases || DOCS_UI_TEXT.en.playgroundCases;
  const useCaseEntryPoints =
    docsUi.useCaseEntryPoints || DOCS_UI_TEXT.en.useCaseEntryPoints;
  const clientHeaders = docsUi.clientHeaders || DOCS_UI_TEXT.en.clientHeaders;
  const accessFilters = docsUi.accessFilters || DOCS_UI_TEXT.en.accessFilters;
  const localizedDocSections = useMemo(
    () => localizeDocSections(DOC_SECTIONS, language),
    [language],
  );
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
  const DOCS_CODE_TEXT = docsColors.codeText;
  const sectionIds = localizedDocSections.map((section) => section.id);
  const [activeSection, setActiveSection] = useState(sectionIds[0]);
  const [searchTerm, setSearchTerm] = useState("");
  const [accessFilter, setAccessFilter] = useState("all");
  const [copiedKey, setCopiedKey] = useState("");
  const [activePlaygroundCaseId, setActivePlaygroundCaseId] = useState(
    LANDING_PLAYGROUND_CASES[0].id,
  );
  const endpointCount = localizedDocSections.reduce(
    (total, section) => total + section.endpoints.length,
    0,
  );
  const filteredSections = useMemo(() => {
    return localizedDocSections.map((section) => {
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
  }, [accessFilter, localizedDocSections, searchTerm]);
  const filteredEndpointCount = filteredSections.reduce(
    (total, section) => total + section.endpoints.length,
    0,
  );
  const visibleSectionIds = useMemo(
    () => filteredSections.map((section) => section.id),
    [filteredSections],
  );
  const fallbackRuntimeBaseUrl =
    String(import.meta.env.VITE_API_URL || "").trim().replace(/\/+$/, "") ||
    (typeof window !== "undefined"
      ? window.location.origin.replace(/\/+$/, "")
      : "https://pickletour.vn");
  const { data: guideLinkData } = useGetPublicGuideLinkQuery();
  const runtimeBaseUrl = useMemo(() => {
    const configuredBaseUrl = String(guideLinkData?.docsApiBaseUrl || "")
      .trim()
      .replace(/\/+$/, "");

    return configuredBaseUrl || fallbackRuntimeBaseUrl;
  }, [fallbackRuntimeBaseUrl, guideLinkData?.docsApiBaseUrl]);

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

  const landingPlaygroundCases = useMemo(
    () =>
      landingPlaygroundCasesConfig.map((item) => ({
        ...item,
        request: resolveDocsBaseUrl(item.request, runtimeBaseUrl),
      })),
    [landingPlaygroundCasesConfig, runtimeBaseUrl],
  );

  const activePlaygroundCase =
    landingPlaygroundCases.find((item) => item.id === activePlaygroundCaseId) ||
    landingPlaygroundCases[0];

  const jumpToSection = (id) => {
    if (typeof window === "undefined") return;
    const node = document.getElementById(id);
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setActiveSection(id);
  };

  const jumpToReference = () => {
    if (typeof window === "undefined") return;
    const node = document.getElementById("docs-reference");
    if (!node) return;

    node.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", "#docs-reference");
  };

  const handlePrimaryNavClick = (item) => {
    if (item.kind === "hero") {
      if (typeof window === "undefined") return;
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    if (item.sectionId) {
      jumpToSection(item.sectionId);
    }
  };

  const handleSecondaryNavClick = (item) => {
    if (item.kind === "reference") {
      jumpToReference();
      return;
    }

    if (item.href && typeof window !== "undefined") {
      window.location.href = item.href;
    }
  };

  const handleLandingLinkClick = (item) => {
    if (item.kind === "reference") {
      jumpToReference();
      return;
    }

    if (item.sectionId) {
      jumpToSection(item.sectionId);
    }
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
        <title>{docsUi.metaTitle}</title>
        <meta
          name="description"
          content={docsUi.metaDescription}
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
            backdropFilter: "blur(14px)",
          }}
        >
          <Container
            maxWidth={false}
            sx={{ maxWidth: 1440, px: { xs: 2, md: 4, xl: 6 } }}
          >
            <Stack spacing={0}>
              <Box
                sx={{
                  minHeight: 82,
                  display: "grid",
                  alignItems: "center",
                  gap: 2,
                  gridTemplateColumns: {
                    xs: "minmax(0,1fr) auto",
                    lg: "auto minmax(420px, 520px) auto",
                  },
                }}
              >
                <ButtonBase
                  component={RouterLink}
                  to="/"
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-start",
                    gap: 1.2,
                    borderRadius: 2,
                    py: 1,
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: FONT_STACK_SANS,
                      fontWeight: 800,
                      fontSize: { xs: "1.65rem", md: "2rem" },
                      lineHeight: 1,
                      letterSpacing: "-0.04em",
                      color: isDark ? "#f2f5ff" : "#0a2540",
                    }}
                  >
                    Pickle
                    <Box
                      component="span"
                      sx={{
                        color: isDark ? "#9cc0ff" : "#635bff",
                        ml: 0.5,
                      }}
                    >
                      Tour
                    </Box>
                  </Typography>
                </ButtonBase>

                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent="center"
                  sx={{ display: { xs: "none", lg: "flex" } }}
                >
                  <TextField
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder={docsUi.searchPlaceholder}
                    InputProps={{
                      startAdornment: (
                        <SearchIcon
                          sx={{
                            mr: 1,
                            color: STRIPE_SUBTLE_LIGHT,
                            alignSelf: "center",
                          }}
                        />
                      ),
                      endAdornment: (
                        <Box
                          component="span"
                          sx={{
                            minWidth: 24,
                            height: 24,
                            px: 0.75,
                            display: "grid",
                            placeItems: "center",
                            borderRadius: 1,
                            border: `1px solid ${DOCS_BORDER}`,
                            color: STRIPE_SUBTLE_LIGHT,
                            ...STRIPE_TYPE.bodySmall,
                          }}
                        >
                          /
                        </Box>
                      ),
                    }}
                    sx={{
                      width: 1,
                      minWidth: 0,
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 2.5,
                        bgcolor: DOCS_SURFACE,
                        color: STRIPE_TEXT_LIGHT,
                        fontFamily: FONT_STACK_SANS,
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
                        py: 1.1,
                        ...STRIPE_TYPE.body,
                      },
                    }}
                  />
                  <Button
                    onClick={jumpToReference}
                    startIcon={<SparkleIcon sx={{ fontSize: 18 }} />}
                    sx={{
                      minWidth: 0,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      px: 1.6,
                      py: 1.05,
                      borderRadius: 2.5,
                      textTransform: "none",
                      border: `1px solid ${DOCS_BORDER_STRONG}`,
                      bgcolor: DOCS_SURFACE,
                      color: STRIPE_TEXT_LIGHT,
                      ...STRIPE_TYPE.label,
                    }}
                  >
                    {docsUi.askAi}
                  </Button>
                </Stack>

                <Stack direction="row" spacing={1} alignItems="center">
                  <Button
                    component={RouterLink}
                    to="/register"
                    sx={{
                      display: { xs: "none", md: "inline-flex" },
                      textTransform: "none",
                      color: "#635bff",
                      ...STRIPE_TYPE.label,
                    }}
                  >
                    {docsUi.createAccount}
                  </Button>
                  <Button
                    component={RouterLink}
                    to="/login"
                    variant="outlined"
                    sx={{
                      borderRadius: 2.5,
                      textTransform: "none",
                      borderColor: DOCS_BORDER_STRONG,
                      color: STRIPE_TEXT_LIGHT,
                      bgcolor: DOCS_SURFACE,
                      px: 1.7,
                      ...STRIPE_TYPE.label,
                    }}
                  >
                    {docsUi.signIn}
                  </Button>
                  <IconButton
                    aria-label={
                      isDark
                        ? docsUi.switchToLightTheme
                        : docsUi.switchToDarkTheme
                    }
                    onClick={toggleTheme}
                    sx={{
                      width: 40,
                      height: 40,
                      border: `1px solid ${DOCS_BORDER_STRONG}`,
                      color: STRIPE_TEXT_LIGHT,
                      bgcolor: DOCS_SURFACE,
                    }}
                  >
                    {isDark ? (
                      <LightModeIcon fontSize="small" />
                    ) : (
                      <DarkModeIcon fontSize="small" />
                    )}
                  </IconButton>
                </Stack>
              </Box>

              <Box
                sx={{
                  minHeight: 58,
                  display: "grid",
                  alignItems: "center",
                  gap: 2,
                  borderTop: `1px solid ${DOCS_BORDER}`,
                  gridTemplateColumns: {
                    xs: "1fr",
                    lg: "minmax(0,1fr) auto",
                  },
                }}
              >
                <Stack
                  direction="row"
                  spacing={{ xs: 1.5, lg: 2.6 }}
                  flexWrap="wrap"
                  useFlexGap
                >
                  {primaryNav.map((item) => (
                    <ButtonBase
                      key={item.label}
                      onClick={() => handlePrimaryNavClick(item)}
                      sx={{
                        justifyContent: "flex-start",
                        color:
                          item.sectionId && activeSection === item.sectionId
                            ? STRIPE_TEXT_LIGHT
                            : STRIPE_SUBTLE_LIGHT,
                        ...STRIPE_TYPE.label,
                      }}
                    >
                      {item.label}
                    </ButtonBase>
                  ))}
                </Stack>

                <Stack
                  direction="row"
                  spacing={2.2}
                  alignItems="center"
                  sx={{ display: { xs: "none", lg: "flex" } }}
                >
                  {secondaryNav.map((item) => (
                    <ButtonBase
                      key={item.label}
                      onClick={() => handleSecondaryNavClick(item)}
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 0.25,
                        color: STRIPE_TEXT_LIGHT,
                        ...STRIPE_TYPE.label,
                      }}
                    >
                      {item.label}
                      <ChevronDownIcon sx={{ fontSize: 18, color: STRIPE_SUBTLE_LIGHT }} />
                    </ButtonBase>
                  ))}
                </Stack>
              </Box>
            </Stack>
          </Container>
        </Box>

        <Box
          sx={{
            position: "relative",
            overflow: "hidden",
            borderBottom: `1px solid ${DOCS_BORDER}`,
            bgcolor: DOCS_SECTION_BG,
          }}
        >
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            <Box
              sx={{
                position: "absolute",
                left: { xs: -60, md: -80 },
                top: 0,
                width: { xs: "52%", md: "36%" },
                height: { xs: 320, md: 420 },
                opacity: isDark ? 0.2 : 0.75,
                backgroundImage:
                  "radial-gradient(circle, rgba(255,92,92,0.8) 1.25px, transparent 1.25px)",
                backgroundSize: "18px 18px",
              }}
            />
            <Box
              sx={{
                position: "absolute",
                left: { xs: "18%", md: "26%" },
                top: 0,
                width: { xs: "56%", md: "46%" },
                height: { xs: 340, md: 430 },
                opacity: isDark ? 0.18 : 0.55,
                backgroundImage:
                  "radial-gradient(circle, rgba(108,160,255,0.82) 1.25px, transparent 1.25px)",
                backgroundSize: "18px 18px",
              }}
            />
            <Box
              sx={{
                position: "absolute",
                right: { xs: -80, md: -60 },
                top: 0,
                width: { xs: "42%", md: "30%" },
                height: { xs: 280, md: 340 },
                opacity: isDark ? 0.22 : 0.7,
                backgroundImage:
                  "radial-gradient(circle, rgba(177,111,255,0.78) 1.25px, transparent 1.25px)",
                backgroundSize: "18px 18px",
              }}
            />
          </Box>
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
              <Stack spacing={{ xs: 4.5, md: 5.5 }}>
                <Box
                  sx={{
                    display: "grid",
                    gap: { xs: 3.5, lg: 5 },
                    gridTemplateColumns: {
                      xs: "1fr",
                      lg: "minmax(0, 1.2fr) minmax(300px, 0.8fr)",
                    },
                    alignItems: "center",
                  }}
                >
                  <Stack spacing={2.2} sx={{ maxWidth: 760 }}>
                    <Typography
                      variant="h1"
                      sx={{
                        ...STRIPE_TYPE.display,
                        fontSize: { xs: "2.6rem", md: "4rem" },
                        lineHeight: { xs: "2.9rem", md: "4.15rem" },
                        letterSpacing: "-0.055em",
                        color: STRIPE_TEXT_LIGHT,
                      }}
                    >
                      {docsUi.heroTitle}
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.bodyLarge,
                        fontSize: { xs: "1.25rem", md: "1.45rem" },
                        lineHeight: { xs: "1.9rem", md: "2.1rem" },
                        color: STRIPE_SUBTLE_LIGHT,
                        maxWidth: 720,
                      }}
                    >
                      {docsUi.heroSummary}
                    </Typography>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1.4}>
                      <Button
                        onClick={() => jumpToSection("auth")}
                        endIcon={<ArrowIcon />}
                        sx={{
                          alignSelf: "flex-start",
                          px: 2.1,
                          py: 1.15,
                          borderRadius: 2.5,
                          textTransform: "none",
                          bgcolor: "#635bff",
                          color: "#ffffff",
                          boxShadow: "none",
                          ...STRIPE_TYPE.cardTitle,
                          fontSize: "1.05rem",
                          "&:hover": {
                            bgcolor: "#574de8",
                            boxShadow: "none",
                          },
                        }}
                      >
                        {docsUi.heroPrimaryCta}
                      </Button>
                      <Button
                        onClick={jumpToReference}
                        sx={{
                          alignSelf: "flex-start",
                          px: 1.2,
                          py: 1.15,
                          textTransform: "none",
                          color: STRIPE_TEXT_LIGHT,
                          ...STRIPE_TYPE.cardTitle,
                          fontSize: "1.05rem",
                        }}
                      >
                        {docsUi.heroSecondaryCta}
                      </Button>
                    </Stack>
                  </Stack>

                  <Box
                    sx={{
                      position: "relative",
                      minHeight: { lg: 320 },
                    }}
                  >
                    <Box
                      sx={{
                        ml: { lg: "auto" },
                        width: { xs: "100%", lg: 382 },
                        borderRadius: 4,
                        border: `1px solid ${DOCS_BORDER_STRONG}`,
                        bgcolor: DOCS_SURFACE,
                        boxShadow: DOCS_SHADOW,
                        p: 2.2,
                      }}
                    >
                      <Stack spacing={1.8}>
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.overline,
                            color: STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          {docsUi.recentlyViewed}
                        </Typography>

                        <Stack spacing={0.35}>
                          {useCaseEntryPoints.slice(0, 2).map((item) => (
                            <ButtonBase
                              key={item.id}
                              onClick={() => jumpToSection(item.id)}
                              sx={{
                                justifyContent: "flex-start",
                                color: "#635bff",
                                ...STRIPE_TYPE.cardTitle,
                                fontSize: "1rem",
                              }}
                            >
                              {item.title}
                            </ButtonBase>
                          ))}
                        </Stack>

                        <Box
                          sx={{
                            borderTop: `1px solid ${DOCS_BORDER}`,
                            pt: 1.6,
                          }}
                        >
                          <Stack spacing={1.2}>
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              alignItems="center"
                            >
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.overline,
                                  color: STRIPE_SUBTLE_LIGHT,
                                }}
                              >
                                {docsUi.apiBase}
                              </Typography>
                              <Chip
                                label={
                                  runtimeBaseUrl.includes("localhost")
                                    ? docsUi.local
                                    : docsUi.configured
                                }
                                size="small"
                                sx={{
                                  borderRadius: 999,
                                  bgcolor: DOCS_ACTIVE_BG,
                                  color: DOCS_ACCENT_TEXT,
                                  fontWeight: 600,
                                }}
                              />
                            </Stack>
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              spacing={1}
                            >
                              <Typography sx={{ ...STRIPE_TYPE.body }}>
                                {docsUi.publicBaseUrl}
                              </Typography>
                              <Typography
                                component="code"
                                sx={{
                                  ...STRIPE_TYPE.mono,
                                  color: DOCS_CODE_TEXT,
                                  textAlign: "right",
                                  maxWidth: 180,
                                  wordBreak: "break-all",
                                }}
                              >
                                {runtimeBaseUrl}
                              </Typography>
                            </Stack>
                            <Stack
                              direction="row"
                              justifyContent="space-between"
                              spacing={1}
                            >
                              <Typography sx={{ ...STRIPE_TYPE.body }}>
                                {docsUi.referenceEndpoints}
                              </Typography>
                              <Typography sx={{ ...STRIPE_TYPE.body }}>
                                {endpointCount}
                              </Typography>
                            </Stack>
                          </Stack>
                        </Box>
                      </Stack>
                    </Box>

                    <Box
                      sx={{
                        display: { xs: "none", lg: "block" },
                        position: "absolute",
                        right: -8,
                        bottom: -22,
                        width: 254,
                        transform: "rotate(-5deg)",
                        borderRadius: 3,
                        border: `1px solid ${DOCS_BORDER_STRONG}`,
                        bgcolor: DOCS_SURFACE,
                        boxShadow: DOCS_SHADOW,
                        p: 1.6,
                      }}
                    >
                      <Stack spacing={1}>
                        <Box
                          sx={{
                            height: 22,
                            borderRadius: 1.5,
                            bgcolor: alpha("#0a2540", 0.18),
                          }}
                        />
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.label,
                            color: "#635bff",
                          }}
                        >
                          {activePlaygroundCase.label}
                        </Typography>
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.mono,
                            color: STRIPE_TEXT_LIGHT,
                          }}
                        >
                          {activePlaygroundCase.status}
                        </Typography>
                        <Typography
                          sx={{
                            ...STRIPE_TYPE.bodySmall,
                            color: STRIPE_SUBTLE_LIGHT,
                          }}
                        >
                          {docsUi.floatingCardSummary}
                        </Typography>
                      </Stack>
                    </Box>
                  </Box>
                </Box>

                <Box
                  sx={{
                    display: "grid",
                    gap: { xs: 3, md: 5 },
                    gridTemplateColumns: {
                      xs: "1fr",
                      md: "repeat(3, minmax(0, 1fr))",
                    },
                  }}
                >
                  {landingColumns.map((column) => (
                    <Stack key={column.title} spacing={1.3}>
                      <Typography
                        sx={{
                          ...STRIPE_TYPE.sectionTitle,
                          fontSize: "1.15rem",
                          lineHeight: "1.6rem",
                          color: STRIPE_TEXT_LIGHT,
                        }}
                      >
                        {column.title}
                      </Typography>
                      <Stack spacing={0.9}>
                        {column.links.map((item) => (
                          <ButtonBase
                            key={`${column.title}-${item.label}`}
                            onClick={() => handleLandingLinkClick(item)}
                            sx={{
                              justifyContent: "flex-start",
                              color: "#4f61e8",
                              ...STRIPE_TYPE.bodyLarge,
                            }}
                          >
                            {item.label}
                          </ButtonBase>
                        ))}
                      </Stack>
                    </Stack>
                  ))}
                </Box>

                <Box
                  sx={{
                    pt: { xs: 1, md: 2 },
                  }}
                >
                  <Stack spacing={2.2}>
                    <Stack spacing={0.45}>
                      <Typography
                        sx={{
                          ...STRIPE_TYPE.sectionTitle,
                          fontSize: "1.15rem",
                          lineHeight: "1.6rem",
                          color: STRIPE_TEXT_LIGHT,
                        }}
                      >
                        {docsUi.tryItOutTitle}
                      </Typography>
                      <Typography
                        sx={{
                          ...STRIPE_TYPE.body,
                          color: STRIPE_SUBTLE_LIGHT,
                        }}
                      >
                        {docsUi.tryItOutSummary}
                      </Typography>
                    </Stack>

                    <Box
                      sx={{
                        display: "grid",
                        gap: 2,
                        gridTemplateColumns: {
                          xs: "1fr",
                          lg: "320px minmax(0, 1fr)",
                        },
                        alignItems: "start",
                      }}
                    >
                      <Box
                        sx={{
                          borderRadius: 4,
                          border: `1px solid ${DOCS_BORDER}`,
                          bgcolor: DOCS_SURFACE,
                          boxShadow: DOCS_SHADOW,
                          overflow: "hidden",
                        }}
                      >
                        {landingPlaygroundCases.map((item, index) => (
                          <ButtonBase
                            key={item.id}
                            onClick={() => setActivePlaygroundCaseId(item.id)}
                            sx={{
                              width: "100%",
                              justifyContent: "flex-start",
                              textAlign: "left",
                              px: 2,
                              py: 1.65,
                              bgcolor:
                                activePlaygroundCase.id === item.id
                                  ? DOCS_SURFACE
                                  : DOCS_SURFACE_MUTED,
                              borderBottom:
                                index === landingPlaygroundCases.length - 1
                                  ? "none"
                                  : `1px solid ${DOCS_BORDER}`,
                            }}
                          >
                            <Stack spacing={0.45} sx={{ width: "100%" }}>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.cardTitle,
                                  fontSize: "1rem",
                                  lineHeight: "1.45rem",
                                  color:
                                    activePlaygroundCase.id === item.id
                                      ? "#4f61e8"
                                      : STRIPE_TEXT_LIGHT,
                                }}
                              >
                                {item.label}
                              </Typography>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.bodySmall,
                                  color: STRIPE_SUBTLE_LIGHT,
                                }}
                              >
                                {item.status}
                              </Typography>
                            </Stack>
                          </ButtonBase>
                        ))}
                      </Box>

                      <Box
                        sx={{
                          borderRadius: 4,
                          border: `1px solid ${DOCS_BORDER}`,
                          bgcolor: DOCS_SURFACE,
                          boxShadow: DOCS_SHADOW,
                          p: { xs: 2, md: 2.4 },
                        }}
                      >
                        <Stack spacing={2}>
                          <Stack
                            direction={{ xs: "column", md: "row" }}
                            spacing={1}
                            justifyContent="space-between"
                            alignItems={{ xs: "flex-start", md: "center" }}
                          >
                            <Stack spacing={0.45}>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.cardTitle,
                                  color: STRIPE_TEXT_LIGHT,
                                }}
                              >
                                {activePlaygroundCase.label}
                              </Typography>
                              <Typography
                                sx={{
                                  ...STRIPE_TYPE.body,
                                  color: STRIPE_SUBTLE_LIGHT,
                                  maxWidth: 680,
                                }}
                              >
                                {activePlaygroundCase.detail}
                              </Typography>
                            </Stack>
                            <Chip
                              label={activePlaygroundCase.status}
                              sx={{
                                borderRadius: 999,
                                bgcolor: DOCS_ACTIVE_BG,
                                color: DOCS_ACCENT_TEXT,
                                fontWeight: 600,
                              }}
                            />
                          </Stack>

                          <Box
                            sx={{
                              display: "grid",
                              gap: 1.4,
                              gridTemplateColumns: {
                                xs: "1fr",
                                xl: "minmax(0, 1.05fr) minmax(0, 0.95fr)",
                              },
                            }}
                          >
                            <CodePanel
                              label={docsUi.request}
                              code={activePlaygroundCase.request}
                              docsColors={docsColors}
                              uiText={docsUi}
                              copyId={`landing-${activePlaygroundCase.id}-request`}
                              copied={
                                copiedKey ===
                                `landing-${activePlaygroundCase.id}-request`
                              }
                              onCopy={copyCode}
                            />
                            <CodePanel
                              label={docsUi.representativeResponse}
                              code={activePlaygroundCase.response}
                              docsColors={docsColors}
                              uiText={docsUi}
                              copyId={`landing-${activePlaygroundCase.id}-response`}
                              copied={
                                copiedKey ===
                                `landing-${activePlaygroundCase.id}-response`
                              }
                              onCopy={copyCode}
                            />
                          </Box>
                        </Stack>
                      </Box>
                    </Box>
                  </Stack>
                </Box>
              </Stack>

              <Stack spacing={3.2} sx={{ display: "none" }}>
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
                        {clientHeaders.map((header) => (
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
          <Stack spacing={3.2} sx={{ py: { xs: 3.5, md: 4.5 } }}>
            <Box
              id="docs-reference"
              sx={{
                scrollMarginTop: { xs: 110, md: 170 },
                display: "grid",
                gap: 2.2,
              }}
            >
              <Stack spacing={0.7}>
                <Typography
                  sx={{
                    ...STRIPE_TYPE.overline,
                    color: STRIPE_SUBTLE_LIGHT,
                  }}
                >
                  {docsUi.apiReferenceOverline}
                </Typography>
                <Typography
                  sx={{
                    ...STRIPE_TYPE.sectionTitle,
                    fontSize: { xs: "2rem", md: "2.45rem" },
                    lineHeight: { xs: "2.5rem", md: "3rem" },
                    color: STRIPE_TEXT_LIGHT,
                  }}
                >
                  {docsUi.browseEndpointsTitle}
                </Typography>
                <Typography
                  sx={{
                    ...STRIPE_TYPE.bodyLarge,
                    color: STRIPE_SUBTLE_LIGHT,
                    maxWidth: 840,
                  }}
                >
                  {docsUi.browseEndpointsSummary}
                </Typography>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip
                  icon={<ApiIcon />}
                  label={docsUi.userApiDocs}
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
                  label={docsUi.referenceEndpointsChip(
                    filteredEndpointCount,
                    endpointCount,
                  )}
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
                  label={docsUi.restJson}
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
                  gap: 1.2,
                  gridTemplateColumns: {
                    xs: "1fr",
                    xl: "minmax(0, 1fr) auto",
                  },
                  alignItems: "center",
                }}
              >
                <TextField
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder={docsUi.referenceSearchPlaceholder}
                  fullWidth
                  InputProps={{
                    startAdornment: (
                      <SearchIcon
                        sx={{
                          mr: 1,
                          color: STRIPE_SUBTLE_LIGHT,
                          alignSelf: "center",
                        }}
                      />
                    ),
                  }}
                  sx={{
                    maxWidth: { xl: 720 },
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
                  {accessFilters.map((filter) => (
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
              </Box>
            </Box>

            <Box
            sx={{
              display: "grid",
              gap: { xs: 3, lg: 4 },
              gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0, 1fr)" },
            }}
          >
            <Box
              sx={{
                position: { lg: "sticky" },
                top: { lg: 156 },
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
                      {docsUi.collections}
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
                      {docsUi.visibleEndpointsSummary(filteredEndpointCount)}
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
                              {docsUi.endpointsCountLabel(
                                section.endpoints.length,
                              )}
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
                      {docsUi.support}
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.body,
                        color: STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      {docsUi.supportSummary}
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
                      {docsUi.noMatchingEndpoints}
                    </Typography>
                    <Typography
                      sx={{
                        ...STRIPE_TYPE.body,
                        color: STRIPE_SUBTLE_LIGHT,
                      }}
                    >
                      {docsUi.noMatchingEndpointsSummary}
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
                      scrollMarginTop: { xs: 112, md: 176 },
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
                            uiText={docsUi}
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
          </Stack>
        </Container>
      </Box>
    </>
  );
}

