import LegalPageLayout from "../components/LegalPageLayout";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function PrivacyPage() {
  const { t } = useLanguage();
  const content = t("legal.privacy");

  return (
    <LegalPageLayout
      title={content.title}
      description={content.description}
      path="/privacy"
      eyebrow={content.eyebrow}
      updatedAt={content.updatedAt}
      highlights={content.highlights}
      sections={content.sections}
    />
  );
}
