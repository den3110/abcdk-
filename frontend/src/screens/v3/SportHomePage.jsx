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
const formatDate = (value) => {
  if (!value) return "Chưa cập nhật";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Chưa cập nhật";
  return date.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const statusLabel = (status) =>
  ({ ongoing: "Đang diễn ra", upcoming: "Sắp diễn ra", finished: "Đã kết thúc" })[status] || "Giải đấu";

const playerName = (item) =>
  firstText(item?.nickname, item?.user?.nickname, item?.fullName, item?.name, item?.user?.name, "Vận động viên");

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
  const id = tournament?._id || tournament?.id;
  const cover = imageUrl(firstText(tournament?.image, tournament?.coverUrl, tournament?.banner));
  return (
    <A href={`/tournament/${id}`} className="v3-tournament-card">
      <div className="v3-tournament-cover">
        {cover ? <img src={cover} alt="" /> : <div className="v3-cover-fallback"><Trophy size={42} /></div>}
        <span className={`v3-status v3-status-${tournament?.status || "upcoming"}`}>
          <i /> {statusLabel(tournament?.status)}
        </span>
      </div>
      <div className="v3-tournament-body">
        <h3>{firstText(tournament?.name, "Giải đấu PickleTour")}</h3>
        <div className="v3-tournament-meta">
          <span><CalendarDays size={16} /> {formatDate(tournament?.startDate || tournament?.startAt)}</span>
          <span><MapPin size={16} /> {firstText(tournament?.location, tournament?.venue?.name, tournament?.province, "Việt Nam")}</span>
        </div>
        <span className="v3-card-link">Xem giải đấu <ArrowRight size={16} /></span>
      </div>
    </A>
  );
}

function RankingPanel({ rankings, loading }) {
  const players = asArray(rankings).slice(0, 5);
  return (
    <div className="v3-ranking-panel">
      <div className="v3-panel-head">
        <div><span>TOP VẬN ĐỘNG VIÊN</span><h3>Bảng xếp hạng quốc gia</h3></div>
        <A href="/pickle-ball/rankings">Xem tất cả</A>
      </div>
      <div className="v3-ranking-list">
        {loading && !players.length
          ? [1, 2, 3, 4, 5].map((rank) => <div className="v3-ranking-skeleton" key={rank} />)
          : players.map((player, index) => {
              const avatar = imageUrl(firstText(player?.avatar, player?.user?.avatar));
              return (
                <A href={`/user/${player?.user?._id || player?._id}`} className="v3-ranking-row" key={player?._id || index}>
                  <strong className={`v3-rank v3-rank-${index + 1}`}>{index + 1}</strong>
                  <span className="v3-player-avatar">{avatar ? <img src={avatar} alt="" /> : playerName(player).slice(0, 1)}</span>
                  <span className="v3-player-copy"><b>{playerName(player)}</b><small>{firstText(player?.province, player?.user?.province, "Việt Nam")}</small></span>
                  <span className="v3-player-score"><small>ĐIỂM ĐÔI</small><b>{playerScore(player)}</b></span>
                </A>
              );
            })}
      </div>
    </div>
  );
}

function BroadcastPanel({ liveNow }) {
  return (
    <div className="v3-broadcast-panel">
      <div className="v3-broadcast-grid" aria-hidden="true" />
      <div className="v3-live-chip"><i /> LIVE CENTER</div>
      <div className="v3-scoreboard">
        <div className="v3-score-head"><span>CHUNG KẾT ĐÔI NAM</span><span>SÂN TRUNG TÂM</span></div>
        <div className="v3-score-row is-serving"><span>Minh / Phong</span><strong>11</strong></div>
        <div className="v3-score-row"><span>Hùng / Nam</span><strong>09</strong></div>
      </div>
      <div className="v3-live-count"><Radio size={18} /><b>{formatNumber(liveNow)}</b><span>trận đang phát trực tiếp</span></div>
      <A href="/live" className="v3-watch-link"><Play size={17} fill="currentColor" /> Mở trung tâm trực tiếp</A>
    </div>
  );
}

export default function SportHomePage() {
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
        title="PickleTour — Nền tảng thể thao pickleball Việt Nam"
        description="Thi đấu, xếp hạng, đặt sân và kết nối cộng đồng pickleball trên nền tảng PickleTour."
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
                    <span className="v3-kicker"><Sparkles size={15} /> NỀN TẢNG PICKLEBALL VIỆT NAM</span>
                    <h1>
                      Chơi hết mình.<br />
                      <span>Vươn tầm thứ hạng.</span>
                    </h1>
                    <p>Từ một trận giao lưu đến sân khấu giải đấu chuyên nghiệp — PickleTour kết nối toàn bộ hành trình của bạn.</p>
                    <div className="v3-hero-actions">
                      <SportButton href={user ? "/my-tournaments" : "/register"}>{user ? "Giải của tôi" : "Tham gia PickleTour"}<ArrowRight size={18} /></SportButton>
                      <SportButton href="/pickle-ball/tournaments" secondary><Trophy size={18} /> Khám phá giải đấu</SportButton>
                    </div>
                    <div className="v3-trust-row">
                      <span><CheckCircle2 size={16} /> Điểm trình minh bạch</span>
                      <span><CheckCircle2 size={16} /> Realtime toàn hệ thống</span>
                    </div>
                  </div>

                  <div className="v3-hero-visual">
                    <div className="v3-logo-stage">
                      <img src="/pickletour-v3-logo.png" alt="PickleTour" />
                      <span className="v3-hero-monogram" aria-hidden="true"><b>P</b><small>PICKLETOUR</small></span>
                    </div>
                    <div className="v3-floating-stat v3-floating-stat-left"><Target size={19} /><span><small>VẬN ĐỘNG VIÊN</small><b>{formatNumber(stats?.players)}</b></span></div>
                    <div className="v3-floating-stat v3-floating-stat-right"><Zap size={19} /><span><small>TRẬN ĐÃ ĐẤU</small><b>{formatNumber(stats?.matches)}</b></span></div>
                    <div className="v3-pickle-ball" aria-hidden="true">••<br />•••</div>
                  </div>
                </div>
              </section>

              <section className="v3-quick-section">
                <div className="v3-container v3-quick-grid">
                  {[
                    [Trophy, "Khám phá giải đấu", "Đăng ký và theo dõi lịch thi đấu", "/pickle-ball/tournaments"],
                    [Target, "Theo dõi thứ hạng", "Điểm trình cập nhật sau mỗi trận", "/pickle-ball/rankings"],
                    [Swords, "Tìm bạn đánh", "Kết nối người chơi phù hợp quanh bạn", "/play"],
                    [CalendarDays, "Đặt sân nhanh", "Tìm sân và chọn khung giờ trống", "/courts"],
                  ].map(([Icon, title, text, href]) => (
                    <A href={href} className="v3-quick-card" key={title}>
                      <span><Icon size={22} /></span><div><b>{title}</b><small>{text}</small></div><ArrowRight size={17} />
                    </A>
                  ))}
                </div>
              </section>

              <section className="v3-section">
                <div className="v3-container">
                  <SectionHeading eyebrow="GIẢI ĐẤU NỔI BẬT" title="Sân chơi đang nóng lên" description="Theo dõi những giải đấu mới nhất từ cộng đồng PickleTour trên toàn quốc." actionHref="/pickle-ball/tournaments" actionLabel="Tất cả giải đấu" />
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
                  <SectionHeading eyebrow="HỆ SINH THÁI PICKLETOUR" title="Mọi thứ bạn cần. Trong một nền tảng." description="Thi đấu, vận hành và kết nối được thiết kế liền mạch cho vận động viên lẫn ban tổ chức." />
                  <div className="v3-feature-grid">
                    {[
                      [ShieldCheck, "Xếp hạng minh bạch", "Điểm trình được chuẩn hoá từ kết quả thi đấu thật, dễ theo dõi và kiểm chứng."],
                      [Radio, "Live chuyên nghiệp", "Chấm điểm realtime, overlay phát sóng và màn hình hàng đợi sân."],
                      [UsersRound, "Cộng đồng mạnh", "Kết bạn, lập câu lạc bộ, tìm đối thủ và chia sẻ khoảnh khắc thi đấu."],
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
                  <div><span className="v3-eyebrow">MORE THAN A GAME</span><h2>Sẵn sàng bước vào sân?</h2><p>Tham gia cộng đồng pickleball đang phát triển mạnh nhất Việt Nam.</p></div>
                  <SportButton href={user ? "/my-tournaments" : "/register"}>{user ? "Mở giải của tôi" : "Tạo tài khoản miễn phí"}<ArrowRight size={18} /></SportButton>
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
