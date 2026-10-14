// Translation helpers for domain objects (radius notes, polyhedron names, CShM wording).
import type { RadiusNote } from "../lib/analysis";
import { POLY_JA } from "../lib/data";
import type { Lang, TFn } from "./index";

/** How a non-tabulated Shannon radius was obtained. */
export function radiusNote(t: TFn, n: RadiusNote): string {
  const [a, b] = n.cnFrom;
  return t(`radius.${n.method}`, { a: a ?? "", b: b ?? "" });
}

export const radiusNotes = (t: TFn, ns: RadiusNote[]) => ns.map((n) => radiusNote(t, n)).join(", ");

/** Polyhedron name: Japanese common name when available, otherwise the ideal-shape name. */
export function shapeName(lang: Lang, sym: string | undefined, en: string | undefined) {
  if (!sym) return "—";
  return (lang === "ja" ? POLY_JA[sym] : undefined) ?? en ?? sym;
}

export function cshmWord(t: TFn, s: number) {
  if (s < 0.5) return t("cshm.ideal");
  if (s < 1.5) return t("cshm.slight");
  if (s < 3) return t("cshm.distorted");
  if (s < 6) return t("cshm.strong");
  return t("cshm.none");
}
