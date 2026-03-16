import LegalPageLayout from "../components/LegalPageLayout";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function CookiesPage() {
  const { t } = useLanguage();
  const content = t("legal.cookies");

  return (
    <LegalPageLayout
      title={content.title}
      description={content.description}
      path="/cookies"
      eyebrow={content.eyebrow}
      updatedAt={content.updatedAt}
      highlights={content.highlights}
      sections={content.sections}
    />
  );
}
