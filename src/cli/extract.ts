// Core of the command-line feature extractor: CIF text in, records and tables out.
// No Node.js APIs here, so it can be unit-tested and reused.
import { parseCif } from "../lib/cif";
import { FEATURE_DEFS, FEATURE_BY_KEY, FeatureValue } from "../lib/features";
import { DEFAULT_GRID_RES, DEFAULT_HOP_CUTOFF, gridStage, hasMobile, prepareStructure, staticStage } from "../lib/pipeline";
import { Lattice, Vec3, add } from "../lib/structure";
import { featDesc, featLabel, fmtFeature, groupLabel } from "../i18n/domain";
import { tError, translate, type TFn } from "../i18n/translate";

/** Output is always English. */
export const tEn: TFn = (k, p) => translate("en", k, p);

export interface ExtractOptions {
  /** undefined = automatic (same rule as the app), null = no mobile ion */
  mobile?: string | null;
  /** oxidation states by site label or element symbol (labels win) */
  oxOverride?: Record<string, number>;
  hopCutoff?: number;
  /** BVSE / void grid spacing in Å; null skips the grid */
  grid?: number | null;
}

export interface HopRecord {
  from: string; // site group of the start position
  to: string;
  d: number; // hop distance (Å)
  rb: number; // bottleneck radius (Å)
  fromFrac: Vec3;
  toFrac: Vec3; // end point including the lattice translation (may lie outside [0,1))
  neckFrac: Vec3; // point of the bottleneck on the straight path
}

/** A stable site of the mobile ion on the BVSE landscape (only with the grid). */
export interface SiteRecord {
  kind: "site" | "interstitial"; // at a CIF mobile-ion position, or an empty candidate
  E: number; // eV above the grid minimum
  frac: Vec3;
  nearest: string; // closest CIF mobile-ion site group
  dNearest: number; // Å
  curvature: Vec3; // Hessian eigenvalues (eV/Å²), ascending
}

export interface StructureRecord {
  file: string;
  block: string;
  formula: string;
  mobile: string | null;
  oxGuessed: boolean;
  ox: Record<string, number>;
  values: Record<string, FeatureValue>;
  hops: HopRecord[];
  sites: SiteRecord[];
}

export interface ExtractError {
  file: string;
  block: string | null;
  message: string;
}

export interface ExtractResult {
  records: StructureRecord[];
  errors: ExtractError[];
}

const GRID_KEYS = FEATURE_DEFS.filter((d) => d.group === "grid").map((d) => d.key);

function toFrac(L: Lattice, c: Vec3): Vec3 {
  const m = L.inv;
  return [0, 1, 2].map((i) => m[i][0] * c[0] + m[i][1] * c[1] + m[i][2] * c[2]) as Vec3;
}

/** Extract features of every data block with atomic coordinates in one CIF file. */
export async function extractFromText(text: string, file: string, opts: ExtractOptions = {}): Promise<ExtractResult> {
  const out: ExtractResult = { records: [], errors: [] };
  let blocks;
  try {
    blocks = parseCif(text).filter((b) => b.loops.some((l) => l.tags.includes("_atom_site_fract_x")));
  } catch (e) {
    out.errors.push({ file, block: null, message: tError(tEn, e) });
    return out;
  }
  if (!blocks.length) {
    out.errors.push({ file, block: null, message: tEn("err.noAtomBlock") });
    return out;
  }
  const hopCutoff = opts.hopCutoff ?? DEFAULT_HOP_CUTOFF;
  const grid = opts.grid === undefined ? DEFAULT_GRID_RES : opts.grid;
  for (const block of blocks) {
    try {
      const s = prepareStructure(block, { oxOverride: opts.oxOverride, mobile: opts.mobile });
      const st = staticStage(s, hopCutoff);
      const values: Record<string, FeatureValue> = { ...st.values };
      for (const k of GRID_KEYS) values[k] ??= null;
      const sites: SiteRecord[] = [];
      if (grid !== null && hasMobile(s)) {
        const g = await gridStage(s, grid);
        if (g) Object.assign(values, g.values);
        for (const m of g?.minima ?? [])
          sites.push({ kind: m.occupied ? "site" : "interstitial", E: m.E, frac: m.frac, nearest: m.nearest?.group ?? "", dNearest: m.nearest?.d ?? NaN, curvature: m.curvature });
      }
      const L = s.crystal.lattice;
      const P = s.crystal.positions;
      const hops = st.hops
        .map((h) => ({
          from: P[h.a].group,
          to: P[h.b].group,
          d: h.d,
          rb: h.rb,
          fromFrac: P[h.a].frac,
          toFrac: add(P[h.b].frac, h.t),
          neckFrac: toFrac(L, h.mid),
        }))
        .sort((x, y) => x.d - y.d || x.rb - y.rb);
      out.records.push({ file, block: block.name, formula: s.formula, mobile: hasMobile(s) ? s.mobile : null, oxGuessed: s.oxGuessed, ox: s.ox, values, hops, sites });
    } catch (e) {
      out.errors.push({ file, block: block.name, message: tError(tEn, e) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting

/** 8 significant digits; avoids "-0" and exponent noise for ordinary values. */
export function num(v: number): string {
  if (!Number.isFinite(v)) return "";
  const r = +v.toPrecision(8);
  return String(Object.is(r, -0) ? 0 : r);
}

/** Fractional coordinate rounded to 1e-6 (removes floating-point dust such as 1e-32). */
export const coord = (x: number) => num(Math.round(x * 1e6) / 1e6);

/** Text value of a feature: numbers rounded, codes in English, missing values empty. */
export function cell(key: string, v: FeatureValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return num(v);
  const s = fmtFeature(tEn, FEATURE_BY_KEY[key], v);
  return s === "—" ? "" : s;
}

// The mobile ion itself is the "mobile" feature column.
export const ID_COLUMNS = ["file", "block", "formula", "ox_guessed"];
export const FEATURE_COLUMNS = [...ID_COLUMNS, ...FEATURE_DEFS.map((d) => d.key)];

export function featureRows(records: StructureRecord[]): string[][] {
  return [
    FEATURE_COLUMNS,
    ...records.map((r) => [r.file, r.block, r.formula, r.oxGuessed ? "1" : "0", ...FEATURE_DEFS.map((d) => cell(d.key, r.values[d.key]))]),
  ];
}

export const HOP_COLUMNS = ["file", "block", "mobile", "from", "to", "d", "rb", "from_x", "from_y", "from_z", "to_x", "to_y", "to_z", "neck_x", "neck_y", "neck_z"];

export function hopRows(records: StructureRecord[]): string[][] {
  const rows = [HOP_COLUMNS];
  for (const r of records)
    for (const h of r.hops) rows.push([r.file, r.block, r.mobile ?? "", h.from, h.to, num(h.d), num(h.rb), ...h.fromFrac.map(coord), ...h.toFrac.map(coord), ...h.neckFrac.map(coord)]);
  return rows;
}

export const SITE_COLUMNS = ["file", "block", "mobile", "kind", "E", "x", "y", "z", "nearest", "d_nearest", "curv_1", "curv_2", "curv_3"];

export function siteRows(records: StructureRecord[]): string[][] {
  const rows = [SITE_COLUMNS];
  for (const r of records)
    for (const s of r.sites) rows.push([r.file, r.block, r.mobile ?? "", s.kind, num(s.E), ...s.frac.map(coord), s.nearest, num(s.dNearest), ...s.curvature.map(num)]);
  return rows;
}

export function delimited(rows: string[][], sep: "," | "\t"): string {
  const esc =
    sep === ","
      ? (c: string) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)
      : (c: string) => c.replace(/[\t\r\n]+/g, " ");
  return rows.map((r) => r.map(esc).join(sep)).join("\n") + "\n";
}

export interface JsonSettings {
  version: string;
  mobile: string | null | undefined;
  hopCutoff: number;
  grid: number | null;
  hops: boolean;
  sites?: boolean;
}

const round = (v: number) => +num(v);
const roundVec = (v: Vec3) => v.map((x) => +coord(x));

export function toJson(result: ExtractResult, settings: JsonSettings): string {
  const doc = {
    tool: "crystal-site-matcher/csm-features",
    version: settings.version,
    settings: { mobile: settings.mobile === undefined ? "auto" : settings.mobile, hopCutoff: settings.hopCutoff, grid: settings.grid },
    units: Object.fromEntries(FEATURE_DEFS.filter((d) => d.unit).map((d) => [d.key, d.unit])),
    structures: result.records.map((r) => ({
      file: r.file,
      block: r.block,
      formula: r.formula,
      mobile: r.mobile,
      oxGuessed: r.oxGuessed,
      ox: r.ox,
      features: Object.fromEntries(
        FEATURE_DEFS.map((d) => {
          const v = r.values[d.key];
          return [d.key, v === undefined || v === null ? null : typeof v === "number" ? (Number.isFinite(v) ? round(v) : null) : cell(d.key, v) || null];
        }),
      ),
      ...(settings.hops && r.mobile ? { hops: r.hops.map((h) => ({ from: h.from, to: h.to, d: round(h.d), rb: round(h.rb), fromFrac: roundVec(h.fromFrac), toFrac: roundVec(h.toFrac), neckFrac: roundVec(h.neckFrac) })) } : {}),
      ...(settings.sites !== false && r.sites.length
        ? { sites: r.sites.map((s) => ({ kind: s.kind, E: round(s.E), frac: roundVec(s.frac), nearest: s.nearest, dNearest: round(s.dNearest), curvature: s.curvature.map(round) })) }
        : {}),
    })),
    errors: result.errors,
  };
  return JSON.stringify(doc, null, 2) + "\n";
}

/** Feature catalogue for --list-features. */
export function featureList(): string[][] {
  return [["key", "unit", "group", "name", "description"], ...FEATURE_DEFS.map((d) => [d.key, d.unit ?? "", groupLabel(tEn, d.group), featLabel(tEn, d.key), featDesc(tEn, d.key)])];
}
