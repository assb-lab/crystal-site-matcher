import { ConvexHull } from "three/examples/jsm/math/ConvexHull.js";
import { Vector3 } from "three";
import { BV_PARAMS, SHANNON, ShannonEntry, roman } from "./data";
import { classifyShape, ShapeFit } from "./shape";
import { Crystal, Neighbor, Vec3, cross, dot, norm, sub } from "./structure";
import { BondTable } from "./bonding";

export type RadiusKind = "ionic" | "crystal";
export type RadiusMethod = "exact" | "interp" | "extrap" | "subst";

export interface RadiusResult {
  r: number;
  cn: number; // requested CN
  exact: boolean;
  method: RadiusMethod;
  note: string; // how the value was obtained
  spin: "" | "HS" | "LS";
  cnLabel: string;
}

const BV_B = 0.37;

/** Shannon radius of an ion at a given CN; interpolates/extrapolates when that CN is not tabulated. */
export function shannonRadius(
  el: string,
  ox: number,
  cn: number,
  opts: { kind: RadiusKind; spin?: "" | "HS" | "LS"; square?: boolean },
): RadiusResult | null {
  if (!Number.isInteger(ox) || cn <= 0) return null;
  const all = SHANNON.filter((s) => s.el === el && s.ox === ox);
  if (all.length === 0) return null;
  const val = (e: ShannonEntry) => (opts.kind === "ionic" ? e.ionic : e.crystal);
  const wantSpin = opts.spin ?? "";
  // pick one entry per CN
  const byCn = new Map<number, ShannonEntry>();
  for (const e of all) {
    const cur = byCn.get(e.cn);
    const score = (x: ShannonEntry) =>
      (wantSpin ? (x.spin === wantSpin ? 0 : x.spin === "" ? 1 : 3) : x.spin === "HS" || x.spin === "" ? 0 : 2) +
      (opts.square ? (x.cnLabel.endsWith("SQ") ? 0 : 1) : x.cnLabel.endsWith("SQ") || x.cnLabel.endsWith("PY") ? 1 : 0);
    if (!cur || score(e) < score(cur)) byCn.set(e.cn, e);
  }
  const cns = [...byCn.keys()].sort((a, b) => a - b);
  const exact = byCn.get(cn);
  if (exact) return { r: val(exact), cn, exact: true, method: "exact", note: `CN ${exact.cnLabel}`, spin: exact.spin, cnLabel: exact.cnLabel };
  const lo = cns.filter((c) => c < cn),
    hi = cns.filter((c) => c > cn);
  const ent = (c: number) => byCn.get(c)!;
  if (lo.length && hi.length) {
    const a = lo[lo.length - 1],
      b = hi[0];
    const r = val(ent(a)) + ((val(ent(b)) - val(ent(a))) * (cn - a)) / (b - a);
    return { r, cn, exact: false, method: "interp", note: `CN ${roman(a)}–${roman(b)} の内挿`, spin: ent(a).spin || ent(b).spin, cnLabel: roman(cn) };
  }
  const side = lo.length ? lo.slice(-2) : hi.slice(0, 2);
  if (side.length === 2) {
    const [a, b] = side;
    const slope = (val(ent(b)) - val(ent(a))) / (b - a);
    const ref = lo.length ? b : a;
    const r = val(ent(ref)) + slope * (cn - ref);
    return { r, cn, exact: false, method: "extrap", note: `CN ${roman(a)}, ${roman(b)} からの外挿`, spin: ent(ref).spin, cnLabel: roman(cn) };
  }
  const only = ent(side[0]);
  return { r: val(only), cn, exact: false, method: "subst", note: `CN ${only.cnLabel} の値で代用`, spin: only.spin, cnLabel: only.cnLabel };
}

/** Bond-valence R0 from Brese & O'Keeffe (1991) element parameters. */
export function bvR0(a: string, b: string): number | null {
  const pa = BV_PARAMS[a],
    pb = BV_PARAMS[b];
  if (!pa || !pb) return null;
  const [r1, c1] = pa,
    [r2, c2] = pb;
  return r1 + r2 - (r1 * r2 * (Math.sqrt(c1) - Math.sqrt(c2)) ** 2) / (c1 * r1 + c2 * r2);
}

export interface LigandSpecies {
  el: string;
  ox: number;
  occ: number;
  label: string;
}

export interface LigandInfo {
  nb: Neighbor;
  species: LigandSpecies[];
  label: string; // group key of the ligand position
  cn: number; // coordination number of the ligand itself
  r: number | null; // occupancy-weighted Shannon radius of the ligand
  rNote: string;
}

export interface SiteAnalysis {
  pos: number;
  group: string;
  host: { site: number; el: string; ox: number; label: string };
  cn: number;
  ligands: LigandInfo[];
  dMean: number;
  dMin: number;
  dMax: number;
  distortion: number; // Baur distortion index
  econ: number;
  volume: number | null;
  shapes: ShapeFit[];
  qe: number | null; // quadratic elongation (CN4/CN6)
  bav: number | null; // bond angle variance (deg²)
  rLigandMean: number | null;
  rSite: number | null; // mean(d_i − r_X,i): radius of the cavity
  rHost: RadiusResult | null;
  bvsHost: number | null;
  kind: RadiusKind;
}

export interface AnalyzeOpts {
  kind: RadiusKind;
  hostSite?: number;
  hostSpin?: "" | "HS" | "LS";
}

export function polyhedronVolume(verts: Vec3[]): number | null {
  if (verts.length < 4) return null;
  try {
    const hull = new ConvexHull().setFromPoints(verts.map((v) => new Vector3(v[0], v[1], v[2])));
    const c = verts.reduce((s, v) => [s[0] + v[0] / verts.length, s[1] + v[1] / verts.length, s[2] + v[2] / verts.length] as Vec3, [0, 0, 0] as Vec3);
    let vol = 0;
    for (const face of hull.faces) {
      const pts: Vec3[] = [];
      let e = face.edge;
      do {
        const p = e.head().point;
        pts.push([p.x, p.y, p.z]);
        e = e.next;
      } while (e !== face.edge);
      for (let i = 1; i + 1 < pts.length; i++) vol += Math.abs(dot(sub(pts[0], c), cross(sub(pts[i], c), sub(pts[i + 1], c)))) / 6;
    }
    return vol > 1e-6 ? vol : null;
  } catch {
    return null;
  }
}

function angleDeg(a: Vec3, b: Vec3) {
  return (Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) * 180) / Math.PI;
}

export function econOf(ds: number[]): number {
  if (ds.length === 0) return 0;
  let lav = Math.min(...ds);
  for (let k = 0; k < 30; k++) {
    let sw = 0,
      swd = 0;
    for (const d of ds) {
      const w = Math.exp(1 - (d / lav) ** 6);
      sw += w;
      swd += w * d;
    }
    const n = swd / sw;
    if (Math.abs(n - lav) < 1e-7) break;
    lav = n;
  }
  return ds.reduce((s, d) => s + Math.exp(1 - (d / lav) ** 6), 0);
}

export function analyzeSite(cr: Crystal, ox: Record<string, number>, bonds: BondTable, pos: number, opts: AnalyzeOpts): SiteAnalysis {
  const P = cr.positions[pos];
  const hostSite = opts.hostSite !== undefined && P.occupants.some((o) => o.site === opts.hostSite) ? opts.hostSite : P.main;
  const hs = cr.sites[hostSite];
  const host = { site: hostSite, el: hs.element, ox: ox[hs.label] ?? 0, label: hs.label };
  const ligNb = bonds.bonded[pos];
  const cn = ligNb.length;

  const ligands: LigandInfo[] = ligNb.map((nb) => {
    const Q = cr.positions[nb.j];
    const species = Q.occupants.map((o) => ({ el: cr.sites[o.site].element, ox: ox[cr.sites[o.site].label] ?? 0, occ: o.occ, label: cr.sites[o.site].label }));
    const lcn = bonds.bonded[nb.j].length;
    let rs = 0,
      ws = 0;
    const notes: string[] = [];
    for (const s of species) {
      const rr = shannonRadius(s.el, s.ox, lcn, { kind: opts.kind });
      if (rr) {
        rs += rr.r * s.occ;
        ws += s.occ;
        if (!rr.exact) notes.push(rr.note);
      }
    }
    return { nb, species, label: Q.group, cn: lcn, r: ws > 0 ? rs / ws : null, rNote: notes.join(", ") };
  });

  const ds = ligNb.map((n) => n.d);
  const dMean = cn ? ds.reduce((a, b) => a + b, 0) / cn : 0;
  const distortion = cn ? ds.reduce((s, d) => s + Math.abs(d - dMean), 0) / cn / dMean : 0;
  const elig = bonds.eligible[pos];
  const dmin = elig.length ? elig[0].d : 0;
  const econ = econOf(elig.filter((n) => n.d < dmin * 1.6).map((n) => n.d));
  const verts = ligNb.map((n) => n.v);
  const volume = polyhedronVolume(verts);
  const shapes = cn >= 1 && cn <= 13 ? classifyShape(verts) : [];

  let qe: number | null = null,
    bav: number | null = null;
  if (volume && (cn === 6 || cn === 4)) {
    const l0 = cn === 6 ? Math.cbrt((3 * volume) / 4) : Math.cbrt((volume * 9 * Math.sqrt(3)) / 8);
    qe = ds.reduce((s, d) => s + (d / l0) ** 2, 0) / cn;
    const angles: number[] = [];
    for (let i = 0; i < cn; i++) for (let j = i + 1; j < cn; j++) angles.push(angleDeg(verts[i], verts[j]));
    angles.sort((a, b) => a - b);
    if (cn === 6) {
      const cis = angles.slice(0, 12);
      bav = cis.reduce((s, a) => s + (a - 90) ** 2, 0) / 11;
    } else {
      const t0 = (Math.acos(-1 / 3) * 180) / Math.PI;
      bav = angles.reduce((s, a) => s + (a - t0) ** 2, 0) / 5;
    }
  }

  const square = shapes[0]?.sym === "S:4";
  const rHost = shannonRadius(host.el, host.ox, cn, { kind: opts.kind, spin: opts.hostSpin, square });
  let rSite: number | null = null;
  let rLigandMean: number | null = null;
  if (cn > 0 && ligands.every((l) => l.r !== null)) {
    rLigandMean = ligands.reduce((s, l) => s + (l.r as number), 0) / cn;
    rSite = ligands.reduce((s, l) => s + (l.nb.d - (l.r as number)), 0) / cn;
  }
  const bvsHost = bondValenceSum(host.el, ligands);

  return {
    pos,
    group: P.group,
    host,
    cn,
    ligands,
    dMean,
    dMin: cn ? Math.min(...ds) : 0,
    dMax: cn ? Math.max(...ds) : 0,
    distortion,
    econ,
    volume,
    shapes,
    qe,
    bav,
    rLigandMean,
    rSite,
    rHost,
    bvsHost,
    kind: opts.kind,
  };
}

export function bondValenceSum(el: string, ligands: LigandInfo[]): number | null {
  if (ligands.length === 0) return null;
  // Each bond is weighted by the occupancy of the ligand site (expected bond valence),
  // so partially occupied / vacancy-rich neighbour sites are not over-counted.
  let v = 0;
  for (const l of ligands) {
    for (const sp of l.species) {
      const r0 = bvR0(el, sp.el);
      if (r0 === null) return null;
      v += Math.min(1, sp.occ) * Math.exp((r0 - l.nb.d) / BV_B);
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// Substitution scoring
// ---------------------------------------------------------------------------

export interface ScoreOpts {
  sizeTol: number; // fractional radius mismatch treated as 1σ (e.g. 0.15)
  useBVS: boolean;
  useCharge: boolean;
}

export interface Candidate {
  el: string;
  ox: number;
  spin: "" | "HS" | "LS";
}

export interface CandidateResult extends Candidate {
  key: string;
  radius: RadiusResult;
  dSite: number | null; // (r_M − r_site)/r_site
  dHost: number | null; // (r_M − r_host)/r_host
  dPred: number | null; // predicted mean bond length
  bvs: number | null;
  bvsRatio: number | null; // BVS / |ox|
  dq: number;
  rho: number | null; // radius ratio r_M / r_X
  rhoOk: boolean | null;
  sSize: number;
  sBVS: number | null;
  sCharge: number;
  score: number;
  verdict: Verdict;
}

export type Verdict = "good" | "possible" | "hard" | "unlikely";

export const VERDICT_LABEL: Record<Verdict, string> = {
  good: "入りやすい",
  possible: "可能性あり",
  hard: "条件次第",
  unlikely: "困難",
};

const PAULING: Record<number, [number, number]> = {
  2: [0, 0.155],
  3: [0.155, 0.225],
  4: [0.225, 0.414],
  6: [0.414, 0.732],
  8: [0.732, 1.0],
  12: [1.0, Infinity],
};
export function paulingRange(cn: number): [number, number] | null {
  return PAULING[cn] ?? null;
}

export function chargePenalty(dq: number): number {
  const a = Math.abs(dq);
  return a === 0 ? 1 : a === 1 ? 0.75 : a === 2 ? 0.5 : 0.3;
}

export function evaluateCandidate(site: SiteAnalysis, c: Candidate, opts: ScoreOpts): CandidateResult | null {
  const square = site.shapes[0]?.sym === "S:4";
  const radius = shannonRadius(c.el, c.ox, site.cn, { kind: site.kind, spin: c.spin, square });
  if (!radius) return null;
  const rM = radius.r;
  const dSite = site.rSite && site.rSite > 0 ? (rM - site.rSite) / site.rSite : null;
  const dHost = site.rHost ? (rM - site.rHost.r) / site.rHost.r : null;
  const dPred = site.rLigandMean !== null ? rM + site.rLigandMean : null;
  const bvs = bondValenceSum(c.el, site.ligands);
  const bvsRatio = bvs !== null && c.ox !== 0 ? bvs / Math.abs(c.ox) : null;
  const dq = c.ox - site.host.ox;
  const rho = site.rLigandMean ? rM / site.rLigandMean : null;
  const pr = paulingRange(site.cn);
  const rhoOk = rho !== null && pr ? rho >= pr[0] && rho <= pr[1] : null;

  const mismatch = dSite ?? dHost ?? 0;
  const sSize = Math.exp(-0.5 * (mismatch / opts.sizeTol) ** 2);
  const sBVS = bvsRatio !== null ? Math.exp(-0.5 * ((bvsRatio - 1) / 0.25) ** 2) : null;
  const sCharge = chargePenalty(dq);
  // weighted geometric mean
  let wSum = 0.6,
    logS = 0.6 * Math.log(Math.max(sSize, 1e-6));
  if (opts.useBVS && sBVS !== null) {
    wSum += 0.25;
    logS += 0.25 * Math.log(Math.max(sBVS, 1e-6));
  }
  if (opts.useCharge) {
    wSum += 0.15;
    logS += 0.15 * Math.log(sCharge);
  }
  const score = 100 * Math.exp(logS / wSum);
  const verdict: Verdict = score >= 75 ? "good" : score >= 50 ? "possible" : score >= 25 ? "hard" : "unlikely";
  return { ...c, key: candKey(c), radius, dSite, dHost, dPred, bvs, bvsRatio, dq, rho, rhoOk, sSize, sBVS, sCharge, score, verdict };
}

export const candKey = (c: Candidate) => `${c.el}${c.ox}${c.spin}`;

/** All Shannon ions with the same charge sign as the host. */
export function allCandidates(hostOx: number): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  const sign = Math.sign(hostOx) || 1;
  for (const s of SHANNON) {
    if (Math.sign(s.ox) !== sign) continue;
    const c: Candidate = { el: s.el, ox: s.ox, spin: s.spin };
    const k = candKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  // an ion with both HS and LS entries also gets the spin-free entries merged into HS rows; drop "" duplicates
  return out.filter((c) => !(c.spin === "" && out.some((d) => d.el === c.el && d.ox === c.ox && d.spin !== "")));
}

export function spinsFor(el: string, ox: number): ("" | "HS" | "LS")[] {
  const s = new Set(SHANNON.filter((x) => x.el === el && x.ox === ox).map((x) => x.spin));
  if (s.has("HS") || s.has("LS")) return (["HS", "LS"] as const).filter((v) => s.has(v));
  return s.size ? [""] : [];
}

export function chargesFor(el: string): number[] {
  return [...new Set(SHANNON.filter((x) => x.el === el).map((x) => x.ox))].sort((a, b) => a - b);
}
