import { ELEMENTS, SHANNON, VESTA_CUTOFFS } from "./data";
import { Crystal, Neighbor } from "./structure";

export interface PairRule {
  max: number; // Å
  on: boolean;
  def: number; // default value (for reset)
  source: "VESTA" | "Shannon" | "atomic";
}

export interface BondSettings {
  pairs: Record<string, PairRule>;
  /** Per site-group override of the maximum bond length (applies to bonds touching that group). */
  siteOverride: Record<string, number>;
  /** Only bond species of opposite charge sign (cation–anion). */
  ionicOnly: boolean;
}

export const pairKey = (a: string, b: string) => (a < b ? `${a}-${b}` : `${b}-${a}`);

function shannonVI(el: string, ox: number): number | null {
  const es = SHANNON.filter((s) => s.el === el && s.ox === ox);
  if (es.length === 0) return null;
  const vi = es.filter((s) => s.cn === 6);
  const pick = (vi.length ? vi : es).sort((x, y) => Math.abs(x.cn - 6) - Math.abs(y.cn - 6))[0];
  return pick.ionic;
}

export function defaultPairRule(a: string, oxA: number, b: string, oxB: number): PairRule {
  const key = pairKey(a, b);
  const v = VESTA_CUTOFFS[key];
  const ra = shannonVI(a, oxA),
    rb = shannonVI(b, oxB);
  const ionic = ra !== null && rb !== null && oxA * oxB < 0;
  if (v) {
    // A few VESTA defaults are shorter than real bonds (e.g. Ag–I 2.54 Å vs 2.83 Å); never go below 1.1 × the Shannon sum.
    const floor = ionic ? +(1.1 * ((ra as number) + (rb as number))).toFixed(2) : 0;
    return floor > v ? { max: floor, def: floor, on: true, source: "Shannon" } : { max: v, def: v, on: true, source: "VESTA" };
  }
  if (ionic) {
    const m = +(1.25 * ((ra as number) + (rb as number))).toFixed(2);
    return { max: m, def: m, on: true, source: "Shannon" };
  }
  const m = +(1.15 * ((ELEMENTS[a]?.r ?? 1.4) + (ELEMENTS[b]?.r ?? 1.4))).toFixed(2);
  return { max: m, def: m, on: true, source: "atomic" };
}

export function defaultBondSettings(cr: Crystal, ox: Record<string, number>): BondSettings {
  const pairs: Record<string, PairRule> = {};
  const species = new Map<string, number[]>();
  for (const s of cr.sites) {
    const l = species.get(s.element) ?? [];
    l.push(ox[s.label] ?? 0);
    species.set(s.element, l);
  }
  const els = [...species.keys()];
  for (let i = 0; i < els.length; i++)
    for (let j = i; j < els.length; j++) {
      const a = els[i],
        b = els[j];
      // representative oxidation states of opposite sign if available
      const oa = species.get(a)!,
        ob = species.get(b)!;
      let pa = oa[0],
        pb = ob[0];
      outer: for (const x of oa)
        for (const y of ob)
          if (x * y < 0) {
            pa = x;
            pb = y;
            break outer;
          }
      pairs[pairKey(a, b)] = defaultPairRule(a, pa, b, pb);
    }
  return { pairs, siteOverride: {}, ionicOnly: true };
}

/** Pairs that can actually form a cation–anion (or any, if !ionicOnly) bond in this structure. */
export function relevantPairs(cr: Crystal, ox: Record<string, number>, ionicOnly: boolean): string[] {
  const out = new Set<string>();
  for (const s of cr.sites)
    for (const t of cr.sites) {
      const a = ox[s.label] ?? 0,
        b = ox[t.label] ?? 0;
      if (ionicOnly && a * b > 0) continue;
      if (ionicOnly && a === 0 && b === 0 && s.element === t.element) continue;
      out.add(pairKey(s.element, t.element));
    }
  return [...out].sort();
}

/** Can the two positions bond at all (ignoring distance)? Returns the applicable cutoff or null. */
export function bondCutoff(cr: Crystal, ox: Record<string, number>, bs: BondSettings, i: number, j: number): number | null {
  const pi = cr.positions[i],
    pj = cr.positions[j];
  const ov = bs.siteOverride[pi.group] ?? bs.siteOverride[pj.group];
  let best: number | null = null;
  for (const oi of pi.occupants)
    for (const oj of pj.occupants) {
      const si = cr.sites[oi.site],
        sj = cr.sites[oj.site];
      const rule = bs.pairs[pairKey(si.element, sj.element)];
      if (!rule || !rule.on) continue;
      const qa = ox[si.label] ?? 0,
        qb = ox[sj.label] ?? 0;
      if (bs.ionicOnly && qa * qb > 0) continue;
      if (bs.ionicOnly && qa === 0 && qb === 0 && si.element === sj.element) continue;
      const c = ov ?? rule.max;
      if (best === null || c > best) best = c;
    }
  return best;
}

export interface BondTable {
  bonded: Neighbor[][]; // per position: neighbours within cutoff
  eligible: Neighbor[][]; // per position: all neighbours of a bondable species (any distance in table)
}

export function computeBonds(cr: Crystal, ox: Record<string, number>, bs: BondSettings, table: Neighbor[][]): BondTable {
  const cache = new Map<number, number | null>();
  const np = cr.positions.length;
  const cut = (i: number, j: number) => {
    const k = i * np + j;
    if (!cache.has(k)) cache.set(k, bondCutoff(cr, ox, bs, i, j));
    return cache.get(k)!;
  };
  const bonded: Neighbor[][] = [];
  const eligible: Neighbor[][] = [];
  table.forEach((list, i) => {
    const b: Neighbor[] = [],
      e: Neighbor[] = [];
    for (const nb of list) {
      const c = cut(i, nb.j);
      if (c === null) continue;
      e.push(nb);
      if (nb.d <= c) b.push(nb);
    }
    bonded.push(b);
    eligible.push(e);
  });
  return { bonded, eligible };
}
