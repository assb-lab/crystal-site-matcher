// Minimal i18n: typed dictionaries + t(key, params) + React context. No dependencies.
// ja.ts is the reference; en.ts must define exactly the same keys (checked by the compiler).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ja } from "./ja";
import { en } from "./en";
import { storage } from "../lib/storage";
import type { Msg } from "../lib/messages";

export type Lang = "ja" | "en";
export type MsgKey = keyof typeof ja;
export type Params = Record<string, string | number>;
export type TFn = (key: MsgKey, params?: Params) => string;

const DICTS: Record<Lang, Record<MsgKey, string>> = { ja, en };
const KEY = "csm.lang";

function interpolate(s: string, params?: Params) {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

export function translate(lang: Lang, key: MsgKey, params?: Params): string {
  return interpolate(DICTS[lang][key] ?? DICTS.ja[key] ?? key, params);
}

export const isMsgKey = (k: string): k is MsgKey => k in ja;

/** Translate a dynamic key (e.g. `feat.${key}.label`), falling back to the key itself. */
export function tKey(t: TFn, key: string, params?: Params): string {
  return isMsgKey(key) ? t(key, params) : key;
}

/** Translate a library message (errors / warnings). */
export function tMsg(t: TFn, m: Msg): string {
  return tKey(t, m.key, m.params);
}

/** Translate anything thrown: a MsgError carries a message key, other errors their text. */
export function tError(t: TFn, e: unknown): string {
  const m = (e as { msg?: Msg })?.msg;
  if (m) return tMsg(t, m);
  return e instanceof Error ? e.message : String(e);
}

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
