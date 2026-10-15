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
  /** Flood the grid in the given order; record the value at which the active set first percolates in 1D/2D/3D and along a/b/c. */
  const percolate = (order: Uint32Array, val: (idx: number) => number, stop: (v: number) => boolean): { dim: Triple; axis: Triple } => {
    const uf = new PeriodicUnionFind(N);
    const dim: Triple = [NaN, NaN, NaN];
    const axis: Triple = [NaN, NaN, NaN];
    for (let q = 0; q < order.length; q++) {
      const idx = order[q];
      const v = val(idx);
      if (stop(v)) break;
      uf.make(idx);
      for (const [nb, s] of neighbors(idx)) {
        if (!uf.active(nb)) continue;
        const before = uf.maxRank;
        uf.union(idx, nb, s);
        if (uf.maxRank > before) for (let d = before; d < uf.maxRank; d++) if (Number.isNaN(dim[d])) dim[d] = v;
        for (let k = 0; k < 3; k++) if (uf.axes[k] && Number.isNaN(axis[k])) axis[k] = v;
      }
      if (uf.maxRank === 3) break;
    }
    return { dim, axis };
  };

  const sortBy = (arr: Float32Array, asc: boolean) => {
    const idx = new Uint32Array(N);
    for (let i = 0; i < N; i++) idx[i] = i;
    return idx.sort(asc ? (x, y) => arr[x] - arr[y] : (x, y) => arr[y] - arr[x]);
  };

  let E: Triple = [Infinity, Infinity, Infinity];
  let Eaxis: Triple = [Infinity, Infinity, Infinity];
  const energyCurve: { x: number; y: number }[] = [];
  if (energy) {
    const ord = sortBy(energy, true);
    const p = percolate(ord, (i) => energy[i], (v) => v > opts.eCap);
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
  return { n, resolution: res, energy, voids, eMinAbs, E, R, Eaxis, Raxis, maxVoid, energyCurve, voidCurve, setup: field.setup };
}
