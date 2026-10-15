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
/** Eigenvalues below this fraction of the largest count as no diffusion in that direction. */
const D_ZERO = 1e-6;

export interface Diffusion {
  T: number;
  D: number[][]; // Cartesian tensor, cm²/s
  eig: Vec3; // eigenvalues, largest first (cm²/s)
  axis: Vec3; // â·D·â along a, b, c (cm²/s)
  dim: number; // number of directions with diffusion
}

export interface MobileSiteEnergy {
  pos: number;
  E: number;
}

/**
 * Minimise the network's quadratic energy by positive star–mesh elimination.
 * Unlike subtracting nearly equal entries of a dense Laplacian, this keeps weak series links.
 * Parallel edges are merged by completing the square, retaining the constant tensor term.
 */
export function diffusionTensor(cr: Crystal, hops: Hop[], barriers: (HopBarrier | null)[] | null, T: number, siteE: MobileSiteEnergy[] | null): Diffusion | null {
  if (!barriers || !siteE?.length || !(T > 0) || !Number.isFinite(T)) return null;
  // A failed path is missing information, not evidence of a zero transition rate.
  if (hops.some((_, i) => !barriers[i])) return null;
  const E = new Map(siteE.map((s) => [s.pos, s.E]));
  if ([...E.values()].some((e) => !Number.isFinite(e))) return null;
  const nodes = [...E.keys()];
  const idx = new Map(nodes.map((p, i) => [p, i]));
  const kT = K_B * T;
  const eMin = Math.min(...E.values());
  // Include disconnected and isolated mobile sites in the Boltzmann normalisation.
  const Z = nodes.reduce((s, p) => s + Math.exp(-(E.get(p)! - eMin) / kT), 0);
  type Edge = { w: number; dr: Vec3 };
  const graph = nodes.map(() => new Map<number, Edge>());
  const D = [0, 1, 2].map(() => [0, 0, 0]);
  const outer = (w: number, dr: Vec3) => {
    for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) D[p][q] += w * dr[p] * dr[q] * 1e-16;
  };
  const add = (i: number, j: number, w: number, dr: Vec3) => {
    if (i === j) { outer(w, dr); return; }
    const old = graph[i].get(j);
    if (old) {
      const total = old.w + w;
      const delta = dr.map((x, k) => x - old.dr[k]) as Vec3;
      outer(Math.min(old.w, w) * (Math.max(old.w, w) / total), delta);
      dr = old.dr.map((x, k) => x + (w / total) * delta[k]) as Vec3;
      w = total;
    }
    graph[i].set(j, { w, dr });
    graph[j].set(i, { w, dr: dr.map((x) => -x) as Vec3 });
  };
  for (let k = 0; k < hops.length; k++) {
    const h = hops[k], b = barriers[k]!;
    const i = idx.get(h.a), j = idx.get(h.b);
    if (i === undefined || j === undefined || !Number.isFinite(b.Esad)) return null;
    const w = NU0 * Math.exp(-(b.Esad - eMin) / kT) / Z;
    // Underflow cannot be resolved in double precision: report unavailable rather than prune topology.
    if (!(w > 0) || !Number.isFinite(w)) return null;
    // The intra-cell position difference is a gradient absorbed into the corrector.
    // Working with lattice translations avoids spurious transport in finite, non-winding clusters.
    add(i, j, w, toCart(cr.lattice, h.t));
  }
  const active = new Set(nodes.map((_, i) => i));
  while (active.size) {
    // Minimum degree limits fill-in; isolated sites contribute probability but no transport.
    let node = active.values().next().value!;
    for (const i of active) if (graph[i].size < graph[node].size) node = i;
    const edges = [...graph[node]];
    const total = edges.reduce((s, [, e]) => s + e.w, 0);
    for (const [i] of edges) graph[i].delete(node);
    for (let a = 0; a < edges.length; a++) for (let b = a + 1; b < edges.length; b++) {
      const [i, ei] = edges[a], [j, ej] = edges[b];
      const w = Math.min(ei.w, ej.w) * (Math.max(ei.w, ej.w) / total);
      if (!(w > 0)) return null;
      add(i, j, w, ej.dr.map((x, k) => x - ei.dr[k]) as Vec3);
    }
    graph[node].clear();
    active.delete(node);
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
export function diffusionFeatureValues(cr: Crystal, hops: Hop[], barriers: (HopBarrier | null)[] | null, siteE: MobileSiteEnergy[] | null): Record<string, number | null> {
  const keys = ["logD", "logD_a", "logD_b", "logD_c", "D_dim", "logD_aniso", "Ea_D"];
  const d1 = diffusionTensor(cr, hops, barriers, DIFF_T, siteE);
  const empty = Object.fromEntries(keys.map((k) => [k, null]));
  if (!d1) return empty;
  if (d1.eig[0] <= 0) return { ...empty, D_dim: 0 };
  const d2 = diffusionTensor(cr, hops, barriers, DIFF_T2, siteE);
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
    Ea_D: d2 && mean(d2) > 0 ? (K_B * (Math.log(mean(d2)) - Math.log(mean(d1)))) / (1 / DIFF_T - 1 / DIFF_T2) : null,
  };
}
