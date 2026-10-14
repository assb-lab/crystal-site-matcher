// Minimal i18n: typed dictionaries + t(key, params) + React context. No dependencies.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { storage } from "../lib/storage";
import { translate, type Lang, type TFn } from "./translate";

export * from "./translate";

const KEY = "csm.lang";

function initialLang(): Lang {
  const s = storage.get(KEY);
  if (s === "ja" || s === "en") return s;
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("ja") ? "ja" : "en";
}

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: TFn;
}

const I18nCtx = createContext<Ctx>({ lang: "ja", setLang: () => undefined, t: (k, p) => translate("ja", k, p) });

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Lang }) {
  const [lang, setLang] = useState<Lang>(() => initial ?? initialLang());
  useEffect(() => {
    storage.set(KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);
  const t = useCallback<TFn>((k, p) => translate(lang, k, p), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, t]);
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
}

export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
