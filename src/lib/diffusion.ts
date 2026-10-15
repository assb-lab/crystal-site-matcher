// Dilute-limit diffusion tensor of one mobile ion hopping over the hop network (#37).
// Rates follow the BVSE barriers, k_ij = ν₀ exp(−(E_saddle − E_i)/k_BT), with one attempt frequency ν₀ for
// every hop; the equilibrium site occupation is π_i ∝ exp(−E_i/k_BT). On the periodic network the effective
// tensor is D = Σ_hops w (Δr + χ_b − χ_a)(Δr + χ_b − χ_a)ᵀ with w = π_a k_ab = π_b k_ba, where the corrector χ
// removes the zero-drift part of each site's jumps (Σ_j w_ij (Δr_ij + χ_j − χ_i) = 0). This is the standard
// homogenisation of a reversible random walk; it is solved directly, without kinetic Monte Carlo.
// Not a measured diffusion coefficient: no ion–ion interaction, site blocking, correlation or concerted motion.

import type { Hop } from "./features";
import type { HopBarrier } from "./hopBarriers";
import { symEig3 } from "./landscape";
import { Crystal, Vec3, norm, toCart } from "./structure";

export const K_B = 8.617333262e-5; // eV/K
/** Attempt frequency (s⁻¹), the same for every hop. */
export const NU0 = 1e13;
/** Temperatures (K) of the reported tensor and of the Arrhenius slope. */
export const DIFF_T = 300;
export const DIFF_T2 = 400;
/** Hops slower than this fraction of the fastest one are left out (they carry no measurable flux and spoil the solve). */
const W_MIN = 1e-12;
/** Eigenvalues below this fraction of the largest count as no diffusion in that direction. */
const D_ZERO = 1e-6;

export interface Diffusion {
  T: number;
  D: number[][]; // Cartesian tensor, cm²/s
  eig: Vec3; // eigenvalues, largest first (cm²/s)
  axis: Vec3; // â·D·â along a, b, c (cm²/s)
  dim: number; // number of directions with diffusion
}

/** Solve A x = B (dense, partial pivoting) for several right-hand sides in place; A is n×n, B is n×m. */
function solve(A: number[][], B: number[][]): number[][] {
  const n = A.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    [B[c], B[p]] = [B[p], B[c]];
    const piv = A[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / piv;
      if (!f) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      for (let k = 0; k < B[r].length; k++) B[r][k] -= f * B[c][k];
    }
  }
  for (let c = n - 1; c >= 0; c--) {
    for (let k = 0; k < B[c].length; k++) {
      let s = B[c][k];
      for (let j = c + 1; j < n; j++) s -= A[c][j] * B[j][k];
      B[c][k] = s / A[c][c];
    }
  }
  return B;
}

export function diffusionTensor(cr: Crystal, hops: Hop[], barriers: (HopBarrier | null)[] | null, T: number): Diffusion | null {
  if (!barriers) return null;
  const ok = hops.map((h, i) => ({ h, b: barriers[i] })).filter((x): x is { h: Hop; b: HopBarrier } => !!x.b);
  if (!ok.length) return null;
  const kT = K_B * T;
  // site energies (BVSE at the CIF position, the same for every hop touching it)
  const E = new Map<number, number>();
  for (const { h, b } of ok) {
    if (!E.has(h.a)) E.set(h.a, b.Ea);
    if (!E.has(h.b)) E.set(h.b, b.Eb);
  }
  const nodes = [...E.keys()];
  const idx = new Map(nodes.map((p, i) => [p, i]));
  const eMin = Math.min(...E.values());
  const Z = nodes.reduce((s, p) => s + Math.exp(-(E.get(p)! - eMin) / kT), 0);
  // w = π_a k_ab depends on the saddle only (detailed balance holds by construction)
  const edges = ok.map(({ h, b }) => {
    const A = cr.positions[h.a].frac,
      Bf = cr.positions[h.b].frac;
    const dr = toCart(cr.lattice, [Bf[0] + h.t[0] - A[0], Bf[1] + h.t[1] - A[1], Bf[2] + h.t[2] - A[2]]);
    return { i: idx.get(h.a)!, j: idx.get(h.b)!, dr, w: (NU0 * Math.exp(-(b.Esad - eMin) / kT)) / Z };
  });
  const wMax = Math.max(...edges.map((e) => e.w));
  const kept = edges.filter((e) => e.w >= wMax * W_MIN);

  // corrector: weighted graph Laplacian L χ = −Σ_j w_ij Δr_ij, grounded at one node of each connected component
  const parent = nodes.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  for (const e of kept) parent[find(e.i)] = find(e.j);
  const free = nodes.map((_, i) => i).filter((i) => find(i) !== i);
  const col = new Map(free.map((i, c) => [i, c]));
  const Lm = free.map(() => new Array(free.length).fill(0));
  const rhs = free.map(() => [0, 0, 0]);
  const addTo = (i: number, j: number, w: number, dr: Vec3) => {
    const ci = col.get(i);
    if (ci === undefined) return; // grounded row
    if (i !== j) {
      Lm[ci][ci] += w;
      const cj = col.get(j);
      if (cj !== undefined) Lm[ci][cj] -= w;
    }
    for (let k = 0; k < 3; k++) rhs[ci][k] += w * dr[k];
  };
  for (const e of kept) {
    addTo(e.i, e.j, e.w, e.dr);
    addTo(e.j, e.i, e.w, [-e.dr[0], -e.dr[1], -e.dr[2]]);
  }
  const chi: Vec3[] = nodes.map(() => [0, 0, 0]);
  if (free.length) {
    const x = solve(Lm, rhs);
    free.forEach((i, c) => (chi[i] = x[c] as Vec3));
  }

  const D = [0, 1, 2].map(() => [0, 0, 0]);
  for (const e of kept) {
    const u = [0, 1, 2].map((k) => e.dr[k] + chi[e.j][k] - chi[e.i][k]);
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) D[p][q] += e.w * u[p] * u[q] * 1e-16; // Å²/s → cm²/s
  }
  const scale = Math.max(...D.map((r) => Math.max(...r.map(Math.abs)))) || 1;
  const eig = symEig3(D.map((r) => r.map((x) => x / scale)))
    .map((x) => Math.max(0, x * scale))
    .sort((x, y) => y - x) as Vec3;
  const L = cr.lattice;
  const axis = [L.A, L.B, L.C].map((v) => {
    const u = v.map((x) => x / norm(v as Vec3));
    return u.reduce((s, ui, p) => s + ui * u.reduce((t, uj, q) => t + D[p][q] * uj, 0), 0);
  }) as Vec3;
  return { T, D, eig, axis, dim: eig.filter((x) => x > eig[0] * D_ZERO).length };
}

/** Feature values of the dilute-limit diffusion tensor (grid group). */
export function diffusionFeatureValues(cr: Crystal, hops: Hop[], barriers: (HopBarrier | null)[] | null): Record<string, number | null> {
  const keys = ["logD", "logD_a", "logD_b", "logD_c", "D_dim", "logD_aniso", "Ea_D"];
  const d1 = diffusionTensor(cr, hops, barriers, DIFF_T);
  if (!d1 || d1.eig[0] <= 0) return Object.fromEntries(keys.map((k) => [k, null]));
  const d2 = diffusionTensor(cr, hops, barriers, DIFF_T2)!;
  const mean = (d: Diffusion) => (d.D[0][0] + d.D[1][1] + d.D[2][2]) / 3;
  const lg = (x: number) => (x > d1.eig[0] * D_ZERO ? Math.log10(x) : null);
  const aniso = Math.log10(d1.eig[0] / d1.eig[d1.dim - 1]);
  return {
    logD: Math.log10(mean(d1)),
    logD_a: lg(d1.axis[0]),
    logD_b: lg(d1.axis[1]),
    logD_c: lg(d1.axis[2]),
    D_dim: d1.dim,
    logD_aniso: aniso < 1e-9 ? 0 : aniso, // rounding noise of an isotropic tensor
    // Arrhenius slope of the mean between DIFF_T and DIFF_T2
    Ea_D: (K_B * Math.log(mean(d2) / mean(d1))) / (1 / DIFF_T - 1 / DIFF_T2),
  };
}
