/* eslint-disable react-refresh/only-export-components */
import PropTypes from "prop-types";
import { alpha, Box } from "@mui/material";
import {
  AdminPanelSettingsRounded,
  AutoAwesomeRounded,
  CalendarMonthRounded,
  CalculateRounded,
  ContentCopyRounded,
  DarkModeRounded,
  EmojiEventsRounded,
  Groups2Rounded,
  HomeRounded,
  LanguageRounded,
  LeaderboardRounded,
  LightModeRounded,
  LoginRounded,
  LogoutRounded,
  NewspaperRounded,
  OpenInNewRounded,
  PersonRounded,
  PushPinRounded,
  RefreshRounded,
  SearchRounded,
  SportsScoreRounded,
  StadiumRounded,
  TravelExploreRounded,
} from "@mui/icons-material";

export const metaRowShape = PropTypes.shape({
  label: PropTypes.string,
  value: PropTypes.string,
});

export const paletteItemShape = PropTypes.shape({
  id: PropTypes.string,
  scope: PropTypes.string,
  title: PropTypes.string,
  subtitle: PropTypes.string,
  description: PropTypes.string,
  path: PropTypes.string,
  iconKey: PropTypes.string,
  color: PropTypes.string,
  isContextual: PropTypes.bool,
  isRecent: PropTypes.bool,
  isPinned: PropTypes.bool,
  isSuggested: PropTypes.bool,
  isAiPrimary: PropTypes.bool,
  aiReason: PropTypes.string,
  persistPin: PropTypes.bool,
  metaRows: PropTypes.arrayOf(metaRowShape),
});

const ICON_MAP = {
  admin: AdminPanelSettingsRounded,
  action: AutoAwesomeRounded,
  club: Groups2Rounded,
  copy: ContentCopyRounded,
  calculator: CalculateRounded,
  home: HomeRounded,
  language: LanguageRounded,
  leaderboard: LeaderboardRounded,
  login: LoginRounded,
  logout: LogoutRounded,
  news: NewspaperRounded,
  openExternal: OpenInNewRounded,
  page: TravelExploreRounded,
  pin: PushPinRounded,
  player: PersonRounded,
  refresh: RefreshRounded,
  search: SearchRounded,
  stadium: StadiumRounded,
  status: SportsScoreRounded,
  theme: DarkModeRounded,
  themeLight: LightModeRounded,
  tournament: EmojiEventsRounded,
  tournamentSchedule: CalendarMonthRounded,
};

export function resolvePaletteIcon(iconKey) {
  return ICON_MAP[iconKey] || TravelExploreRounded;
}

export function PaletteIconBadge({ iconKey, color }) {
  const IconComponent = resolvePaletteIcon(iconKey);

  return (
    <Box
      sx={{
        width: 36,
        height: 36,
        borderRadius: 2.5,
        display: "grid",
        placeItems: "center",
        bgcolor: alpha(color, 0.14),
        color,
        flexShrink: 0,
      }}
    >
      <IconComponent fontSize="small" />
    </Box>
  );
}

PaletteIconBadge.propTypes = {
  iconKey: PropTypes.string,
  color: PropTypes.string,
};
