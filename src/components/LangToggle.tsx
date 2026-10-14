import { useI18n, type Lang } from "../i18n";

const LANGS: { value: Lang; label: string; name: string }[] = [
  { value: "ja", label: "日本語", name: "日本語" },
  { value: "en", label: "EN", name: "English" },
];

/** Language switch; each option is labelled in its own language. */
export default function LangToggle() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="theme-toggle lang-toggle" role="radiogroup" aria-label={t("lang.group")}>
      {LANGS.map((l) => (
        <button
          key={l.value}
          role="radio"
          aria-checked={lang === l.value}
          lang={l.value}
          title={l.name}
          className={lang === l.value ? "is-on" : ""}
          onClick={() => setLang(l.value)}
          id={`lang-${l.value}`}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
