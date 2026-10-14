// Pure translation core (no React): usable from the app and from the command-line tool.
// ja.ts is the reference; en.ts must define exactly the same keys (checked by the compiler).
import { ja } from "./ja";
import { en } from "./en";
import type { Msg } from "../lib/messages";

export type Lang = "ja" | "en";
export type MsgKey = keyof typeof ja;
export type Params = Record<string, string | number>;
export type TFn = (key: MsgKey, params?: Params) => string;

const DICTS: Record<Lang, Record<MsgKey, string>> = { ja, en };
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
