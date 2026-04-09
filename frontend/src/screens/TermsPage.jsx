import LegalPageLayout from "../components/LegalPageLayout";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function TermsPage() {
  const { t } = useLanguage();
  const content = t("legal.terms");

  return (
    <LegalPageLayout
      title={content.title}
      description={content.description}
      path="/terms-of-service"
      eyebrow={content.eyebrow}
      updatedAt={content.updatedAt}
      highlights={content.highlights}
      sections={content.sections}
    />
  );
}
