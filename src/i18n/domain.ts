// Translation helpers for domain objects (radius notes, polyhedron names, CShM wording).
import type { RadiusNote } from "../lib/analysis";
import { POLY_JA } from "../lib/data";
import type { FeatureDef, FeatureValue } from "../lib/features";
import type { Lang, MsgKey, TFn } from "./translate";

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

export const featLabel = (t: TFn, key: string) => t(`feat.${key}.label` as MsgKey);
export const featDesc = (t: TFn, key: string) => t(`feat.${key}.desc` as MsgKey);
export const groupLabel = (t: TFn, g: string) => t(`group.${g}` as MsgKey);

export function fmtFeature(t: TFn, def: FeatureDef | undefined, v: FeatureValue | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    if (def?.key === "system") return t(`system.${v}` as MsgKey);
    if (def?.key === "anionFrame") return v.endsWith("~") ? t("frame.near", { type: v.slice(0, -1) }) : t("frame.is", { type: v });
    return v;
  }
  if (!Number.isFinite(v)) return "—";
  const d = def?.digits ?? 3;
  return v.toFixed(d);
}
