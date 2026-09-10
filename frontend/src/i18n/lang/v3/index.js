// v3 sport-theme i18n — gộp các fragment theo khu vực.
// Mỗi fragment export { vi, en }; mỗi khu vực được edit độc lập (tránh xung đột khi
// nhiều tác vụ song song cùng dịch v3). Dùng qua key "v3.<area>.<key>".
import nav from "./nav.js";
import footer from "./footer.js";
import home from "./home.js";
import auth from "./auth.js";
import rankings from "./rankings.js";
import tournaments from "./tournaments.js";
import tournamentDetail from "./tournamentDetail.js";
import clubs from "./clubs.js";
import clubDetail from "./clubDetail.js";
import contact from "./contact.js";
import live from "./live.js";
import myTournaments from "./myTournaments.js";
import profile from "./profile.js";
import support from "./support.js";
import siteNav from "./siteNav.js";
import siteFooter from "./siteFooter.js";

const areas = {
  nav,
  footer,
  home,
  auth,
  rankings,
  tournaments,
  tournamentDetail,
  clubs,
  clubDetail,
  contact,
  live,
  myTournaments,
  profile,
  support,
  siteNav,
  siteFooter,
};

const pick = (lang) =>
  Object.fromEntries(
    Object.entries(areas).map(([key, mod]) => [key, (mod && mod[lang]) || {}]),
  );

export default {
  vi: pick("vi"),
  en: pick("en"),
};
