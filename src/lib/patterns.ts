// Structure patterns that are viewed rather than used as scalar features: partial g(r) and the
// simulated powder XRD. They depend on the atoms and occupancies only (not on oxidation states, bond
// settings or the mobile ion), so they are cached per Crystal object and computed only when shown (#41).
import { ELEMENTS } from "./data";
import { Crystal, buildNeighborTable } from "./structure";
import { XrdPattern, simulateXrd } from "./xrd";

export const PRDF_RMAX = 8; // Å
export const PRDF_DR = 0.05; // Å

export type Prdf = { pair: string; points: { x: number; y: number }[] }[];
export type PatternKind = "prdf" | "xrd";
export interface Patterns {
  prdf?: Prdf;
  xrd?: XrdPattern;
}

const cache = new WeakMap<Crystal, Patterns>();

/** Cached pattern of a crystal, or undefined when it has not been computed yet. */
export function cachedPattern<K extends PatternKind>(cr: Crystal, kind: K): Patterns[K] | undefined {
  return cache.get(cr)?.[kind];
}

/** Compute (once) and cache a pattern of a crystal. */
export function patternOf<K extends PatternKind>(cr: Crystal, kind: K): NonNullable<Patterns[K]> {
  let p = cache.get(cr);
  if (!p) cache.set(cr, (p = {}));
  if (!p[kind]) (p as Patterns)[kind] = (kind === "prdf" ? computePrdf(cr) : simulateXrd(cr)) as Patterns[K];
  return p[kind]!;
}

/** Partial radial distribution functions g(r) of every element pair, occupancy weighted and lightly smoothed. */
export function computePrdf(cr: Crystal, rmax = PRDF_RMAX, dr = PRDF_DR): Prdf {
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
  const out: Prdf = [];
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
