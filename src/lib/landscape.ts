// Stable sites of the mobile ion on the BVSE landscape: local minima of the energy grid, refined on
// the analytic field, with the Hessian (curvature) at each minimum. Minima far from every CIF
// mobile-ion position are candidate interstitial (unoccupied) sites.
// These are minima of an empirical energy, not proven crystallographic sites, and the curvature is
// not a force constant; both need checking (e.g. by structure relaxation).

import type { FrameworkField, GridResult } from "./bvse";
import { Crystal, Vec3, norm, toCart } from "./structure";

/** Search window above the grid minimum (eV); minima at CIF sites are kept up to this energy. */
export const MINIMA_SEARCH_E = 2.0;
/** Unoccupied minima above this energy (eV over the grid minimum) are not reported as interstitial candidates. */
export const INTERSTITIAL_E_MAX = 1.0;
/** Minima closer than this (Å) are one site (the lower one is kept). */
export const MINIMA_MERGE = 0.5;
/**
 * A minimum within this distance (Å) of a CIF mobile-ion position is that site (possibly split or
 * displaced, e.g. the Li2 minima 0.8 Å above and below the Li₂N layer of Li₃N).
 */
export const SITE_MATCH = 1.0;
/** Finite-difference step (Å) for gradients and Hessians on the field. */
const FD = 0.04;

export interface EnergyMinimum {
  frac: Vec3; // wrapped to [0, 1)
  cart: Vec3;
  E: number; // eV above the grid minimum
  curvature: Vec3; // Hessian eigenvalues (eV/Å²), ascending
  occupied: boolean; // at a CIF mobile-ion position
  nearest: { group: string; d: number } | null; // closest CIF mobile-ion position
}

/** Eigenvalues of a symmetric 3×3 matrix (cyclic Jacobi), ascending. */
export function symEig3(m: number[][]): Vec3 {
  const a = m.map((r) => r.slice());
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = a[0][1] ** 2 + a[0][2] ** 2 + a[1][2] ** 2;
    if (off < 1e-20) break;
    for (const [p, q] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ]) {
      if (Math.abs(a[p][q]) < 1e-30) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1),
        s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k][p],
          akq = a[k][q];
        a[k][p] = c * akp - s * akq;
        a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k],
          aqk = a[q][k];
        a[p][k] = c * apk - s * aqk;
        a[q][k] = s * apk + c * aqk;
      }
    }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y) as Vec3;
}

function solve3(H: number[][], g: number[]): Vec3 | null {
  const [[a, b, c], [d, e, f], [h, i, k]] = H;
  const det = a * (e * k - f * i) - b * (d * k - f * h) + c * (d * i - e * h);
  if (Math.abs(det) < 1e-12) return null;
  const inv = [
    [(e * k - f * i) / det, (c * i - b * k) / det, (b * f - c * e) / det],
    [(f * h - d * k) / det, (a * k - c * h) / det, (c * d - a * f) / det],
    [(d * i - e * h) / det, (b * h - a * i) / det, (a * e - b * d) / det],
  ];
  return [0, 1, 2].map((r) => inv[r][0] * g[0] + inv[r][1] * g[1] + inv[r][2] * g[2]) as Vec3;
}

/** Energy, gradient and Hessian of the field at a Cartesian point (central differences). */
export function localQuadratic(field: FrameworkField, p: Vec3, h = FD) {
  const E = (dx: number, dy: number, dz: number) => field.eval(p[0] + dx, p[1] + dy, p[2] + dz)[0];
  const e0 = E(0, 0, 0);
  const unit = (k: number, s: number): Vec3 => [k === 0 ? s : 0, k === 1 ? s : 0, k === 2 ? s : 0];
  const g = [0, 0, 0];
  const H = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < 3; k++) {
    const ep = E(...unit(k, h)),
      em = E(...unit(k, -h));
    g[k] = (ep - em) / (2 * h);
    H[k][k] = (ep - 2 * e0 + em) / (h * h);
  }
  for (const [k, l] of [
    [0, 1],
    [0, 2],
    [1, 2],
  ]) {
    const d = (sk: number, sl: number) => {
      const v: Vec3 = [0, 0, 0];
      v[k] = sk * h;
      v[l] = sl * h;
      return E(...v);
    };
    H[k][l] = H[l][k] = (d(1, 1) - d(1, -1) - d(-1, 1) + d(-1, -1)) / (4 * h * h);
  }
  return { e0, g, H };
}

/** Shortest Cartesian distance between two fractional points under periodic boundaries. */
function pbcDist(cr: Crystal, f1: Vec3, f2: Vec3): number {
  const d = [0, 1, 2].map((k) => f1[k] - f2[k] - Math.round(f1[k] - f2[k]));
  let best = Infinity;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++) best = Math.min(best, norm(toCart(cr.lattice, [d[0] + i, d[1] + j, d[2] + k])));
  return best;
}

const wrap = (x: number) => {
  const w = x - Math.floor(x);
  return w >= 1 - 1e-9 ? 0 : w;
};

export function findMinima(cr: Crystal, field: FrameworkField, grid: GridResult, mobileEl: string): EnergyMinimum[] {
  const energy = grid.energy;
  if (!energy) return [];
  const [n0, n1, n2] = grid.n;
  const L = cr.lattice;
  const at = (i: number, j: number, k: number) => energy[((i % n0) + n0) % n0 + n0 * (((j % n1) + n1) % n1 + n1 * (((k % n2) + n2) % n2))];

  // 1) grid points lower than all 26 neighbours (ties broken by index, so a flat bottom gives one point)
  const raw: Vec3[] = [];
  for (let k = 0; k < n2; k++)
    for (let j = 0; j < n1; j++)
      for (let i = 0; i < n0; i++) {
        const idx = i + n0 * (j + n1 * k);
        const e = energy[idx];
        if (e > MINIMA_SEARCH_E) continue;
        let isMin = true;
        for (let dk = -1; dk <= 1 && isMin; dk++)
          for (let dj = -1; dj <= 1 && isMin; dj++)
            for (let di = -1; di <= 1 && isMin; di++) {
              if (!di && !dj && !dk) continue;
              const o = at(i + di, j + dj, k + dk);
              const oIdx = (((i + di) % n0) + n0) % n0 + n0 * ((((j + dj) % n1) + n1) % n1 + n1 * ((((k + dk) % n2) + n2) % n2));
              if (o < e || (o === e && oIdx < idx)) isMin = false;
            }
        if (isMin) raw.push([i / n0, j / n1, k / n2]);
      }

  // 2) refine on the analytic field (damped Newton, never further than one grid step from the start)
  const step = Math.max(L.a / n0, L.b / n1, L.c / n2);
  const refined = raw.map((f0) => {
    const start = toCart(L, f0);
    let p: Vec3 = [...start];
    let q = localQuadratic(field, p);
    for (let it = 0; it < 8; it++) {
      const dx = solve3(q.H, q.g);
      if (!dx) break;
      let s = 1;
      const len = norm(dx);
      if (len > step / 2) s = step / 2 / len;
      const next: Vec3 = [p[0] - s * dx[0], p[1] - s * dx[1], p[2] - s * dx[2]];
      if (norm([next[0] - start[0], next[1] - start[1], next[2] - start[2]]) > 1.5 * step) break;
      const qn = localQuadratic(field, next);
      if (qn.e0 > q.e0) break;
      p = next;
      q = qn;
      if (len * s < 1e-4) break;
    }
    const inv = L.inv;
    const f = [0, 1, 2].map((r) => wrap(inv[r][0] * p[0] + inv[r][1] * p[1] + inv[r][2] * p[2])) as Vec3;
    return { frac: f, cart: toCart(L, f), E: q.e0 - grid.eMinAbs, curvature: symEig3(q.H) };
  });
  // a grid minimum whose refined curvature is not positive in every direction is a saddle seen at grid resolution

  // 3) merge minima that are the same site (keep the lowest)
  refined.sort((x, y) => x.E - y.E);
  const kept: typeof refined = [];
  for (const m of refined.filter((r) => r.curvature[0] > 0)) if (!kept.some((k) => pbcDist(cr, k.frac, m.frac) < MINIMA_MERGE)) kept.push(m);

  // 4) match to the CIF mobile-ion positions
  const mobilePos = cr.positions.filter((p) => p.occupants.some((o) => cr.sites[o.site].element === mobileEl));
  const out: EnergyMinimum[] = [];
  for (const m of kept) {
    let nearest: EnergyMinimum["nearest"] = null;
    for (const p of mobilePos) {
      const d = pbcDist(cr, p.frac, m.frac);
      if (!nearest || d < nearest.d) nearest = { group: p.group, d };
    }
    const occupied = !!nearest && nearest.d <= SITE_MATCH;
    if (!occupied && m.E > INTERSTITIAL_E_MAX) continue;
    out.push({ ...m, occupied, nearest });
  }
  return out;
}

export interface MinimumClass {
  key: string;
  occupied: boolean;
  E: number;
  nearest: EnergyMinimum["nearest"];
  curvature: Vec3;
  frac: Vec3; // one representative
  count: number;
}

/** Groups minima that look equivalent (same kind, energy, nearest CIF site and distance), lowest energy first. */
export function minimumClasses(minima: EnergyMinimum[]): MinimumClass[] {
  const out = new Map<string, MinimumClass>();
  for (const m of minima) {
    const key = `${m.occupied ? "site" : "int"}|${m.E.toFixed(2)}|${m.nearest?.group ?? ""}|${m.nearest?.d.toFixed(2) ?? ""}`;
    const c = out.get(key);
    if (c) c.count++;
    else out.set(key, { key, occupied: m.occupied, E: m.E, nearest: m.nearest, curvature: m.curvature, frac: m.frac, count: 1 });
  }
  return [...out.values()].sort((x, y) => x.E - y.E || Number(y.occupied) - Number(x.occupied));
}

/** Feature values from the stable sites (grid group). */
export function minimaFeatureValues(cr: Crystal, minima: EnergyMinimum[] | null): Record<string, number | null> {
  const keys = ["n_interstitial", "rho_interstitial", "E_interstitial_min", "site_spacing", "site_energy_spread", "curv_min", "curv_aniso"];
  if (!minima) return Object.fromEntries(keys.map((k) => [k, null]));
  const inter = minima.filter((m) => !m.occupied);
  const occ = minima.filter((m) => m.occupied);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const nn = minima.map((m) => Math.min(...minima.filter((o) => o !== m).map((o) => pbcDist(cr, m.frac, o.frac)), Infinity)).filter(Number.isFinite);
  const Es = minima.map((m) => m.E);
  const eBar = mean(Es);
  return {
    n_interstitial: inter.length,
    rho_interstitial: (inter.length / cr.lattice.volume) * 1000,
    E_interstitial_min: inter.length ? Math.min(...inter.map((m) => m.E)) : null,
    site_spacing: mean(nn),
    site_energy_spread: eBar === null ? null : Math.sqrt(Es.reduce((s, e) => s + (e - eBar) ** 2, 0) / Es.length),
    curv_min: mean(occ.map((m) => m.curvature[0])),
    curv_aniso: mean(occ.map((m) => m.curvature[2] / m.curvature[0])),
  };
}
