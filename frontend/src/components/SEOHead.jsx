import { Helmet } from "react-helmet-async";
import PropTypes from "prop-types";

import { useLanguage } from "../context/LanguageContext.jsx";

const SITE_NAME = "Pickletour.vn";
const DEFAULT_IMAGE = "https://pickletour.vn/icon-512.png";
const BASE_URL = "https://pickletour.vn";

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
  const { t, ogLocale } = useLanguage();

  const fullTitle = title
    ? `${title} | ${SITE_NAME}`
    : t("seo.defaultTitle", {}, SITE_NAME);
  const desc = description || t("seo.defaultDescription");
  const image = ogImage || DEFAULT_IMAGE;
  const canonical = canonicalUrl || (path ? `${BASE_URL}${path}` : undefined);
  const defaultKeywords = t("seo.defaultKeywords");
  const allKeywords = keywords ? `${keywords}, ${defaultKeywords}` : defaultKeywords;

  return (
    <Helmet>
      <title>{fullTitle}</title>
      <meta name="description" content={desc} />
      <meta name="keywords" content={allKeywords} />
      {noIndex ? (
        <meta name="robots" content="noindex, nofollow" />
      ) : (
        <meta
          name="robots"
          content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1"
        />
      )}
      {canonical ? <link rel="canonical" href={canonical} /> : null}

      <meta property="og:title" content={fullTitle} />
      <meta property="og:description" content={desc} />
      <meta property="og:image" content={image} />
      <meta property="og:type" content={ogType} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:locale" content={ogLocale} />
      {canonical ? <meta property="og:url" content={canonical} /> : null}

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={fullTitle} />
      <meta name="twitter:description" content={desc} />
      <meta name="twitter:image" content={image} />

      {structuredData ? (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      ) : null}

      {/* hreflang for multi-language SEO */}
      {canonical ? (
        <>
          <link rel="alternate" hrefLang="vi" href={canonical} />
          <link rel="alternate" hrefLang="en" href={canonical} />
          <link rel="alternate" hrefLang="x-default" href={canonical} />
        </>
      ) : null}
    </Helmet>
  );
}

SEOHead.propTypes = {
  title: PropTypes.string,
  description: PropTypes.string,
  keywords: PropTypes.string,
  ogImage: PropTypes.string,
  ogType: PropTypes.string,
  canonicalUrl: PropTypes.string,
  path: PropTypes.string,
  structuredData: PropTypes.oneOfType([PropTypes.object, PropTypes.array]),
  noIndex: PropTypes.bool,
};
