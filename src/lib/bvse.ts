// Bond-valence site energy (BVSE) and void-space fields for a mobile ion, on a grid
// spanning the unit cell, plus percolation analysis (1D/2D/3D thresholds).
//
// Energy model (same as BVlain / softBV, Chen & Adams 2017; Chen, Wong & Adams 2019):
//   E = Σ_counter-ions  D0/2 · [(exp(α(Rmin − r)) − 1)² − 1]
//     + Σ_same-sign ions 14.4 · q_m q_i / √(n_m n_i) · erfc(r / (f (rc_m + rc_i))) / r ,  f = 0.74
// Partial occupancies are applied as weights (mean-field), which is an approximation.

import bvseRaw from "../data/bvse.json";
import { ELEMENTS } from "./data";
import { PeriodicUnionFind } from "./percolation";
import { Crystal, Vec3, toCart } from "./structure";

interface BvseData {
  mobile: Record<string, Record<string, [number, number, number]>>;
  n: Record<string, number>;
  rc: Record<string, number>;
}
const BVSE = bvseRaw as unknown as BvseData;

export const ionKey = (el: string, q: number) => `${el}${q > 0 ? "+" : ""}${Math.round(q)}`;

export function bvseSupported(el: string, q: number): boolean {
  return !!BVSE.mobile[ionKey(el, q)];
}

function erfc(x: number): number {
  // Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7), x ≥ 0
  const t = 1 / (1 + 0.3275911 * x);
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return y * Math.exp(-x * x);
}

export interface FieldIon {
  x: number;
  y: number;
  z: number;
  kind: 0 | 1; // 0: Morse (counter-ion), 1: Coulomb (same sign)
  a: number; // Morse: Rmin   | Coulomb: prefactor 14.4 q_m q_i /√(n_m n_i) · occ
  b: number; // Morse: alpha  | Coulomb: 1 / (f (rc_m + rc_i))
  c: number; // Morse: d0/2 · occ
  r: number; // ionic radius for void-space distance
  occ: number;
}

export interface FieldSetup {
  mobileEl: string;
  mobileQ: number;
  missing: string[]; // counter-ions without softBV parameters
  hasEnergy: boolean;
}

/** Framework ions (everything except the mobile species) with their parameters, and fast spatial lookup. */
export class FrameworkField {
  ions: FieldIon[] = [];
  setup: FieldSetup;
  private binSize: number;
  private bins = new Map<string, number[]>();
  private rcut: number;

  constructor(cr: Crystal, ox: Record<string, number>, mobileEl: string, ionicRadius: (pos: number, site: number) => number, rcut = 8) {
    this.rcut = rcut;
    this.binSize = rcut / 2;
    const mobileSites = cr.sites.filter((s) => s.element === mobileEl);
    const qm = mobileSites.length ? (ox[mobileSites[0].label] ?? 0) : 0;
    const table = BVSE.mobile[ionKey(mobileEl, qm)];
    const nm = BVSE.n[mobileEl] ?? 2;
    const rcm = BVSE.rc[ionKey(mobileEl, qm)] ?? ELEMENTS[mobileEl]?.r ?? 1;
    const missing = new Set<string>();
    const L = cr.lattice;
    const ns = L.recip.map((r) => Math.ceil(rcut * r) + 1);
    const base: Omit<FieldIon, "x" | "y" | "z">[] = [];
    const fracs: Vec3[] = [];
    for (const p of cr.positions)
      for (const o of p.occupants) {
        const s = cr.sites[o.site];
        if (s.element === mobileEl) continue;
        const q = ox[s.label] ?? 0;
        if (q === 0 || qm === 0) continue;
        const r = ionicRadius(p.index, o.site);
        if (q * qm < 0) {
          const prm = table?.[ionKey(s.element, q)];
          if (!prm) {
            missing.add(ionKey(s.element, q));
            base.push({ kind: 0, a: 0, b: 0, c: 0, r, occ: o.occ });
          } else base.push({ kind: 0, a: prm[0], b: prm[1], c: (prm[2] / 2) * o.occ, r, occ: o.occ });
        } else {
          const n = BVSE.n[s.element] ?? 2;
          const rc = BVSE.rc[ionKey(s.element, q)] ?? ELEMENTS[s.element]?.r ?? 1;
          base.push({ kind: 1, a: ((14.4 * qm * q) / Math.sqrt(nm * n)) * o.occ, b: 1 / (0.74 * (rcm + rc)), c: 0, r, occ: o.occ });
        }
        fracs.push(p.frac);
      }
    // periodic images covering the cell plus rcut
    for (let t0 = -ns[0]; t0 <= ns[0]; t0++)
      for (let t1 = -ns[1]; t1 <= ns[1]; t1++)
        for (let t2 = -ns[2]; t2 <= ns[2]; t2++)
          base.forEach((b, i) => {
            const f = fracs[i];
            const g: Vec3 = [f[0] + t0, f[1] + t1, f[2] + t2];
            const lo = (v: number, r: number) => v >= -rcut * r - 1e-9 && v <= 1 + rcut * r + 1e-9;
            if (!lo(g[0], L.recip[0]) || !lo(g[1], L.recip[1]) || !lo(g[2], L.recip[2])) return;
            const c = toCart(L, g);
            this.ions.push({ ...b, x: c[0], y: c[1], z: c[2] });
          });
    this.ions.forEach((ion, idx) => {
      const k = this.key(ion.x, ion.y, ion.z);
      const l = this.bins.get(k);
      if (l) l.push(idx);
      else this.bins.set(k, [idx]);
    });
    this.setup = { mobileEl, mobileQ: qm, missing: [...missing], hasEnergy: !!table && qm !== 0 };
  }

  private key(x: number, y: number, z: number) {
    return `${Math.floor(x / this.binSize)},${Math.floor(y / this.binSize)},${Math.floor(z / this.binSize)}`;
  }

  /**
   * Closest approach of the straight segment A→B to the framework ions (exact, not sampled).
   * - clearance: min over ions of (distance from the ion centre to the segment − ionic radius);
   *   negative when the segment enters an ion sphere.
   * - at: point on the segment where the clearance is smallest.
   * - core: min over ions of (distance to the segment / ionic radius); below ~0.5 the segment runs
   *   through the ion itself rather than squeezing past its surface.
   */
  segment(A: Vec3, B: Vec3): { clearance: number; at: Vec3; core: number } {
    const AB: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const L2 = AB[0] * AB[0] + AB[1] * AB[1] + AB[2] * AB[2] || 1e-12;
    let rMax = 0;
    for (const ion of this.ions) if (ion.r > rMax) rMax = ion.r;
    const pad = rMax + 0.5;
    const lo = (i: number) => Math.floor((Math.min(A[i], B[i]) - pad) / this.binSize);
    const hi = (i: number) => Math.floor((Math.max(A[i], B[i]) + pad) / this.binSize);
    let clearance = Infinity,
      core = Infinity,
      at: Vec3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    for (let i = lo(0); i <= hi(0); i++)
      for (let j = lo(1); j <= hi(1); j++)
        for (let k = lo(2); k <= hi(2); k++) {
          const l = this.bins.get(`${i},${j},${k}`);
          if (!l) continue;
          for (const idx of l) {
            const ion = this.ions[idx];
            const cx = ion.x - A[0],
              cy = ion.y - A[1],
              cz = ion.z - A[2];
            const t = Math.max(0, Math.min(1, (cx * AB[0] + cy * AB[1] + cz * AB[2]) / L2));
            const P: Vec3 = [A[0] + AB[0] * t, A[1] + AB[1] * t, A[2] + AB[2] * t];
            const d = Math.hypot(ion.x - P[0], ion.y - P[1], ion.z - P[2]);
            if (d - ion.r < clearance) {
              clearance = d - ion.r;
              at = P;
            }
            if (ion.r > 0 && d / ion.r < core) core = d / ion.r;
          }
        }
    return { clearance, at, core };
  }

  /**
   * Widest path from A to B with one bend (#62): the bend point P maximises
   * min(clearance(A→P), clearance(P→B)) inside the sphere with diameter AB, so the path is at most √2·|AB|
   * long and stays local to the hop. P = midpoint is the straight line, so the result is never narrower.
   * Starting points are the midpoint and the best few points of a 0.25 Å grid (at least 0.5 Å apart); each is refined by
   * ε-steepest ascent of the max–min problem (see `ascend`). The clearance of each leg is exact.
   * - clearance: free radius of the path (negative when every such path enters an ion sphere).
   * - at: point of the path where the clearance is smallest.
   * - via: the bend point.
   */
  bentPath(A: Vec3, B: Vec3): { clearance: number; at: Vec3; via: Vec3 } {
    const M: Vec3 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
    const R = Math.hypot(B[0] - A[0], B[1] - A[1], B[2] - A[2]) / 2;
    // Every path starts at A and ends at B, so the result is at most the clearance of the two ends. Ions
    // farther than that from every point of the sphere cannot limit the path.
    let rMax = 0;
    for (const ion of this.ions) if (ion.r > rMax) rMax = ion.r;
    const cap = Math.max(0, Math.min(this.segment(A, A).clearance, this.segment(B, B).clearance)) + 1e-6;
    const near: FieldIon[] = [];
    // No ion within the binned reach of an end (e.g. a metal-rich cell with a sparse framework): the cap is
    // infinite and the bin range unbounded, so every ion is a candidate instead.
    if (!Number.isFinite(cap)) near.push(...this.ions);
    const lo = (i: number) => Math.floor((M[i] - R - cap - rMax) / this.binSize);
    const hi = (i: number) => Math.floor((M[i] + R + cap + rMax) / this.binSize);
    if (Number.isFinite(cap))
      for (let i = lo(0); i <= hi(0); i++)
        for (let j = lo(1); j <= hi(1); j++)
          for (let k = lo(2); k <= hi(2); k++)
            for (const idx of this.bins.get(`${i},${j},${k}`) ?? []) {
              const ion = this.ions[idx];
              if (Math.hypot(ion.x - M[0], ion.y - M[1], ion.z - M[2]) - ion.r - R <= cap) near.push(ion);
            }
    const path = new BentPath(A, B, M, R, near);
    const STEP = 0.25;
    const n = Math.floor(R / STEP);
    const grid: { P: Vec3; v: number }[] = [{ P: M, v: path.value(M) }];
    for (let i = -n; i <= n; i++)
      for (let j = -n; j <= n; j++)
        for (let k = -n; k <= n; k++) {
          if (!i && !j && !k) continue;
          const P: Vec3 = [M[0] + i * STEP, M[1] + j * STEP, M[2] + k * STEP];
          if (path.inside(P)) grid.push({ P, v: path.value(P) });
        }
    grid.sort((x, y) => y.v - x.v);
    // the straight line is always refined; equivalent hops then agree even when the grid falls differently
    const starts: Vec3[] = [M];
    for (const g of grid) {
      if (starts.length >= 5) break;
      if (starts.every((s) => Math.hypot(s[0] - g.P[0], s[1] - g.P[1], s[2] - g.P[2]) >= 0.5)) starts.push(g.P);
    }
    let best = { P: M, v: grid.find((g) => g.P === M)!.v };
    for (const s of starts) {
      const r = path.ascend(s);
      if (r.v > best.v + 1e-12) best = r;
    }
    const [c1, at1] = path.leg(A, best.P);
    const [c2, at2] = path.leg(best.P, B);
    return { clearance: Math.min(c1, c2), at: c1 <= c2 ? at1 : at2, via: best.P };
  }

  /** Returns [energy (eV), void distance (Å)] at a Cartesian point. */
  eval(x: number, y: number, z: number): [number, number] {
    const bx = Math.floor(x / this.binSize),
      by = Math.floor(y / this.binSize),
      bz = Math.floor(z / this.binSize);
    const rc2 = this.rcut * this.rcut;
    let e = 0,
      v = Infinity;
    for (let i = bx - 2; i <= bx + 2; i++)
      for (let j = by - 2; j <= by + 2; j++)
        for (let k = bz - 2; k <= bz + 2; k++) {
          const l = this.bins.get(`${i},${j},${k}`);
          if (!l) continue;
          for (const idx of l) {
            const ion = this.ions[idx];
            const dx = ion.x - x,
              dy = ion.y - y,
              dz = ion.z - z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 > rc2) continue;
            const d = Math.sqrt(d2) || 1e-6;
            const vd = d - ion.r;
            if (vd < v) v = vd;
            if (ion.kind === 0) {
              if (ion.c) {
                const t = Math.exp(ion.b * (ion.a - d)) - 1;
                e += ion.c * (t * t - 1);
              }
            } else e += (ion.a / d) * erfc(d * ion.b);
          }
        }
    return [e, v];
  }
}

/** Energy above E_1D (eV) at which the connected low-energy volume is measured. */
export const CONN_DE = 0.2;

export interface GridResult {
  n: Vec3;
  resolution: number;
  energy: Float32Array | null; // relative to the minimum (eV)
  voids: Float32Array; // distance to nearest framework ion surface (Å)
  eMinAbs: number;
  E: [number, number, number]; // percolation energies 1D/2D/3D (Infinity if none below cap)
  R: [number, number, number]; // percolation radii 1D/2D/3D (NaN if none)
  Eaxis: [number, number, number]; // percolation energies along a / b / c (Infinity if none below cap)
  Raxis: [number, number, number]; // percolation radii along a / b / c (NaN if none)
  /** At E_1D + CONN_DE: volume fraction below that energy, and the part of it in clusters that wrap the cell (null without 1D) */
  conn: { low: number; connected: number } | null;
  maxVoid: number;
  energyCurve: { x: number; y: number }[]; // ΔE → accessible volume fraction
  voidCurve: { x: number; y: number }[]; // probe radius → accessible volume fraction
  setup: FieldSetup;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function computeGrid(
  field: FrameworkField,
  cr: Crystal,
  opts: { resolution: number; maxPoints: number; eCap: number },
  onProgress?: (f: number) => void,
  isCancelled?: () => boolean,
): Promise<GridResult | null> {
  const L = cr.lattice;
  let res = opts.resolution;
  let n: Vec3 = [0, 0, 0];
  for (;;) {
    n = [Math.max(6, Math.round(L.a / res)), Math.max(6, Math.round(L.b / res)), Math.max(6, Math.round(L.c / res))];
    if (n[0] * n[1] * n[2] <= opts.maxPoints) break;
    res *= 1.1;
  }
  const N = n[0] * n[1] * n[2];
  const energy = field.setup.hasEnergy ? new Float32Array(N) : null;
  const voids = new Float32Array(N);
  const chunk = 3000;
  for (let start = 0; start < N; start += chunk) {
    const end = Math.min(N, start + chunk);
    for (let idx = start; idx < end; idx++) {
      const i = idx % n[0],
        j = Math.floor(idx / n[0]) % n[1],
        k = Math.floor(idx / (n[0] * n[1]));
      const c = toCart(L, [i / n[0], j / n[1], k / n[2]]);
      const [e, v] = field.eval(c[0], c[1], c[2]);
      if (energy) energy[idx] = e;
      voids[idx] = v;
    }
    onProgress?.(end / N);
    await tick();
    if (isCancelled?.()) return null;
  }

  let eMinAbs = 0;
  if (energy) {
    eMinAbs = Infinity;
    for (let i = 0; i < N; i++) if (energy[i] < eMinAbs) eMinAbs = energy[i];
    for (let i = 0; i < N; i++) energy[i] -= eMinAbs;
  }

  const neighbors = (idx: number): [number, Vec3][] => {
    const i = idx % n[0],
      j = Math.floor(idx / n[0]) % n[1],
      k = Math.floor(idx / (n[0] * n[1]));
    const out: [number, Vec3][] = [];
    const push = (ii: number, jj: number, kk: number) => {
      const s: Vec3 = [Math.floor(ii / n[0]), Math.floor(jj / n[1]), Math.floor(kk / n[2])];
      const wi = ii - s[0] * n[0],
        wj = jj - s[1] * n[1],
        wk = kk - s[2] * n[2];
      out.push([wi + n[0] * (wj + n[1] * wk), s]);
    };
    push(i + 1, j, k);
    push(i - 1, j, k);
    push(i, j + 1, k);
    push(i, j - 1, k);
    push(i, j, k + 1);
    push(i, j, k - 1);
    return out;
  };

  type Triple = [number, number, number];
  /**
   * Flood the grid in the given order; record the value at which the active set first percolates in 1D/2D/3D and along a/b/c.
   * With `connDelta`, also measure the active volume once the value passes the 1D threshold by that much.
   */
  const percolate = (order: Uint32Array, val: (idx: number) => number, stop: (v: number) => boolean, connDelta?: number) => {
    const uf = new PeriodicUnionFind(N);
    const dim: Triple = [NaN, NaN, NaN];
    const axis: Triple = [NaN, NaN, NaN];
    let conn: GridResult["conn"] = null;
    /** the first q nodes of `order` are active: their volume fraction and the part in wrapping (rank ≥ 1) clusters */
    const measure = (q: number) => {
      let wrapped = 0;
      for (let r = 0; r < q; r++) if (uf.basis.get(uf.find(order[r])[0])?.length) wrapped++;
      return { low: q / N, connected: wrapped / N };
    };
    let q = 0;
    for (; q < order.length; q++) {
      const idx = order[q];
      const v = val(idx);
      if (connDelta !== undefined && !conn && !Number.isNaN(dim[0]) && v > dim[0] + connDelta) conn = measure(q);
      const beyondCap = stop(v);
      // The threshold search is capped, but its volume measurement may lie above the cap.
      if (beyondCap && (connDelta === undefined || conn !== null || Number.isNaN(dim[0]))) break;
      if (uf.maxRank === 3 && (connDelta === undefined || conn)) break;
      uf.make(idx);
      for (const [nb, s] of neighbors(idx)) {
        if (!uf.active(nb)) continue;
        const before = uf.maxRank;
        uf.union(idx, nb, s);
        if (!beyondCap && uf.maxRank > before) for (let d = before; d < uf.maxRank; d++) if (Number.isNaN(dim[d])) dim[d] = v;
        for (let k = 0; k < 3; k++) if (!beyondCap && uf.axes[k] && Number.isNaN(axis[k])) axis[k] = v;
      }
    }
    if (connDelta !== undefined && !conn && !Number.isNaN(dim[0])) conn = measure(q);
    return { dim, axis, conn };
  };

  const sortBy = (arr: Float32Array, asc: boolean) => {
    const idx = new Uint32Array(N);
    for (let i = 0; i < N; i++) idx[i] = i;
    return idx.sort(asc ? (x, y) => arr[x] - arr[y] : (x, y) => arr[y] - arr[x]);
  };

  let E: Triple = [Infinity, Infinity, Infinity];
  let Eaxis: Triple = [Infinity, Infinity, Infinity];
  let conn: GridResult["conn"] = null;
  const energyCurve: { x: number; y: number }[] = [];
  if (energy) {
    const ord = sortBy(energy, true);
    const p = percolate(ord, (i) => energy[i], (v) => v > opts.eCap, CONN_DE);
    conn = p.conn;
    const inf = (t: Triple) => t.map((v) => (Number.isNaN(v) ? Infinity : v)) as Triple;
    E = inf(p.dim);
    Eaxis = inf(p.axis);
    // a common 0 – eCap range so curves of different structures can be overlaid
    const top = opts.eCap;
    let q = 0;
    for (let s = 0; s <= 120; s++) {
      const x = (top * s) / 120;
      while (q < N && energy[ord[q]] <= x) q++;
      energyCurve.push({ x, y: q / N });
    }
  }
  await tick();
  const ordV = sortBy(voids, false);
  const { dim: R, axis: Raxis } = percolate(ordV, (i) => voids[i], (v) => v < 0);
  const maxVoid = voids[ordV[0]];
  const voidCurve: { x: number; y: number }[] = [];
  {
    let q = 0;
    const top = Math.max(0.2, maxVoid);
    for (let s = 60; s >= 0; s--) {
      const x = (top * s) / 60;
      while (q < N && voids[ordV[q]] >= x) q++;
      voidCurve.unshift({ x, y: q / N });
    }
  }
  return { n, resolution: res, energy, voids, eMinAbs, E, R, Eaxis, Raxis, conn, maxVoid, energyCurve, voidCurve, setup: field.setup };
}

/** Min-norm point of the convex hull of a few 3D vectors, by enumerating its faces (exact). */
function minNormPoint(V: Vec3[]): Vec3 {
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  let best: Vec3 = V[0],
    bn = dot(V[0], V[0]);
  const consider = (p: Vec3) => {
    const pn = dot(p, p);
    if (pn < bn) {
      best = p;
      bn = pn;
    }
  };
  const k = V.length;
  for (let i = 0; i < k; i++) consider(V[i]);
  // edges
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++) {
      const e = sub(V[j], V[i]);
      const ee = dot(e, e);
      if (ee < 1e-24) continue;
      const t = -dot(V[i], e) / ee;
      if (t > 0 && t < 1) consider([V[i][0] + t * e[0], V[i][1] + t * e[1], V[i][2] + t * e[2]]);
    }
  // triangles: projection of the origin onto the plane, kept when it falls inside
  for (let i = 0; i < k; i++)
    for (let j = i + 1; j < k; j++)
      for (let l = j + 1; l < k; l++) {
        const e1 = sub(V[j], V[i]),
          e2 = sub(V[l], V[i]);
        const a = dot(e1, e1),
          b = dot(e1, e2),
          c = dot(e2, e2);
        const det = a * c - b * b;
        if (det < 1e-24) continue;
        const r1 = -dot(V[i], e1),
          r2 = -dot(V[i], e2);
        const u = (c * r1 - b * r2) / det,
          w = (a * r2 - b * r1) / det;
        if (u > 0 && w > 0 && u + w < 1) consider([V[i][0] + u * e1[0] + w * e2[0], V[i][1] + u * e1[1] + w * e2[1], V[i][2] + u * e1[2] + w * e2[2]]);
      }
  // tetrahedra containing the origin
  for (let i = 0; i < k && bn > 0; i++)
    for (let j = i + 1; j < k; j++)
      for (let l = j + 1; l < k; l++)
        for (let m = l + 1; m < k; m++) {
          const e1 = sub(V[j], V[i]),
            e2 = sub(V[l], V[i]),
            e3 = sub(V[m], V[i]);
          const det = e1[0] * (e2[1] * e3[2] - e2[2] * e3[1]) - e1[1] * (e2[0] * e3[2] - e2[2] * e3[0]) + e1[2] * (e2[0] * e3[1] - e2[1] * e3[0]);
          if (Math.abs(det) < 1e-24) continue;
          // Cramer's rule for e1·u + e2·v + e3·w = −V[i]
          const r: Vec3 = [-V[i][0], -V[i][1], -V[i][2]];
          const d3 = (x: Vec3, y: Vec3, z: Vec3) => x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
          const u = d3(r, e2, e3) / det,
            v = d3(e1, r, e3) / det,
            w = d3(e1, e2, r) / det;
          if (u >= 0 && v >= 0 && w >= 0 && u + v + w <= 1) return [0, 0, 0];
        }
  return best;
}

/** The max–min problem of `FrameworkField.bentPath` for one hop: clearance of A→P→B over the nearby ions. */
class BentPath {
  constructor(
    private A: Vec3,
    private B: Vec3,
    private M: Vec3,
    private R: number,
    private near: FieldIon[],
  ) {}

  inside(P: Vec3): boolean {
    return Math.hypot(P[0] - this.M[0], P[1] - this.M[1], P[2] - this.M[2]) <= this.R + 1e-12;
  }

  /** Clearance of the leg P→Q and its narrowest point. */
  leg(P: Vec3, Q: Vec3): [number, Vec3] {
    const d0 = Q[0] - P[0],
      d1 = Q[1] - P[1],
      d2 = Q[2] - P[2];
    const L2 = d0 * d0 + d1 * d1 + d2 * d2 || 1e-12;
    let c = Infinity,
      at: Vec3 = P;
    for (const ion of this.near) {
      const t = Math.max(0, Math.min(1, ((ion.x - P[0]) * d0 + (ion.y - P[1]) * d1 + (ion.z - P[2]) * d2) / L2));
      const x = P[0] + d0 * t,
        y = P[1] + d1 * t,
        z = P[2] + d2 * t;
      const v = Math.hypot(ion.x - x, ion.y - y, ion.z - z) - ion.r;
      if (v < c) {
        c = v;
        at = [x, y, z];
      }
    }
    return [c, at];
  }

  value(P: Vec3): number {
    return Math.min(this.leg(this.A, P)[0], this.leg(P, this.B)[0]);
  }

  /**
   * Clearance of every (ion, leg) pair and its gradient with respect to the bend point P. On a leg the
   * closest point is X = A + t(P − A) (or P + t(B − P)); by the envelope theorem ∂|C − X|/∂P is
   * −t(C − X)/|C − X| (or −(1 − t)(C − X)/|C − X|), zero when the closest point is the fixed end.
   */
  private terms(P: Vec3): { f: number; g: Vec3 }[] {
    const out: { f: number; g: Vec3 }[] = [];
    for (const [S, E, first] of [
      [this.A, P, true],
      [P, this.B, false],
    ] as const) {
      const d0 = E[0] - S[0],
        d1 = E[1] - S[1],
        d2 = E[2] - S[2];
      const L2 = d0 * d0 + d1 * d1 + d2 * d2 || 1e-12;
      for (const ion of this.near) {
        const t = Math.max(0, Math.min(1, ((ion.x - S[0]) * d0 + (ion.y - S[1]) * d1 + (ion.z - S[2]) * d2) / L2));
        const w: Vec3 = [ion.x - (S[0] + d0 * t), ion.y - (S[1] + d1 * t), ion.z - (S[2] + d2 * t)];
        const d = Math.hypot(w[0], w[1], w[2]);
        const s = d > 1e-12 ? -(first ? t : 1 - t) / d : 0;
        out.push({ f: d - ion.r, g: [s * w[0], s * w[1], s * w[2]] });
      }
    }
    return out;
  }

  /**
   * ε-steepest ascent of min_j f_j(P) in the sphere: the step follows the min-norm point of the hull of
   * the gradients of the terms within ε of the minimum (and the inward normal when within ε of the
   * sphere), which raises all of them; ε shrinks when no step helps. It stops at a stationary point
   * (0 in that hull, the KKT condition), to about 1e-9 Å.
   */
  ascend(start: Vec3): { P: Vec3; v: number } {
    let P = start,
      v = this.value(P),
      eps = 0.02,
      step = 0.1;
    for (let iter = 0; iter < 400 && eps > 1e-10; iter++) {
      const T = this.terms(P).sort((x, y) => x.f - y.f);
      const act = T.filter((x) => x.f <= T[0].f + eps).slice(0, 8).map((x) => x.g);
      const off: Vec3 = [P[0] - this.M[0], P[1] - this.M[1], P[2] - this.M[2]];
      const r = Math.hypot(off[0], off[1], off[2]);
      if (r > this.R - eps && r > 0) act.push([-off[0] / r, -off[1] / r, -off[2] / r]);
      const d = minNormPoint(act);
      const nd = Math.hypot(d[0], d[1], d[2]);
      let moved = false;
      if (nd > 1e-12)
        for (let s = step; s > 1e-11; s /= 2) {
          const Q: Vec3 = [P[0] + (s * d[0]) / nd, P[1] + (s * d[1]) / nd, P[2] + (s * d[2]) / nd];
          if (!this.inside(Q)) continue;
          const w = this.value(Q);
          if (w > v + 1e-14) {
            P = Q;
            v = w;
            step = Math.min(0.25, s * 2);
            moved = true;
            break;
          }
        }
      if (!moved) eps /= 4;
    }
    return { P, v };
  }
}
