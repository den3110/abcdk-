import { Facebook, Mail, MapPin, Phone, Radio, Trophy } from "lucide-react";

import { A } from "../astryx/ui.jsx";
import SportBrand from "./SportBrand.jsx";

const groups = [
  ["Thi đấu", [["Giải đấu", "/pickle-ball/tournaments"], ["Bảng xếp hạng", "/pickle-ball/rankings"], ["Trực tiếp", "/live"], ["Đặt sân", "/courts"]]],
  ["Cộng đồng", [["Bảng tin", "/feed"], ["Câu lạc bộ", "/clubs"], ["Tìm bạn đánh", "/play"], ["Chợ PickleTour", "/marketplace"]]],
  ["Hỗ trợ", [["Liên hệ", "/contact"], ["Trạng thái hệ thống", "/status"], ["Chính sách", "/privacy-and-policy"], ["Điều khoản", "/terms-of-service"]]],
];

export default function SportFooter() {
  return (
    <footer className="v3-footer">
      <div className="v3-footer-inner">
        <div className="v3-footer-brand">
          <SportBrand />
          <p>Nền tảng giải đấu, chấm điểm và kết nối cộng đồng pickleball Việt Nam.</p>
          <div className="v3-footer-contact">
            <span><MapPin size={15} /> Nam Định, Việt Nam</span>
            <a href="tel:0932471990"><Phone size={15} /> 0932 471 990</a>
            <a href="mailto:support@pickletour.vn"><Mail size={15} /> support@pickletour.vn</a>
          </div>
        </div>
        {groups.map(([title, links]) => (
          <div className="v3-footer-group" key={title}>
            <h3>{title}</h3>
            {links.map(([label, href]) => <A key={href} href={href}>{label}</A>)}
          </div>
        ))}
      </div>
      <div className="v3-footer-bottom">
        <span>© {new Date().getFullYear()} PickleTour. More Than A Game.</span>
        <div>
          <a href="https://www.facebook.com/pickletour2025/" target="_blank" rel="noreferrer" aria-label="Facebook"><Facebook size={17} /></a>
          <a href="https://zalo.me/g/yarnhm129" target="_blank" rel="noreferrer" aria-label="Nhóm Zalo"><Radio size={17} /></a>
          <A href="/pickle-ball/tournaments" aria-label="Giải đấu"><Trophy size={17} /></A>
        </div>
      </div>
    </footer>
  );
}
