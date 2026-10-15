// Descriptors of the anion environment, of how site properties are spread over the sites of a
// sublattice, and of mixed-occupancy sites. CIF-only (bond table, oxidation states, Shannon radii).
// Every quantity is evaluated once per site group (symmetry-equivalent positions share it) and
// weighted by multiplicity × occupancy of the species in question.

import type { BondTable } from "./bonding";
import { analyzeSite, type SiteAnalysis } from "./analysis";
import type { Crystal, Neighbor } from "./structure";

type Value = number | null;

/** Weighted mean / population standard deviation / extremes; nulls when there is nothing to average. */
export function wstats(items: { v: number | null; w: number }[]) {
  const xs = items.filter((x): x is { v: number; w: number } => x.v !== null && Number.isFinite(x.v) && x.w > 0);
  const W = xs.reduce((s, x) => s + x.w, 0);
  if (!xs.length || W <= 0) return { mean: null, sd: null, min: null, max: null } as const;
  const mean = xs.reduce((s, x) => s + x.w * x.v, 0) / W;
  const sd = Math.sqrt(xs.reduce((s, x) => s + x.w * (x.v - mean) ** 2, 0) / W);
  return { mean, sd, min: Math.min(...xs.map((x) => x.v)), max: Math.max(...xs.map((x) => x.v)) };
}

/** Weighted fraction of the items for which `test` holds. */
function wfrac<T>(items: { x: T; w: number }[], test: (x: T) => boolean): Value {
  const W = items.reduce((s, i) => s + i.w, 0);
  return W > 0 ? items.filter((i) => test(i.x)).reduce((s, i) => s + i.w, 0) / W : null;
}

/** Shapes counted as "tetrahedral" / "octahedral" sites: CN 4 best fitted by T-4, CN 6 by OC-6. */
export const isTet = (a: SiteAnalysis) => a.cn === 4 && a.shapes[0]?.sym === "T:4";
export const isOct = (a: SiteAnalysis) => a.cn === 6 && a.shapes[0]?.sym === "O:6";

/** Configurational entropy (k_B), size and charge spread of the species sharing one site. */
export function mixing(species: { x: number; r: number; q: number }[]) {
  const W = species.reduce((s, x) => s + x.x, 0);
  if (W <= 0) return { entropy: 0, radius: 0, charge: 0 };
  const xs = species.map((s) => ({ ...s, x: s.x / W }));
  const rBar = xs.reduce((s, x) => s + x.x * x.r, 0);
  const qBar = xs.reduce((s, x) => s + x.x * x.q, 0);
  return {
    entropy: -xs.reduce((s, x) => s + (x.x > 0 ? x.x * Math.log(x.x) : 0), 0),
    radius: rBar > 0 ? Math.sqrt(xs.reduce((s, x) => s + x.x * (1 - x.r / rBar) ** 2, 0)) : 0,
    charge: Math.sqrt(xs.reduce((s, x) => s + x.x * (x.q - qBar) ** 2, 0)),
  };
}

export function computeDescriptors(
  cr: Crystal,
  ox: Record<string, number>,
  bonds: BondTable,
  table: Neighbor[][],
  analyses: SiteAnalysis[], // one per crystal group, host = main occupant
  mobileEl: string | null,
  radius: (pos: number, site: number) => number,
): Record<string, Value> {
  const v: Record<string, Value> = {};
  const elOf = (site: number) => cr.sites[site].element;
  const qOf = (site: number) => ox[cr.sites[site].label] ?? 0;
  const P = cr.positions;
  const isMobile = (site: number) => !!mobileEl && elOf(site) === mobileEl;
  const isMobilePos = (pos: number) => P[pos].occupants.some((o) => isMobile(o.site));
  const isFrameCation = (site: number) => qOf(site) > 0 && !isMobile(site);
  const occOf = (pos: number, test: (site: number) => boolean) => P[pos].occupants.filter((o) => test(o.site)).reduce((s, o) => s + o.occ, 0);

  const groups = cr.groups.map((g, i) => ({ g, a: analyses[i], pos: g.positions[0], mult: g.positions.length }));
  const anions = groups.filter((x) => qOf(P[x.pos].main) < 0);
  const anionW = (x: (typeof groups)[number]) => x.mult * occOf(x.pos, (s) => qOf(s) < 0);
  const frames = groups.filter((x) => qOf(P[x.pos].main) > 0 && !isMobilePos(x.pos));
  const mobiles = groups.filter((x) => isMobilePos(x.pos));
  const mobileW = (x: (typeof groups)[number]) => x.mult * occOf(x.pos, isMobile);

  // ---------------- anion environment ----------------
  /** Ionic potential |q|/r of the anions on one position, occupancy weighted (e/Å). */
  const ionPot = (pos: number) => {
    const occ = P[pos].occupants.filter((o) => qOf(o.site) < 0);
    const W = occ.reduce((s, o) => s + o.occ, 0);
    return W > 0 ? occ.reduce((s, o) => s + o.occ * (Math.abs(qOf(o.site)) / radius(pos, o.site)), 0) / W : null;
  };
  const pots = anions.map((x) => ({ v: ionPot(x.pos), w: anionW(x) }));
  v.ionPot_anion = wstats(pots).mean;
  const potByGroup = pots.map((p) => p.v).filter((x): x is number => x !== null);
  v.ionPot_anion_range = potByGroup.length ? Math.max(...potByGroup) - Math.min(...potByGroup) : null;
  const cnA = wstats(anions.map((x) => ({ v: x.a.cn, w: anionW(x) })));
  v.cn_anion = cnA.mean;
  v.cn_anion_sd = cnA.sd;

  // isolated anions: bonded to no framework cation (only to mobile ions, or to nothing)
  const isoKeys = ["isoAnion_frac", "isoAnion_rho", "isoAnion_dXX", "isoAnion_cn", "isoAnion_cshm", "ionPot_isoAnion", "ionPot_isoAnion_range"];
  if (mobileEl && mobiles.length && anions.length) {
    const isolated = (pos: number) => !bonds.bonded[pos].some((nb) => P[nb.j].occupants.some((o) => isFrameCation(o.site)));
    const iso = anions.filter((x) => isolated(x.pos));
    const Wall = anions.reduce((s, x) => s + anionW(x), 0);
    const Wiso = iso.reduce((s, x) => s + anionW(x), 0);
    v.isoAnion_frac = Wall > 0 ? Wiso / Wall : null;
    v.isoAnion_rho = (Wiso / cr.lattice.volume) * 1000;
    const isoPos = new Set(iso.flatMap((x) => x.g.positions));
    v.isoAnion_dXX = wstats(iso.map((x) => ({ v: table[x.pos].find((n) => isoPos.has(n.j))?.d ?? null, w: anionW(x) }))).mean;
    v.isoAnion_cn = wstats(iso.map((x) => ({ v: x.a.cn, w: anionW(x) }))).mean;
    v.isoAnion_cshm = wstats(iso.map((x) => ({ v: x.a.shapes[0]?.cshm ?? null, w: anionW(x) }))).mean;
    v.ionPot_isoAnion = wstats(iso.map((x) => ({ v: ionPot(x.pos), w: anionW(x) }))).mean;
    // between the isolated-anion sites only, e.g. the 4a / 4d imbalance of argyrodites (the PS₄ sulphur is not isolated)
    const isoPots = iso.map((x) => ionPot(x.pos)).filter((p): p is number => p !== null);
    v.ionPot_isoAnion_range = isoPots.length ? Math.max(...isoPots) - Math.min(...isoPots) : null;
  } else for (const k of isoKeys) v[k] = null;

  // ---------------- distributions over the mobile and framework sublattices ----------------
  const distKeys = ["cn_mobile_min", "cn_mobile_max", "cn_mobile_sd", "d_mobile_sd", "dist_mobile_max", "dist_mobile_sd", "cshm_mobile", "cshm_mobile_max", "mobile_tet_frac", "mobile_oct_frac", "offset_mobile", "bvvs_mobile"];
  if (mobiles.length) {
    const items = mobiles.map((x) => ({ x, w: mobileW(x) }));
    const st = (f: (a: SiteAnalysis) => number | null) => wstats(items.map(({ x, w }) => ({ v: f(x.a), w })));
    const cn = st((a) => a.cn);
    v.cn_mobile_min = cn.min;
    v.cn_mobile_max = cn.max;
    v.cn_mobile_sd = cn.sd;
    v.d_mobile_sd = st((a) => (a.cn ? a.dMean : null)).sd;
    const dist = st((a) => (a.cn ? a.distortion : null));
    v.dist_mobile_max = dist.max;
    v.dist_mobile_sd = dist.sd;
    const sh = st((a) => a.shapes[0]?.cshm ?? null);
    v.cshm_mobile = sh.mean;
    v.cshm_mobile_max = sh.max;
    v.mobile_tet_frac = wfrac(items.map(({ x, w }) => ({ x: x.a, w })), isTet);
    v.mobile_oct_frac = wfrac(items.map(({ x, w }) => ({ x: x.a, w })), isOct);
    v.offset_mobile = st((a) => a.centroidOffset).mean;
    // the mobile ion itself as the centre, also on mixed sites
    v.bvvs_mobile = wstats(
      items.map(({ x, w }) => {
        const site = P[x.pos].occupants.find((o) => isMobile(o.site))!.site;
        const a = site === x.a.host.site ? x.a : analyzeSite(cr, ox, bonds, x.pos, { kind: "ionic", hostSite: site });
        return { v: a.bvvsHost, w };
      }),
    ).mean;
  } else for (const k of distKeys) v[k] = null;

  const fItems = frames.filter((x) => x.a.cn > 0).map((x) => ({ x: x.a, w: x.mult }));
  v.cshm_frame = wstats(fItems.map(({ x, w }) => ({ v: x.shapes[0]?.cshm ?? null, w }))).mean;
  v.frame_tet_frac = wfrac(fItems, isTet);
  v.frame_oct_frac = wfrac(fItems, isOct);
  v.bvvs_frame = wstats(fItems.map(({ x, w }) => ({ v: x.bvvsHost, w }))).mean;

  // ---------------- mixed sites (ideal mixing from the average-structure occupancies) ----------------
  const mixOf = (pos: number, test: (site: number) => boolean) =>
    mixing(P[pos].occupants.filter((o) => test(o.site)).map((o) => ({ x: o.occ, r: radius(pos, o.site), q: qOf(o.site) })));
  const fMix = frames.map((x) => ({ m: mixOf(x.pos, isFrameCation), w: x.mult }));
  const aMix = anions.map((x) => ({ m: mixOf(x.pos, (s) => qOf(s) < 0), w: x.mult }));
  const avg = (xs: { m: ReturnType<typeof mixing>; w: number }[], k: "entropy" | "radius" | "charge") => wstats(xs.map((x) => ({ v: x.m[k], w: x.w }))).mean;
  v.mixEntropy_frame = avg(fMix, "entropy");
  v.mixEntropy_anion = avg(aMix, "entropy");
  v.radiusDisorder_frame = avg(fMix, "radius");
  v.radiusDisorder_anion = avg(aMix, "radius");
  v.chargeDisorder_frame = avg(fMix, "charge");
  v.chargeDisorder_anion = avg(aMix, "charge");

  return v;
}
