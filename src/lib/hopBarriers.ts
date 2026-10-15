// BVSE barrier of each mobile-ion hop: the path on the energy grid from one site to the other whose
// highest point is lowest (minimax path), searched in a tube around the straight line. The highest
// point is the saddle; barriers are measured from the BVSE at the two CIF sites.

import type { FrameworkField, GridResult } from "./bvse";
import type { Hop } from "./features";
import { PeriodicUnionFind } from "./percolation";
import { Crystal, Vec3, toCart } from "./structure";

/** Tube radius around the straight hop line (Å): max(HOP_TUBE_MIN, d · HOP_TUBE_FRAC). */
export const HOP_TUBE_MIN = 1.5;
export const HOP_TUBE_FRAC = 0.5;

export interface HopBarrier {
  Esad: number; // highest BVSE on the best path, above the grid minimum (eV)
  Ea: number; // BVSE at the start site (eV)
  Eb: number; // BVSE at the end site (eV)
  fwd: number; // Esad − Ea (≥ 0)
  rev: number; // Esad − Eb (≥ 0)
  saddle: Vec3; // Cartesian point of the saddle for the hop that starts in the home cell
}

/** Binary min-heap of (key, node). */
class Heap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, node: number) {
    const { k, v } = this;
    let i = k.length;
    k.push(key);
    v.push(node);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const { k, v } = this;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!,
      lv = v.pop()!;
    if (k.length) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

export function hopBarrier(cr: Crystal, grid: GridResult, field: FrameworkField, hop: Hop): HopBarrier | null {
  const energy = grid.energy;
  if (!energy) return null;
  const L = cr.lattice;
  const [n0, n1, n2] = grid.n;
  const fa = cr.positions[hop.a].frac;
  const fb: Vec3 = [0, 1, 2].map((k) => cr.positions[hop.b].frac[k] + hop.t[k]) as Vec3;
  const A = toCart(L, fa),
    B = toCart(L, fb);
  const AB: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const len2 = AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2 || 1e-12;
  const R = Math.max(HOP_TUBE_MIN, hop.d * HOP_TUBE_FRAC);
  const R2 = R * R;

  // unwrapped grid indices; energies looked up modulo the cell
  const s0 = [Math.round(fa[0] * n0), Math.round(fa[1] * n1), Math.round(fa[2] * n2)];
  const s1 = [Math.round(fb[0] * n0), Math.round(fb[1] * n1), Math.round(fb[2] * n2)];
  const pad = L.recip.map((r, k) => Math.ceil(R * r * grid.n[k]) + 1);
  const lo = [0, 1, 2].map((k) => Math.min(s0[k], s1[k]) - pad[k]);
  const dim = [0, 1, 2].map((k) => Math.max(s0[k], s1[k]) + pad[k] - lo[k] + 1);
  const id = (i: number, j: number, k: number) => i - lo[0] + dim[0] * (j - lo[1] + dim[1] * (k - lo[2]));
  const coords = (node: number): Vec3 => {
    const i = node % dim[0],
      j = Math.floor(node / dim[0]) % dim[1],
      k = Math.floor(node / (dim[0] * dim[1]));
    return [i + lo[0], j + lo[1], k + lo[2]];
  };
  const eAt = (g: Vec3) => energy[(((g[0] % n0) + n0) % n0) + n0 * ((((g[1] % n1) + n1) % n1) + n1 * (((g[2] % n2) + n2) % n2))];
  const cartOf = (g: Vec3) => toCart(L, [g[0] / n0, g[1] / n1, g[2] / n2]);
  const inTube = (g: Vec3) => {
    const c = cartOf(g);
    const w: Vec3 = [c[0] - A[0], c[1] - A[1], c[2] - A[2]];
    const t = Math.max(0, Math.min(1, (w[0] * AB[0] + w[1] * AB[1] + w[2] * AB[2]) / len2));
    return (w[0] - t * AB[0]) ** 2 + (w[1] - t * AB[1]) ** 2 + (w[2] - t * AB[2]) ** 2 <= R2;
  };

  // minimax Dijkstra: cost(v) = max over the path of the energy; remember where that maximum is
  const start = id(s0[0], s0[1], s0[2]),
    goal = id(s1[0], s1[1], s1[2]);
  const cost = new Map<number, number>();
  const peak = new Map<number, number>();
  const done = new Set<number>();
  const heap = new Heap();
  const e0 = eAt(s0 as Vec3);
  cost.set(start, e0);
  peak.set(start, start);
  heap.push(e0, start);
  const steps: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  while (heap.size) {
    const [c, u] = heap.pop();
    if (done.has(u)) continue;
    done.add(u);
    if (u === goal) break;
    const gu = coords(u);
    for (const s of steps) {
      const g: Vec3 = [gu[0] + s[0], gu[1] + s[1], gu[2] + s[2]];
      if (g[0] < lo[0] || g[1] < lo[1] || g[2] < lo[2] || g[0] >= lo[0] + dim[0] || g[1] >= lo[1] + dim[1] || g[2] >= lo[2] + dim[2]) continue;
      const v = id(g[0], g[1], g[2]);
      if (done.has(v) || (v !== goal && !inTube(g))) continue;
      const ev = eAt(g);
      const nc = Math.max(c, ev);
      if (nc < (cost.get(v) ?? Infinity)) {
        cost.set(v, nc);
        peak.set(v, ev > c ? v : peak.get(u)!);
        heap.push(nc, v);
      }
    }
  }
  let Esad = cost.get(goal);
  if (Esad === undefined || !done.has(goal)) return null;
  const Ea = field.eval(A[0], A[1], A[2])[0] - grid.eMinAbs;
  // Evaluate both CIF sites in the home cell: field images cover that cell, and the
  // periodic endpoint must have the same energy regardless of the hop translation.
  const homeB = cr.positions[hop.b].cart;
  const Eb = field.eval(homeB[0], homeB[1], homeB[2])[0] - grid.eMinAbs;
  let saddle = cartOf(coords(peak.get(goal)!));
  // Rounding to grid nodes may miss a higher energy at an exact CIF endpoint.
  // Include those points in the path maximum, keeping its energy and position together.
  if (Ea > Esad) { Esad = Ea; saddle = A; }
  if (Eb > Esad) { Esad = Eb; saddle = B; }
  return { Esad, Ea, Eb, fwd: Esad - Ea, rev: Esad - Eb, saddle };
}

/**
 * Barriers of all hops (aligned with `hops`), cooperatively yielding between hops.
 * Keep each path and its own maximum. Geometric display classes do not establish symmetry,
 * and even symmetry-related hops sample the discrete grid at different offsets.
 */
export async function hopBarriers(cr: Crystal, grid: GridResult, field: FrameworkField, hops: Hop[], isCancelled?: () => boolean): Promise<(HopBarrier | null)[] | null> {
  if (!grid.energy) return null;
  const out: (HopBarrier | null)[] = [];
  let last = performance.now();
  for (const h of hops) {
    out.push(hopBarrier(cr, grid, field, h));
    if (performance.now() - last > 30) {
      await new Promise<void>((r) => setTimeout(r, 0));
      if (isCancelled?.()) return null;
      last = performance.now();
    }
  }
  return out;
}

/** Feature values from the per-hop barriers (grid group). */
export function hopBarrierFeatureValues(hops: Hop[], barriers: (HopBarrier | null)[] | null): Record<string, number | null> {
  const keys = ["hop_barrier_min", "hop_barrier_mean", "hop_barrier_sd", "hop_asymmetry", "E_hop_1D", "E_hop_2D", "E_hop_3D", "E_hop_a", "E_hop_b", "E_hop_c"];
  const ok = barriers ? hops.map((h, i) => ({ h, b: barriers[i] })).filter((x): x is { h: Hop; b: HopBarrier } => !!x.b) : [];
  if (!ok.length) return Object.fromEntries(keys.map((k) => [k, null]));
  // one barrier per hop: from the lower of its two sites
  const bs = ok.map(({ b }) => Math.max(b.fwd, b.rev));
  const mean = bs.reduce((a, b) => a + b, 0) / bs.length;
  // connect the hop network in order of increasing saddle energy, as rb_1D/2D/3D does with bottlenecks
  const nodes = [...new Set(ok.flatMap(({ h }) => [h.a, h.b]))];
  const idx = new Map(nodes.map((p, i) => [p, i]));
  const uf = new PeriodicUnionFind(nodes.length);
  nodes.forEach((_, i) => uf.make(i));
  const Ed: (number | null)[] = [null, null, null];
  const Eax: (number | null)[] = [null, null, null];
  for (const { h, b } of [...ok].sort((x, y) => x.b.Esad - y.b.Esad)) {
    const before = uf.maxRank;
    uf.union(idx.get(h.a)!, idx.get(h.b)!, h.t);
    for (let d = before; d < uf.maxRank; d++) Ed[d] = b.Esad;
    for (let k = 0; k < 3; k++) if (uf.axes[k] && Eax[k] === null) Eax[k] = b.Esad;
  }
  return {
    hop_barrier_min: Math.min(...bs),
    hop_barrier_mean: mean,
    hop_barrier_sd: Math.sqrt(bs.reduce((s, x) => s + (x - mean) ** 2, 0) / bs.length),
    hop_asymmetry: ok.reduce((s, { b }) => s + Math.abs(b.Ea - b.Eb), 0) / ok.length,
    E_hop_1D: Ed[0],
    E_hop_2D: Ed[1],
    E_hop_3D: Ed[2],
    E_hop_a: Eax[0],
    E_hop_b: Eax[1],
    E_hop_c: Eax[2],
  };
}
