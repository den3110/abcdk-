import { Facebook, Mail, MapPin, Phone, Radio, Trophy } from "lucide-react";

import { useLanguage } from "../../context/LanguageContext.jsx";
import { A } from "../astryx/ui.jsx";
import SportBrand from "./SportBrand.jsx";

// [titleKey, [[labelKey, href], ...]] — keys resolved via t() at render time.
const groups = [
  ["v3.footer.groupCompete", [["v3.footer.tournaments", "/pickle-ball/tournaments"], ["v3.footer.rankings", "/pickle-ball/rankings"], ["v3.footer.live", "/live"], ["v3.footer.courts", "/courts"], ["v3.footer.coaches", "/coaches"]]],
  ["v3.footer.groupCommunity", [["v3.footer.feed", "/feed"], ["v3.footer.clubs", "/clubs"], ["v3.footer.findPartner", "/play"], ["v3.footer.marketplace", "/marketplace"], ["v3.footer.news", "/news"]]],
  ["v3.footer.groupSupport", [["v3.footer.contact", "/contact"], ["v3.footer.systemStatus", "/status"], ["v3.footer.apiDocs", "/docs/api"], ["v3.footer.privacy", "/privacy-and-policy"], ["v3.footer.terms", "/terms-of-service"]]],
];

export default function SportFooter() {
  const { t } = useLanguage();
  return (
    <footer className="v3-footer">
      <div className="v3-footer-inner">
        <div className="v3-footer-brand">
          <SportBrand />
          <p>{t("v3.footer.tagline")}</p>
          <div className="v3-footer-contact">
            <span><MapPin size={15} /> {t("v3.footer.location")}</span>
            <a href="tel:0932471990"><Phone size={15} /> 0932 471 990</a>
            <a href="mailto:support@pickletour.vn"><Mail size={15} /> support@pickletour.vn</a>
          </div>
        </div>
        {groups.map(([title, links]) => (
          <div className="v3-footer-group" key={title}>
            <h3>{t(title)}</h3>
            {links.map(([label, href]) => <A key={href} href={href}>{t(label)}</A>)}
          </div>
        ))}
      </div>
      <div className="v3-footer-bottom">
        <span>© {new Date().getFullYear()} PickleTour. More Than A Game.</span>
        <div>
          <a href="https://www.facebook.com/pickletour2025/" target="_blank" rel="noreferrer" aria-label="Facebook"><Facebook size={17} /></a>
          <a href="https://zalo.me/g/yarnhm129" target="_blank" rel="noreferrer" aria-label={t("v3.footer.zaloGroup")}><Radio size={17} /></a>
          <A href="/pickle-ball/tournaments" aria-label={t("v3.footer.tournaments")}><Trophy size={17} /></A>
        </div>
      </div>
    </footer>
  );
}
