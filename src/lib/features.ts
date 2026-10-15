// Structure descriptors computed from a CIF, aimed at ion-conductor screening.
// Everything here is geometric / empirical; see FEATURE_DEFS for definitions.

import { BondTable } from "./bonding";
import { ELEMENTS, IDEAL_POLYHEDRA, IdealPolyhedron } from "./data";
import { analyzeSite, shannonRadius, SiteAnalysis } from "./analysis";
import { computeDescriptors } from "./descriptors";
import { cshm } from "./shape";
import { FrameworkField } from "./bvse";
import { PeriodicUnionFind } from "./percolation";
import { Crystal, Neighbor, Vec3, add, buildNeighborTable, formulaString, toCart } from "./structure";

export type FeatureValue = number | string | null;

/** Feature metadata. Names and descriptions live in the i18n dictionaries (feat.<key>.label / .desc). */
export interface FeatureDef {
  key: string;
  group: FeatureGroup;
  unit?: string;
  digits?: number;
  text?: boolean;
  async?: boolean; // filled by the grid (BVSE / void) calculation
}

export type FeatureGroup = "lattice" | "packing" | "bv" | "mobile" | "network" | "frame" | "anion" | "dist" | "mix" | "grid";

export const GROUPS: FeatureGroup[] = ["lattice", "packing", "bv", "mobile", "network", "frame", "anion", "dist", "mix", "grid"];

export const FEATURE_DEFS: FeatureDef[] = [
  // lattice
  { key: "a", unit: "Å", digits: 4, group: "lattice" },
  { key: "b", unit: "Å", digits: 4, group: "lattice" },
  { key: "c", unit: "Å", digits: 4, group: "lattice" },
  { key: "alpha", unit: "°", digits: 3, group: "lattice" },
  { key: "beta", unit: "°", digits: 3, group: "lattice" },
  { key: "gamma", unit: "°", digits: 3, group: "lattice" },
  { key: "c_a", digits: 4, group: "lattice" },
  { key: "b_a", digits: 4, group: "lattice" },
  { key: "V", unit: "Å³", digits: 2, group: "lattice" },
  { key: "Z", digits: 0, group: "lattice" },
  { key: "V_Z", unit: "Å³", digits: 2, group: "lattice" },
  { key: "N", digits: 2, group: "lattice" },
  { key: "V_atom", unit: "Å³", digits: 2, group: "lattice" },
  { key: "density", unit: "g/cm³", digits: 3, group: "lattice" },
  { key: "sg", group: "lattice", text: true },
  { key: "system", group: "lattice", text: true },
  { key: "nSites", digits: 0, group: "lattice" },
  { key: "IG", unit: "bit/atom", digits: 3, group: "lattice" },
  { key: "IG_total", unit: "bit/cell", digits: 2, group: "lattice" },
  // packing
  { key: "packing", digits: 3, group: "packing" },
  { key: "anionEls", group: "packing", text: true },
  { key: "V_anion", unit: "Å³", digits: 2, group: "packing" },
  { key: "dXX", unit: "Å", digits: 3, group: "packing" },
  { key: "anionFrame", group: "packing", text: true },
  { key: "cshm_bcc", digits: 2, group: "packing" },
  { key: "cshm_fcc", digits: 2, group: "packing" },
  { key: "cshm_hcp", digits: 2, group: "packing" },
  { key: "dX_frame", digits: 3, group: "packing" },
  // bond valence
  { key: "GII", unit: "v.u.", digits: 3, group: "bv" },
  { key: "bvs_mobile", unit: "v.u.", digits: 3, group: "bv" },
  { key: "bvs_mobile_dev", digits: 3, group: "bv" },
  // mobile sublattice
  { key: "mobile", group: "mobile", text: true },
  { key: "n_mobile", digits: 3, group: "mobile" },
  { key: "rho_mobile", unit: "nm⁻³", digits: 2, group: "mobile" },
  { key: "mobileSites", digits: 0, group: "mobile" },
  { key: "mobilePositions", digits: 0, group: "mobile" },
  { key: "vacancy", digits: 3, group: "mobile" },
  { key: "occEntropy", unit: "k_B", digits: 3, group: "mobile" },
  { key: "cn_mobile", digits: 2, group: "mobile" },
  { key: "d_mobile", unit: "Å", digits: 3, group: "mobile" },
  { key: "vol_mobile", unit: "Å³", digits: 2, group: "mobile" },
  { key: "dist_mobile", digits: 4, group: "mobile" },
  { key: "dMM", unit: "Å", digits: 3, group: "mobile" },
  { key: "dMF", unit: "Å", digits: 3, group: "mobile" },
  // network
  { key: "hopDegree", digits: 2, group: "network" },
  { key: "hopDim", digits: 0, group: "network" },
  { key: "rb_min", unit: "Å", digits: 3, group: "network" },
  { key: "rb_mean", unit: "Å", digits: 3, group: "network" },
  { key: "rb_1D", unit: "Å", digits: 3, group: "network" },
  { key: "rb_2D", unit: "Å", digits: 3, group: "network" },
  { key: "rb_3D", unit: "Å", digits: 3, group: "network" },
  { key: "rb_a", unit: "Å", digits: 3, group: "network" },
  { key: "rb_b", unit: "Å", digits: 3, group: "network" },
  { key: "rb_c", unit: "Å", digits: 3, group: "network" },
  // framework connectivity
  { key: "frame_corner", digits: 3, group: "frame" },
  { key: "frame_edge", digits: 3, group: "frame" },
  { key: "frame_face", digits: 3, group: "frame" },
  { key: "frame_isolated", digits: 3, group: "frame" },
  { key: "mm_face", digits: 3, group: "frame" },
  { key: "mf_face", digits: 3, group: "frame" },
  // anion environment
  { key: "isoAnion_frac", digits: 3, group: "anion" },
  { key: "isoAnion_rho", unit: "nm⁻³", digits: 2, group: "anion" },
  { key: "isoAnion_dXX", unit: "Å", digits: 3, group: "anion" },
  { key: "isoAnion_cn", digits: 2, group: "anion" },
  { key: "isoAnion_cshm", digits: 2, group: "anion" },
  { key: "ionPot_anion", unit: "e/Å", digits: 3, group: "anion" },
  { key: "ionPot_anion_range", unit: "e/Å", digits: 3, group: "anion" },
  { key: "ionPot_isoAnion", unit: "e/Å", digits: 3, group: "anion" },
  { key: "ionPot_isoAnion_range", unit: "e/Å", digits: 3, group: "anion" },
  { key: "cn_anion", digits: 2, group: "anion" },
  { key: "cn_anion_sd", digits: 2, group: "anion" },
  // distributions over sites
  { key: "cn_mobile_min", digits: 0, group: "dist" },
  { key: "cn_mobile_max", digits: 0, group: "dist" },
  { key: "cn_mobile_sd", digits: 2, group: "dist" },
  { key: "d_mobile_sd", unit: "Å", digits: 3, group: "dist" },
  { key: "dist_mobile_max", digits: 4, group: "dist" },
  { key: "dist_mobile_sd", digits: 4, group: "dist" },
  { key: "cshm_mobile", digits: 2, group: "dist" },
  { key: "cshm_mobile_max", digits: 2, group: "dist" },
  { key: "mobile_tet_frac", digits: 3, group: "dist" },
  { key: "mobile_oct_frac", digits: 3, group: "dist" },
  { key: "offset_mobile", unit: "Å", digits: 3, group: "dist" },
  { key: "bvvs_mobile", unit: "v.u.", digits: 3, group: "dist" },
  { key: "cshm_frame", digits: 2, group: "dist" },
  { key: "frame_tet_frac", digits: 3, group: "dist" },
  { key: "frame_oct_frac", digits: 3, group: "dist" },
  { key: "bvvs_frame", unit: "v.u.", digits: 3, group: "dist" },
  // mixed sites
  { key: "mixEntropy_frame", unit: "k_B", digits: 3, group: "mix" },
  { key: "mixEntropy_anion", unit: "k_B", digits: 3, group: "mix" },
  { key: "radiusDisorder_frame", digits: 4, group: "mix" },
  { key: "radiusDisorder_anion", digits: 4, group: "mix" },
  { key: "chargeDisorder_frame", digits: 3, group: "mix" },
  { key: "chargeDisorder_anion", digits: 3, group: "mix" },
  // grid
  { key: "E_1D", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_2D", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_3D", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_a", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_b", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_c", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_axis_range", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "siteE_sd", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "siteE_range", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "R_1D", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "R_2D", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "R_3D", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "R_a", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "R_b", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "R_c", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "maxVoid", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "vol_conn", digits: 4, group: "grid", async: true },
  { key: "vol_conn_ratio", digits: 3, group: "grid", async: true },
  { key: "n_interstitial", digits: 0, group: "grid", async: true },
  { key: "rho_interstitial", unit: "nm⁻³", digits: 2, group: "grid", async: true },
  { key: "E_interstitial_min", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "site_spacing", unit: "Å", digits: 3, group: "grid", async: true },
  { key: "site_energy_spread", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "curv_min", unit: "eV/Å²", digits: 2, group: "grid", async: true },
  { key: "curv_aniso", digits: 2, group: "grid", async: true },
  { key: "site_recovery", digits: 3, group: "grid", async: true },
  { key: "hop_barrier_min", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "hop_barrier_mean", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "hop_barrier_sd", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "hop_asymmetry", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_hop_1D", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_hop_2D", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_hop_3D", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_hop_a", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_hop_b", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "E_hop_c", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "trap_max", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "trap_mean", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "trap_isolated", digits: 0, group: "grid", async: true },
  { key: "trap_unresolved", digits: 0, group: "grid", async: true },
  { key: "hop_bypass_dim", digits: 0, group: "grid", async: true },
  { key: "E_hop_bypass", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "dE_hop_bypass", unit: "eV", digits: 3, group: "grid", async: true },
  { key: "logD", unit: "log10(cm²/s)", digits: 2, group: "grid", async: true },
  { key: "logD_a", unit: "log10(cm²/s)", digits: 2, group: "grid", async: true },
  { key: "logD_b", unit: "log10(cm²/s)", digits: 2, group: "grid", async: true },
  { key: "logD_c", unit: "log10(cm²/s)", digits: 2, group: "grid", async: true },
  { key: "D_dim", digits: 0, group: "grid", async: true },
  { key: "logD_aniso", digits: 2, group: "grid", async: true },
  { key: "Ea_D", unit: "eV", digits: 3, group: "grid", async: true },
];

export const FEATURE_BY_KEY = Object.fromEntries(FEATURE_DEFS.map((f) => [f.key, f])) as Record<string, FeatureDef>;

const MOBILE_PREF = ["Li", "Na", "K", "Ag", "Cu", "Mg", "Zn", "Ca", "Rb", "Cs", "H", "F", "O"];

export function defaultMobile(cr: Crystal, ox: Record<string, number>): string | null {
  const present = new Set(cr.sites.map((s) => s.element));
  for (const el of MOBILE_PREF) {
    if (!present.has(el)) continue;
    const s = cr.sites.find((x) => x.element === el)!;
    const q = ox[s.label] ?? 0;
    if ((el === "F" || el === "O") && q < 0) return el;
    if (q > 0) return el;
  }
  return null;
}

/** Crystal system code (translated in the UI as system.<code>). */
export function crystalSystem(n: number | null): string {
  if (!n) return "unknown";
  if (n <= 2) return "triclinic";
  if (n <= 15) return "monoclinic";
  if (n <= 74) return "orthorhombic";
  if (n <= 142) return "tetragonal";
  if (n <= 167) return "trigonal";
  if (n <= 194) return "hexagonal";
  return "cubic";
}

export interface Hop {
  a: number; // position index
  b: number;
  t: Vec3; // translation of b
  d: number;
  rb: number; // bottleneck radius (Å, ≥ 0): free radius along the straight path
  mid: Vec3; // Cartesian point of the bottleneck
}

/** Geometric display groups: same site groups, distance and bottleneck radius; not a symmetry test. */
export interface HopClass {
  key: string;
  from: string; // site group (the smaller key of the two ends)
  to: string;
  d: number;
  rb: number;
  members: number[]; // indices into the hop list
}

/** Groups hops into classes, ordered by bottleneck radius (narrow first), then distance. */
export function hopClasses(cr: Crystal, hops: Hop[]): HopClass[] {
  const out = new Map<string, HopClass>();
  hops.forEach((h, i) => {
    const [from, to] = [cr.positions[h.a].group, cr.positions[h.b].group].sort();
    const key = `${from}|${to}|${h.d.toFixed(3)}|${h.rb.toFixed(3)}`;
    const c = out.get(key);
    if (c) c.members.push(i);
    else out.set(key, { key, from, to, d: h.d, rb: h.rb, members: [i] });
  });
  return [...out.values()].sort((x, y) => x.rb - y.rb || x.d - y.d || (x.key < y.key ? -1 : 1));
}

export interface SiteRow {
  group: string;
  el: string;
  ox: number;
  mult: number;
  occ: number;
  cn: number;
  dMean: number;
  bvs: number | null;
  bvsDev: number | null;
  distortion: number;
  shape: string;
  cshm: number | null;
  volume: number | null;
  mobile: boolean;
}

export interface Sharing {
  corner: number;
  edge: number;
  face: number;
}

export interface StaticFeatures {
  values: Record<string, FeatureValue>;
  sites: SiteRow[];
  hops: Hop[];
  prdf: { pair: string; points: { x: number; y: number }[] }[];
  sharing: { frame: Sharing; mm: Sharing; mf: Sharing };
  mobileEl: string | null;
  analyses: SiteAnalysis[];
}

/** Shannon ionic radius of the occupant at its own CN (fallback: 0.6 × atomic radius). */
export function ionicRadiusFn(cr: Crystal, ox: Record<string, number>, bonds: BondTable) {
  const cache = new Map<string, number>();
  return (pos: number, site: number) => {
    const s = cr.sites[site];
    const cn = bonds.bonded[pos].length || 6;
    const k = `${site}|${cn}`;
    const c = cache.get(k);
    if (c !== undefined) return c;
    const r = shannonRadius(s.element, Math.round(ox[s.label] ?? 0), cn, { kind: "ionic" })?.r ?? (ELEMENTS[s.element]?.r ?? 1.2) * 0.6;
    cache.set(k, r);
    return r;
  };
}

function bccIdeal(): IdealPolyhedron {
  const pts: Vec3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) pts.push([x, y, z]);
  for (const ax of [0, 1, 2])
    for (const s of [-2, 2]) {
      const p: Vec3 = [0, 0, 0];
      p[ax] = s;
      pts.push(p);
    }
  return { sym: "BCC:14", name: "bcc (8+6)", cn: 14, iupac: null, pts };
}
const BCC = bccIdeal();
const FCC = IDEAL_POLYHEDRA.find((p) => p.sym === "C:12")!;
const HCP = IDEAL_POLYHEDRA.find((p) => p.sym === "AC:12")!;

/**
 * A mobile–mobile pair is not counted as a hop when its straight line passes within this fraction of a
 * framework ion's radius from the ion centre, i.e. through the ion rather than through a window.
 */
export const HOP_CORE_BLOCK = 0.5;

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeStaticFeatures(
  cr: Crystal,
  ox: Record<string, number>,
  bonds: BondTable,
  table: Neighbor[][],
  opts: { mobileEl: string | null; hopCutoff: number },
): StaticFeatures {
  const L = cr.lattice;
  const v: Record<string, FeatureValue> = {};
  const elOf = (site: number) => cr.sites[site].element;
  const qOf = (site: number) => ox[cr.sites[site].label] ?? 0;
  const mainQ = (pos: number) => qOf(cr.positions[pos].main);

  // ---------------- lattice ----------------
  v.a = L.a;
  v.b = L.b;
  v.c = L.c;
  v.alpha = L.alpha;
  v.beta = L.beta;
  v.gamma = L.gamma;
  v.c_a = L.c / L.a;
  v.b_a = L.b / L.a;
  v.V = L.volume;
  const { Z } = formulaString(cr);
  v.Z = Z;
  v.V_Z = L.volume / Z;
  let N = 0,
    mass = 0;
  for (const p of cr.positions)
    for (const o of p.occupants) {
      N += o.occ;
      mass += o.occ * (ELEMENTS[elOf(o.site)]?.m ?? 0);
    }
  v.N = N;
  v.V_atom = L.volume / N;
  v.density = (mass * 1.66053907) / L.volume;
  v.sg = cr.spaceGroup.number ? `${cr.spaceGroup.symbol} (${cr.spaceGroup.number})` : cr.spaceGroup.symbol;
  v.system = crystalSystem(cr.spaceGroup.number);
  v.nSites = cr.sites.length;
  const nPos = cr.positions.length;
  let IG = 0;
  for (const g of cr.groups) {
    const p = g.positions.length / nPos;
    IG -= p * Math.log2(p);
  }
  v.IG = IG;
  v.IG_total = IG * nPos;

  // ---------------- per-site analyses ----------------
  const radius = ionicRadiusFn(cr, ox, bonds);
  const analyses = cr.groups.map((g) => analyzeSite(cr, ox, bonds, g.positions[0], { kind: "ionic" }));
  const mobileEl = opts.mobileEl;
  const isMobilePos = (pos: number) => !!mobileEl && cr.positions[pos].occupants.some((o) => elOf(o.site) === mobileEl);

  const sites: SiteRow[] = analyses.map((a, i) => {
    const g = cr.groups[i];
    const P = cr.positions[a.pos];
    return {
      group: g.key,
      el: a.host.el,
      ox: a.host.ox,
      mult: g.positions.length,
      occ: P.occupants.reduce((s, o) => s + o.occ, 0),
      cn: a.cn,
      dMean: a.dMean,
      bvs: a.bvsHost,
      bvsDev: a.bvsHost !== null && a.host.ox ? a.bvsHost / Math.abs(a.host.ox) - 1 : null,
      distortion: a.distortion,
      shape: a.shapes[0]?.sym ?? "",
      cshm: a.shapes[0]?.cshm ?? null,
      volume: a.volume,
      mobile: isMobilePos(a.pos),
    };
  });

  // ---------------- packing ----------------
  let vIons = 0;
  for (const p of cr.positions) for (const o of p.occupants) vIons += o.occ * (4 / 3) * Math.PI * radius(p.index, o.site) ** 3;
  v.packing = vIons / L.volume;
  const anionPos = cr.positions.filter((p) => mainQ(p.index) < 0);
  const anionEls = [...new Set(cr.sites.filter((s) => (ox[s.label] ?? 0) < 0).map((s) => s.element))];
  v.anionEls = anionEls.join(", ") || "—";
  const nAnion = anionPos.reduce((s, p) => s + p.occupants.filter((o) => qOf(o.site) < 0).reduce((t, o) => t + o.occ, 0), 0);
  v.V_anion = nAnion ? L.volume / nAnion : null;
  const anionSet = new Set(anionPos.map((p) => p.index));
  const dXX: number[] = [];
  for (const p of anionPos) {
    const nb = table[p.index].find((n) => anionSet.has(n.j));
    if (nb) dXX.push(nb.d);
  }
  v.dXX = mean(dXX);
  // anion sublattice type (one representative per anion orbit)
  const fits = { bcc: [] as number[], fcc: [] as number[], hcp: [] as number[] };
  for (const g of cr.groups) {
    const p0 = g.positions[0];
    if (mainQ(p0) >= 0) continue;
    const nbs = table[p0].filter((n) => anionSet.has(n.j));
    const w = g.positions.length;
    if (nbs.length >= 14) {
      const s = cshm(nbs.slice(0, 14).map((n) => n.v), BCC);
      for (let k = 0; k < w; k++) fits.bcc.push(s);
    }
    if (nbs.length >= 12) {
      const pts = nbs.slice(0, 12).map((n) => n.v);
      const sf = cshm(pts, FCC),
        sh = cshm(pts, HCP);
      for (let k = 0; k < w; k++) {
        fits.fcc.push(sf);
        fits.hcp.push(sh);
      }
    }
  }
  v.cshm_bcc = mean(fits.bcc);
  v.cshm_fcc = mean(fits.fcc);
  v.cshm_hcp = mean(fits.hcp);
  {
    const cands = (["bcc", "fcc", "hcp"] as const).map((k) => [k, v[`cshm_${k}`] as number | null] as const).filter((x) => x[1] !== null) as [string, number][];
    cands.sort((a, b) => a[1] - b[1]);
    // code: "bcc" / "fcc" / "hcp", with "~" appended when strongly distorted (CShM ≥ 6)
    v.anionFrame = cands.length ? (cands[0][1] < 6 ? cands[0][0] : `${cands[0][0]}~`) : null;
  }
  {
    const dx: number[] = [];
    for (const p of cr.positions) {
      const q = mainQ(p.index);
      if (q <= 0 || isMobilePos(p.index)) continue;
      const Xc = ELEMENTS[elOf(p.main)]?.X;
      for (const nb of bonds.bonded[p.index]) {
        const Xa = ELEMENTS[elOf(cr.positions[nb.j].main)]?.X;
        if (Xc != null && Xa != null) dx.push(Xa - Xc);
      }
    }
    v.dX_frame = mean(dx);
  }

  // ---------------- bond valence ----------------
  {
    let s2 = 0,
      w = 0;
    analyses.forEach((a, i) => {
      if (a.bvsHost === null || !a.host.ox) return;
      const m = cr.groups[i].positions.length;
      s2 += m * (a.bvsHost - Math.abs(a.host.ox)) ** 2;
      w += m;
    });
    v.GII = w ? Math.sqrt(s2 / w) : null;
  }

  // ---------------- mobile sublattice ----------------
  const mobilePos = cr.positions.filter((p) => isMobilePos(p.index));
  v.mobile = mobileEl ?? "—";
  const occM = (pos: number) => cr.positions[pos].occupants.filter((o) => elOf(o.site) === mobileEl).reduce((s, o) => s + o.occ, 0);
  if (mobileEl && mobilePos.length) {
    const nM = mobilePos.reduce((s, p) => s + occM(p.index), 0);
    v.n_mobile = nM;
    v.rho_mobile = (nM / L.volume) * 1000;
    v.mobileSites = new Set(cr.sites.filter((s) => s.element === mobileEl).map((s) => s.label)).size;
    v.mobilePositions = mobilePos.length;
    v.vacancy = 1 - nM / mobilePos.length;
    const ent = mobilePos.map((p) => {
      const f = Math.min(1, occM(p.index));
      return f <= 0 || f >= 1 ? 0 : -(f * Math.log(f) + (1 - f) * Math.log(1 - f));
    });
    v.occEntropy = mean(ent);
    const mobileGroups = analyses.map((a, i) => ({ a, g: cr.groups[i] })).filter((x) => isMobilePos(x.a.pos));
    const wavg = (f: (a: SiteAnalysis) => number | null) => {
      let s = 0,
        w = 0;
      for (const { a, g } of mobileGroups) {
        const val = f(a);
        if (val === null || !Number.isFinite(val)) continue;
        const ww = g.positions.length * occM(a.pos);
        s += ww * val;
        w += ww;
      }
      return w ? s / w : null;
    };
    v.cn_mobile = wavg((a) => a.cn);
    v.d_mobile = wavg((a) => (a.cn ? a.dMean : null));
    v.vol_mobile = wavg((a) => a.volume);
    v.dist_mobile = wavg((a) => a.distortion);
    // BVS of the mobile ion itself (even on mixed sites)
    const mobileBvs = mobileGroups.map(({ a, g }) => {
      const site = cr.positions[a.pos].occupants.find((o) => elOf(o.site) === mobileEl)!.site;
      const b = site === a.host.site ? a : analyzeSite(cr, ox, bonds, a.pos, { kind: "ionic", hostSite: site });
      return { bvs: b.bvsHost, q: Math.abs(b.host.ox), w: g.positions.length * occM(a.pos) };
    });
    const bw = mobileBvs.filter((x) => x.bvs !== null && x.q);
    const sw = bw.reduce((s, x) => s + x.w, 0);
    v.bvs_mobile = sw ? bw.reduce((s, x) => s + x.w * (x.bvs as number), 0) / sw : null;
    v.bvs_mobile_dev = sw ? bw.reduce((s, x) => s + x.w * ((x.bvs as number) / x.q - 1), 0) / sw : null;
    const mSet = new Set(mobilePos.map((p) => p.index));
    let dMM = Infinity,
      dMF = Infinity;
    for (const p of mobilePos)
      for (const n of table[p.index]) {
        if (mSet.has(n.j)) dMM = Math.min(dMM, n.d);
        else if (mainQ(n.j) > 0) dMF = Math.min(dMF, n.d);
      }
    v.dMM = Number.isFinite(dMM) ? dMM : null;
    v.dMF = Number.isFinite(dMF) ? dMF : null;
  } else {
    for (const k of ["n_mobile", "rho_mobile", "mobileSites", "mobilePositions", "vacancy", "occEntropy", "cn_mobile", "d_mobile", "vol_mobile", "dist_mobile", "bvs_mobile", "bvs_mobile_dev", "dMM", "dMF"]) v[k] = null;
  }

  // ---------------- hop network ----------------
  const hops: Hop[] = [];
  if (mobileEl && mobilePos.length) {
    const field = new FrameworkField(cr, ox, mobileEl, radius, 6);
    const mSet = new Set(mobilePos.map((p) => p.index));
    for (const p of mobilePos)
      for (const n of table[p.index]) {
        if (n.d > opts.hopCutoff) break;
        if (!mSet.has(n.j)) continue;
        // each undirected hop once
        const key = `${p.index}|${n.j}|${n.t.join(",")}`;
        const rev = `${n.j}|${p.index}|${n.t.map((x) => -x).join(",")}`;
        if (p.index > n.j || (p.index === n.j && key > rev)) continue;
        const A = p.cart;
        const seg = field.segment(A, [A[0] + n.v[0], A[1] + n.v[1], A[2] + n.v[2]]);
        // The straight line runs through a framework ion (e.g. Li–N–Li, O–Ti–O): not a direct hop.
        if (seg.core < HOP_CORE_BLOCK) continue;
        // Narrower than the Shannon spheres: no free radius left on the straight path.
        hops.push({ a: p.index, b: n.j, t: n.t, d: n.d, rb: Math.max(0, seg.clearance), mid: seg.at });
      }
    const deg = new Map<number, number>();
    for (const h of hops) {
      deg.set(h.a, (deg.get(h.a) ?? 0) + 1);
      deg.set(h.b, (deg.get(h.b) ?? 0) + 1);
    }
    v.hopDegree = mean(mobilePos.map((p) => deg.get(p.index) ?? 0));
    const rbs = hops.map((h) => h.rb);
    v.rb_min = rbs.length ? Math.min(...rbs) : null;
    v.rb_mean = mean(rbs);
    // percolation over hops sorted by bottleneck (largest first)
    const idx = new Map(mobilePos.map((p, i) => [p.index, i]));
    const uf = new PeriodicUnionFind(mobilePos.length);
    mobilePos.forEach((_, i) => uf.make(i));
    const rbD: (number | null)[] = [null, null, null];
    const rbAx: (number | null)[] = [null, null, null];
    for (const h of [...hops].sort((x, y) => y.rb - x.rb)) {
      const before = uf.maxRank;
      uf.union(idx.get(h.a)!, idx.get(h.b)!, h.t);
      for (let d = before; d < uf.maxRank; d++) rbD[d] = h.rb;
      for (let k = 0; k < 3; k++) if (uf.axes[k] && rbAx[k] === null) rbAx[k] = h.rb;
    }
    v.hopDim = uf.maxRank;
    v.rb_1D = rbD[0];
    v.rb_2D = rbD[1];
    v.rb_3D = rbD[2];
    v.rb_a = rbAx[0];
    v.rb_b = rbAx[1];
    v.rb_c = rbAx[2];
  } else {
    for (const k of ["hopDegree", "hopDim", "rb_min", "rb_mean", "rb_1D", "rb_2D", "rb_3D", "rb_a", "rb_b", "rb_c"]) v[k] = null;
  }

  // ---------------- polyhedral connectivity ----------------
  const kindOf = (pos: number): "mobile" | "frame" | null => {
    if (bonds.bonded[pos].length < 3) return null;
    if (isMobilePos(pos)) return "mobile";
    return mainQ(pos) > 0 ? "frame" : null;
  };
  const sharing = { frame: { corner: 0, edge: 0, face: 0 }, mm: { corner: 0, edge: 0, face: 0 }, mf: { corner: 0, edge: 0, face: 0 } };
  let frameCount = 0,
    frameIsolated = 0;
  for (const p of cr.positions) {
    const kA = kindOf(p.index);
    if (!kA) continue;
    const shared = new Map<string, { kind: "mobile" | "frame"; n: number }>();
    for (const lig of bonds.bonded[p.index]) {
      for (const back of bonds.bonded[lig.j]) {
        const t2 = add(lig.t, back.t);
        if (back.j === p.index && t2[0] === 0 && t2[1] === 0 && t2[2] === 0) continue;
        const kB = kindOf(back.j);
        if (!kB) continue;
        const key = `${back.j}|${t2.join(",")}`;
        const cur = shared.get(key);
        if (cur) cur.n++;
        else shared.set(key, { kind: kB, n: 1 });
      }
    }
    if (kA === "frame") {
      frameCount++;
      if (![...shared.values()].some((s) => s.kind === "frame")) frameIsolated++;
    }
    for (const s of shared.values()) {
      const bucket = kA === "frame" && s.kind === "frame" ? sharing.frame : kA === "mobile" && s.kind === "mobile" ? sharing.mm : sharing.mf;
      const w = kA !== s.kind ? 1 : 0.5; // same-kind pairs are seen from both ends
      if (s.n === 1) bucket.corner += w;
      else if (s.n === 2) bucket.edge += w;
      else bucket.face += w;
    }
  }
  // mixed pairs were counted from both sides too
  sharing.mf.corner /= 2;
  sharing.mf.edge /= 2;
  sharing.mf.face /= 2;
  const frac = (s: Sharing, k: keyof Sharing) => {
    const t = s.corner + s.edge + s.face;
    return t ? s[k] / t : null;
  };
  v.frame_corner = frac(sharing.frame, "corner");
  v.frame_edge = frac(sharing.frame, "edge");
  v.frame_face = frac(sharing.frame, "face");
  v.frame_isolated = frameCount ? frameIsolated / frameCount : null;
  v.mm_face = frac(sharing.mm, "face");
  v.mf_face = frac(sharing.mf, "face");

  // ---------------- anion environment, site distributions, mixed sites ----------------
  Object.assign(v, computeDescriptors(cr, ox, bonds, table, analyses, mobileEl, radius));

  // ---------------- partial RDF ----------------
  const prdf = computePrdf(cr, 8, 0.05);

  for (const d of FEATURE_DEFS) if (d.async && !(d.key in v)) v[d.key] = null;
  return { values: v, sites, hops, prdf, sharing, mobileEl, analyses };
}

export function computePrdf(cr: Crystal, rmax: number, dr: number) {
  const tbl = buildNeighborTable(cr, rmax);
  const nb = Math.round(rmax / dr);
  const hist = new Map<string, Float64Array>();
  const count: Record<string, number> = {};
  for (const p of cr.positions) for (const o of p.occupants) count[cr.sites[o.site].element] = (count[cr.sites[o.site].element] ?? 0) + o.occ;
  const els = Object.keys(count).sort((a, b) => (ELEMENTS[a]?.X ?? 0) - (ELEMENTS[b]?.X ?? 0));
  for (let i = 0; i < els.length; i++) for (let j = i; j < els.length; j++) hist.set(`${els[i]}–${els[j]}`, new Float64Array(nb));
  cr.positions.forEach((p, i) => {
    for (const n of tbl[i]) {
      const bin = Math.floor(n.d / dr);
      if (bin >= nb) continue;
      for (const oa of p.occupants)
        for (const ob of cr.positions[n.j].occupants) {
          const A = cr.sites[oa.site].element,
            B = cr.sites[ob.site].element;
          const ia = els.indexOf(A),
            ib = els.indexOf(B);
          if (ia > ib) continue; // ordered pairs A ≤ B only
          hist.get(`${A}–${B}`)![bin] += oa.occ * ob.occ;
        }
    }
  });
  const V = cr.lattice.volume;
  const out: { pair: string; points: { x: number; y: number }[] }[] = [];
  for (const [pair, h] of hist) {
    const [A, B] = pair.split("–");
    const norm = V / (count[A] * count[B]);
    // gaussian smoothing (σ = dr)
    const g = new Float64Array(nb);
    for (let k = 0; k < nb; k++) {
      const r = (k + 0.5) * dr;
      g[k] = (h[k] * norm) / (4 * Math.PI * r * r * dr);
    }
    const sm: { x: number; y: number }[] = [];
    for (let k = 0; k < nb; k++) {
      let s = 0,
        w = 0;
      for (let q = -3; q <= 3; q++) {
        const kk = k + q;
        if (kk < 0 || kk >= nb) continue;
        const ww = Math.exp((-q * q) / 2);
        s += ww * g[kk];
        w += ww;
      }
      sm.push({ x: +((k + 0.5) * dr).toFixed(3), y: s / w });
    }
    if (sm.some((p) => p.y > 0)) out.push({ pair, points: sm });
  }
  return out;
}

/** Site energies (BVSE, relative to the grid minimum) of mobile positions. */
export function mobileSiteEnergies(cr: Crystal, field: FrameworkField, mobileEl: string, eMinAbs: number) {
  const rows: { pos: number; group: string; E: number }[] = [];
  for (const p of cr.positions) {
    if (!p.occupants.some((o) => cr.sites[o.site].element === mobileEl)) continue;
    const c = toCart(cr.lattice, p.frac);
    rows.push({ pos: p.index, group: p.group, E: field.eval(c[0], c[1], c[2])[0] - eMinAbs });
  }
  return rows;
}
