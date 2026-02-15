// src/components/SEOHead.jsx
import { Helmet } from "react-helmet-async";

const SITE_NAME = "Pickletour.vn";
const DEFAULT_DESCRIPTION =
  "Nền tảng quản lý giải đấu Pickleball hàng đầu Việt Nam. Đăng ký giải đấu, theo dõi bảng xếp hạng, xem trực tiếp và kết nối cộng đồng thể thao.";
const DEFAULT_IMAGE = "https://pickletour.vn/icon.png";
const BASE_URL = "https://pickletour.vn";
const DEFAULT_KEYWORDS =
  "pickleball, giải đấu pickleball, bảng xếp hạng pickleball, pickletour, thể thao, quản lý giải đấu, pickleball việt nam, đăng ký giải đấu, điểm trình pickleball";

/**
 * SEOHead - Component quản lý <head> meta tags cho từng trang.
 *
 * @param {string} title       - Tiêu đề trang (sẽ append " | Pickletour.vn")
 * @param {string} description - Mô tả trang (meta description, og:description)
 * @param {string} keywords    - Từ khóa bổ sung (nối thêm vào default)
 * @param {string} ogImage     - URL ảnh Open Graph
 * @param {string} ogType      - Loại OG (default: "website")
 * @param {string} canonicalUrl- URL canonical (nếu khác current)
 * @param {string} path        - Đường dẫn trang (dùng tạo canonical nếu không có canonicalUrl)
 * @param {object} structuredData - JSON-LD object
 * @param {boolean} noIndex    - true nếu trang không muốn bị index
 */
export default function SEOHead({
  title,
  description,
  keywords,
  ogImage,
  ogType = "website",
  canonicalUrl,
  path,
  structuredData,
  noIndex = false,
}) {
  const fullTitle = title ? `${title} | ${SITE_NAME}` : `${SITE_NAME} - Kết nối cộng đồng & quản lý giải đấu`;
  const desc = description || DEFAULT_DESCRIPTION;
  const image = ogImage || DEFAULT_IMAGE;
  const canonical = canonicalUrl || (path ? `${BASE_URL}${path}` : undefined);
  const allKeywords = keywords
    ? `${keywords}, ${DEFAULT_KEYWORDS}`
    : DEFAULT_KEYWORDS;

  return (
    <Helmet>
      {/* ===== Basic ===== */}
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <meta name="keywords" content={allKeywords} />
      {noIndex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1" />
      )}
      {canonical && <link rel="canonical" href={canonical} />}

      {/* ===== Open Graph ===== */}
      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:image" content={image} />
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content="vi_VN" />
      {canonical && <meta property="og:url" content={canonical} />}

      {/* ===== Twitter Card ===== */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={image} />

      {/* ===== Structured Data (JSON-LD) ===== */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
}
