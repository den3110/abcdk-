/* eslint-disable react/prop-types */
import "@fontsource-variable/montserrat";

import { useSelector } from "react-redux";
import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Play,
  Radio,
  ShieldCheck,
  Sparkles,
  Swords,
  Target,
  Trophy,
  UsersRound,
  Zap,
} from "lucide-react";

import SEOHead from "../../components/SEOHead.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useGetHomeSummaryQuery, useGetHomePulseQuery } from "../../slices/homeApiSlice.js";
import { useListTournamentsQuery } from "../../slices/tournamentsApiSlice.js";
import { useGetRankingsListQuery } from "../../slices/rankingsApiSlice.js";
import ShadowFrame from "../astryx/ShadowFrame.jsx";
import { A } from "../astryx/ui.jsx";
import SportFooter from "./SportFooter.jsx";
import SportNav from "./SportNav.jsx";

const asArray = (data) =>
  Array.isArray(data)
    ? data
    : data?.docs || data?.items || data?.list || data?.rows || data?.data || [];

const firstText = (...values) =>
  values.map((value) => String(value ?? "").trim()).find(Boolean) || "";

const imageUrl = (value) => {
  const src = String(value || "").trim();
  if (!src) return "";
  if (/^(https?:)?\/\//i.test(src) || src.startsWith("data:")) return src;
  return src.startsWith("/") ? src : `/${src}`;
};

const formatNumber = (value) => Number(value || 0).toLocaleString("vi-VN");
const formatDate = (value, t) => {
  if (!value) return t("v3.home.notUpdated");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("v3.home.notUpdated");
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const statusLabel = (status, t) =>
  ({
    ongoing: t("v3.home.statusOngoing"),
    upcoming: t("v3.home.statusUpcoming"),
    finished: t("v3.home.statusFinished"),
  })[status] || t("v3.home.statusDefault");

const playerName = (item, t) =>
  firstText(item?.nickname, item?.user?.nickname, item?.fullName, item?.name, item?.user?.name, t("v3.home.playerFallback"));

const playerScore = (item) => {
  const value = Number(item?.double ?? item?.scoreDouble ?? item?.points ?? item?.single ?? 0);
  return value > 0 ? value.toFixed(3) : "—";
};

function SportButton({ href, children, secondary = false }) {
  return (
    <A href={href} className={secondary ? "v3-button v3-button-secondary" : "v3-button"}>
      {children}
    </A>
  );
}

function SectionHeading({ eyebrow, title, description, actionHref, actionLabel }) {
  return (
    <div className="v3-section-heading">
      <div>
        <span className="v3-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actionHref ? <A href={actionHref} className="v3-text-link">{actionLabel}<ArrowRight size={17} /></A> : null}
    </div>
  );
}

function TournamentCard({ tournament }) {
  const { t } = useLanguage();
  const id = tournament?._id || tournament?.id;
  const cover = imageUrl(firstText(tournament?.image, tournament?.coverUrl, tournament?.banner));
  return (
    <A href={`/tournament/${id}`} className="v3-tournament-card">
      <div className="v3-tournament-cover">
        {cover ? <img src={cover} alt="" /> : <div className="v3-cover-fallback"><Trophy size={42} /></div>}
        <span className={`v3-status v3-status-${tournament?.status || "upcoming"}`}>
          <i /> {statusLabel(tournament?.status, t)}
        </span>
      </div>
      <div className="v3-tournament-body">
        <h3>{firstText(tournament?.name, t("v3.home.tournamentNameFallback"))}</h3>
        <div className="v3-tournament-meta">
          <span><CalendarDays size={16} /> {formatDate(tournament?.startDate || tournament?.startAt, t)}</span>
          <span><MapPin size={16} /> {firstText(tournament?.location, tournament?.venue?.name, tournament?.province, t("v3.home.countryFallback"))}</span>
        </div>
        <span className="v3-card-link">{t("v3.home.viewTournament")} <ArrowRight size={16} /></span>
      </div>
    </A>
  );
}

function RankingPanel({ rankings, loading }) {
  const { t } = useLanguage();
  const players = asArray(rankings).slice(0, 5);
  return (
    <div className="v3-ranking-panel">
      <div className="v3-panel-head">
        <div><span>{t("v3.home.topPlayers")}</span><h3>{t("v3.home.nationalRankings")}</h3></div>
        <A href="/pickle-ball/rankings">{t("v3.home.viewAll")}</A>
      </div>
      <div className="v3-ranking-list">
        {loading && !players.length
          ? [1, 2, 3, 4, 5].map((rank) => <div className="v3-ranking-skeleton" key={rank} />)
          : players.map((player, index) => {
              const avatar = imageUrl(firstText(player?.avatar, player?.user?.avatar));
              return (
                <A href={`/user/${player?.user?._id || player?._id}`} className="v3-ranking-row" key={player?._id || index}>
                  <strong className={`v3-rank v3-rank-${index + 1}`}>{index + 1}</strong>
                  <span className="v3-player-avatar">{avatar ? <img src={avatar} alt="" /> : playerName(player, t).slice(0, 1)}</span>
                  <span className="v3-player-copy"><b>{playerName(player, t)}</b><small>{firstText(player?.province, player?.user?.province, t("v3.home.countryFallback"))}</small></span>
                  <span className="v3-player-score"><small>{t("v3.home.doublesScore")}</small><b>{playerScore(player)}</b></span>
                </A>
              );
            })}
      </div>
    </div>
  );
}

function BroadcastPanel({ liveNow }) {
  const { t } = useLanguage();
  return (
    <div className="v3-broadcast-panel">
      <div className="v3-broadcast-grid" aria-hidden="true" />
      <div className="v3-live-chip"><i /> LIVE CENTER</div>
      <div className="v3-scoreboard">
        <div className="v3-score-head"><span>{t("v3.home.scoreboardTitle")}</span><span>{t("v3.home.scoreboardCourt")}</span></div>
        <div className="v3-score-row is-serving"><span>{t("v3.home.scoreboardTeamServe")}</span><strong>11</strong></div>
        <div className="v3-score-row"><span>{t("v3.home.scoreboardTeamB")}</span><strong>09</strong></div>
      </div>
      <div className="v3-live-count"><Radio size={18} /><b>{formatNumber(liveNow)}</b><span>{t("v3.home.liveMatches")}</span></div>
      <A href="/live" className="v3-watch-link"><Play size={17} fill="currentColor" /> {t("v3.home.openLiveCenter")}</A>
    </div>
  );
}

export default function SportHomePage() {
  const { t } = useLanguage();
  const user = useSelector((state) => state.auth?.userInfo || null);
  const { data: summary } = useGetHomeSummaryQuery({ clubsLimit: 6 });
  const { data: pulse } = useGetHomePulseQuery();
  const { data: tournaments, isLoading: tournamentsLoading } = useListTournamentsQuery({ limit: 12, sort: "-startDate" });
  const { data: rankings, isLoading: rankingsLoading } = useGetRankingsListQuery({ limit: 5 });
  const tournamentItems = asArray(tournaments).filter((item) => !item?.isTest).slice(0, 3);
  const stats = summary?.stats || {};

  return (
    <>
      <SEOHead
        title={t("v3.home.seoTitle")}
        description={t("v3.home.seoDescription")}
      />
      <ShadowFrame style={{ minHeight: "100vh" }}>
        <Theme theme={neutralTheme}>
          <div className="v3-page">
            <SportNav />

            <main>
              <section className="v3-hero">
                <div className="v3-hero-court" aria-hidden="true" />
                <div className="v3-hero-orb v3-hero-orb-one" aria-hidden="true" />
                <div className="v3-hero-orb v3-hero-orb-two" aria-hidden="true" />
                <div className="v3-container v3-hero-grid">
                  <div className="v3-hero-copy">
                    <span className="v3-kicker"><Sparkles size={15} /> {t("v3.home.heroKicker")}</span>
                    <h1>
                      {t("v3.home.heroTitleLine1")}<br />
                      <span>{t("v3.home.heroTitleLine2")}</span>
                    </h1>
                    <p>{t("v3.home.heroSubtitle")}</p>
                    <div className="v3-hero-actions">
                      <SportButton href={user ? "/my-tournaments" : "/register"}>{user ? t("v3.home.heroCtaMember") : t("v3.home.heroCtaGuest")}<ArrowRight size={18} /></SportButton>
                      <SportButton href="/pickle-ball/tournaments" secondary><Trophy size={18} /> {t("v3.home.exploreTournaments")}</SportButton>
                    </div>
                    <div className="v3-trust-row">
                      <span><CheckCircle2 size={16} /> {t("v3.home.trustTransparent")}</span>
                      <span><CheckCircle2 size={16} /> {t("v3.home.trustRealtime")}</span>
                    </div>
                  </div>

                  <div className="v3-hero-visual">
                    <div className="v3-logo-stage">
                      <img src="/pickletour-v3-logo.png" alt="PickleTour" />
                      <span className="v3-hero-monogram" aria-hidden="true"><b>P</b><small>PICKLETOUR</small></span>
                    </div>
                    <div className="v3-floating-stat v3-floating-stat-left"><Target size={19} /><span><small>{t("v3.home.statPlayers")}</small><b>{formatNumber(stats?.players)}</b></span></div>
                    <div className="v3-floating-stat v3-floating-stat-right"><Zap size={19} /><span><small>{t("v3.home.statMatches")}</small><b>{formatNumber(stats?.matches)}</b></span></div>
                    <div className="v3-pickle-ball" aria-hidden="true">••<br />•••</div>
                  </div>
                </div>
              </section>

              <section className="v3-quick-section">
                <div className="v3-container v3-quick-grid">
                  {[
                    [Trophy, t("v3.home.quick1Title"), t("v3.home.quick1Text"), "/pickle-ball/tournaments"],
                    [Target, t("v3.home.quick2Title"), t("v3.home.quick2Text"), "/pickle-ball/rankings"],
                    [Swords, t("v3.home.quick3Title"), t("v3.home.quick3Text"), "/play"],
                    [CalendarDays, t("v3.home.quick4Title"), t("v3.home.quick4Text"), "/courts"],
                  ].map(([Icon, title, text, href]) => (
                    <A href={href} className="v3-quick-card" key={href}>
                      <span><Icon size={22} /></span><div><b>{title}</b><small>{text}</small></div><ArrowRight size={17} />
                    </A>
                  ))}
                </div>
              </section>

              <section className="v3-section">
                <div className="v3-container">
                  <SectionHeading eyebrow={t("v3.home.featTournEyebrow")} title={t("v3.home.featTournTitle")} description={t("v3.home.featTournDesc")} actionHref="/pickle-ball/tournaments" actionLabel={t("v3.home.featTournAction")} />
                  <div className="v3-tournament-grid">
                    {tournamentsLoading && !tournamentItems.length
                      ? [1, 2, 3].map((item) => <div className="v3-card-skeleton" key={item} />)
                      : tournamentItems.map((tournament) => <TournamentCard key={tournament?._id || tournament?.id} tournament={tournament} />)}
                  </div>
                </div>
              </section>

              <section className="v3-section v3-section-deep">
                <div className="v3-container v3-data-grid">
                  <RankingPanel rankings={rankings} loading={rankingsLoading} />
                  <BroadcastPanel liveNow={pulse?.liveNow || 0} />
                </div>
              </section>

              <section className="v3-section">
                <div className="v3-container">
                  <SectionHeading eyebrow={t("v3.home.ecoEyebrow")} title={t("v3.home.ecoTitle")} description={t("v3.home.ecoDesc")} />
                  <div className="v3-feature-grid">
                    {[
                      [ShieldCheck, t("v3.home.feat1Title"), t("v3.home.feat1Text")],
                      [Radio, t("v3.home.feat2Title"), t("v3.home.feat2Text")],
                      [UsersRound, t("v3.home.feat3Title"), t("v3.home.feat3Text")],
                    ].map(([Icon, title, text], index) => (
                      <article className={`v3-feature-card v3-feature-${index + 1}`} key={title}>
                        <span><Icon size={26} /></span><h3>{title}</h3><p>{text}</p>
                      </article>
                    ))}
                  </div>
                </div>
              </section>

              <section className="v3-cta-section">
                <div className="v3-container v3-cta-card">
                  <div><span className="v3-eyebrow">MORE THAN A GAME</span><h2>{t("v3.home.ctaTitle")}</h2><p>{t("v3.home.ctaText")}</p></div>
                  <SportButton href={user ? "/my-tournaments" : "/register"}>{user ? t("v3.home.ctaMember") : t("v3.home.ctaGuest")}<ArrowRight size={18} /></SportButton>
                </div>
              </section>
            </main>

            <SportFooter />
          </div>
        </Theme>
      </ShadowFrame>
    </>
  );
}
