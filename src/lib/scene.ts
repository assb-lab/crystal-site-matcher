// Turns a crystal + bond table into plain drawable primitives for the 3D viewer.
import { BondTable } from "./bonding";
import { elementColor, ELEMENTS } from "./data";
import type { ElementColors } from "./elementColors";
import { Crystal, Vec3, add, toCart } from "./structure";

export type PolyMode = "elements" | "selected" | "none";
/** Which ions sit at the centre of the polyhedra drawn in "elements" mode. */
export type PolyCenter = "cation" | "anion";

export interface ViewOptions {
  supercell: Vec3;
  showBonds: boolean;
  polyMode: PolyMode;
  showCell: boolean;
  showLabels: boolean;
  atomScale: number;
  bondRadius: number;
  polyOpacity: number;
  hiddenElements: string[];
  polyCenter: PolyCenter;
  polyElements: string[]; // centre elements whose polyhedra are drawn in "elements" mode
  showHops: boolean; // migration hops between mobile-ion sites
  showIso: boolean; // BVSE isosurface of the mobile ion
  showMinima: boolean; // stable sites (BVSE minima) of the mobile ion
  isoLevel: number | null; // ΔE (eV) above the minimum; null = automatic
}

export const DEFAULT_VIEW: ViewOptions = {
  supercell: [1, 1, 1],
  showBonds: true,
  polyMode: "elements",
  showCell: true,
  showLabels: true,
  atomScale: 0.32,
  bondRadius: 0.09,
  polyOpacity: 0.45,
  hiddenElements: [],
  polyCenter: "cation",
  polyElements: [],
  showHops: false,
  showIso: false,
  showMinima: false,
  isoLevel: null,
};

export interface AtomSector {
  element: string | null; // null = vacancy
  fraction: number; // display fractions sum to 1; calculation occupancies are untouched
  color: Vec3;
}

export const VACANCY_COLOR: Vec3 = [255, 255, 255];
/**
 * Rounding allowed per CIF occupancy row: values written with two decimals are off by at most 0.005, so
 * three rows of 0.33 (total 0.99) are a full site, not a 1 % vacancy. Larger deficits are drawn as vacancy.
 */
export const OCC_ROUNDING = 0.005;

/** Aggregate chemical species at a position, retaining the unoccupied fraction. */
export function atomSectors(cr: Crystal, pos: number, colors?: ElementColors): AtomSector[] {
  const weights = new Map<string, number>();
  let rows = 0;
  for (const o of cr.positions[pos].occupants) {
    if (!(o.occ > 0) || !Number.isFinite(o.occ)) continue;
    const el = cr.sites[o.site].element;
    weights.set(el, (weights.get(el) ?? 0) + o.occ);
    rows++;
  }
  const total = [...weights.values()].reduce((a, b) => a + b, 0);
  // full within the rounding of the CIF values (or over-full): normalise the display to 1
  const full = total >= 1 - OCC_ROUNDING * Math.max(rows, 1);
  const denominator = full ? total : 1;
  const sectors: AtomSector[] = [...weights].sort(([a], [b]) => a.localeCompare(b)).map(([element, w]) => ({ element, fraction: w / denominator, color: elementColor(element, colors) }));
  if (!full) sectors.push({ element: null, fraction: 1 - total, color: VACANCY_COLOR });
  return sectors;
}

export interface SceneAtom {
  key: string; // "pos|tx,ty,tz"
  pos: number;
  t: Vec3;
  xyz: Vec3;
  color: [number, number, number];
  sectors: AtomSector[];
  radius: number;
  extra: boolean; // outside the displayed cell range (ligand of a polyhedron)
}

export interface SceneBond {
  a: Vec3;
  b: Vec3;
  ca: [number, number, number];
  cb: [number, number, number];
}

export interface ScenePoly {
  centerKey: string;
  verts: Vec3[];
  color: [number, number, number];
  highlight: boolean;
}

export interface SceneLabel {
  xyz: Vec3;
  text: string;
  kind: "center" | "ligand";
}

export interface SceneSpec {
  atoms: SceneAtom[];
  bonds: SceneBond[];
  polys: ScenePoly[];
  cellEdges: [Vec3, Vec3][];
  center: Vec3;
  extent: number;
  selectedKey: string | null;
  labels: SceneLabel[];
  axes: { a: Vec3; b: Vec3; c: Vec3 };
  bondRadius: number;
  polyOpacity: number;
  hopLines: { a: Vec3; b: Vec3; color: [number, number, number] }[];
  hopPath: HopPathSpec | null;
  /** BVSE minima: at CIF mobile-ion sites, or empty candidate sites */
  minima: { xyz: Vec3; occupied: boolean }[];
  iso: IsoSpec | null;
}

/** The selected class of hops, drawn as a moving dashed line between its two mobile-ion sites. */
export interface HopPathSpec {
  paths: Vec3[][]; // polyline per hop and cell: start site, bend point (if any), end site
  necks: Vec3[]; // bottleneck points
  saddles: Vec3[]; // BVSE saddle points (when the grid has been computed)
  color: [number, number, number]; // bottleneck colour of the class
}

export interface IsoSpec {
  field: Float32Array; // values on an n[0]×n[1]×n[2] fractional grid, index i + n0·(j + n1·k)
  n: Vec3;
  level: number;
  color: [number, number, number];
  axes: [Vec3, Vec3, Vec3];
  supercell: Vec3;
}

export interface SceneHop {
  a: number;
  b: number;
  t: Vec3;
  rb: number;
  mid: Vec3; // Cartesian bottleneck point of the hop that starts in the home cell
  via?: Vec3; // Cartesian bend point of the same hop (#62)
  saddle?: Vec3; // Cartesian BVSE saddle point of the same hop
}

export interface SceneExtras {
  /** User colours by element (#74); the VESTA defaults otherwise. */
  elementColors?: ElementColors;
  hops?: SceneHop[];
  /** Highlighted hops (one class); `hopRange` is the bottleneck range used for the colour scale. */
  selHops?: SceneHop[];
  hopRange?: [number, number];
  minima?: { frac: Vec3; occupied: boolean }[];
  iso?: { field: Float32Array; n: Vec3; level: number; color: [number, number, number] } | null;
}

/** Bottleneck colour scale, narrow → wide: red → amber → green (legible on light and dark backgrounds). */
const RAMP: [number, number, number][] = [
  [227, 73, 72],
  [237, 161, 0],
  [27, 175, 122],
];
/** Marker colour of an empty candidate site (BVSE minimum away from the CIF sites): a cyan no element uses. */
export const MINIMUM_COLOR: [number, number, number] = [0, 172, 230];
/** Marker colour of the BVSE saddle on a highlighted hop path: a dark crimson, distinct from the bottleneck scale. */
export const SADDLE_COLOR: [number, number, number] = [150, 20, 70];
/** Marker colour of a BVSE minimum at a CIF site: a mid grey that reads on light and dark backgrounds. */
export const MINIMUM_SITE_COLOR: [number, number, number] = [128, 136, 150];

/** Colour of a hop with bottleneck radius `rb` on the scale [lo, hi] (the same in the 3D view and the charts). */
export function hopColor(rb: number, lo: number, hi: number): [number, number, number] {
  return ramp(hi > lo ? (rb - lo) / (hi - lo) : 1);
}

/** Distance from P to the segment A–B. */
function distToSegment(P: Vec3, A: Vec3, B: Vec3): number {
  const ab = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const ap = [P[0] - A[0], P[1] - A[1], P[2] - A[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1e-12)));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

function ramp(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  return [0, 1, 2].map((c) => Math.round(RAMP[i][c] + (RAMP[i + 1][c] - RAMP[i][c]) * f)) as [number, number, number];
}

export const atomKey = (pos: number, t: Vec3) => `${pos}|${t[0]},${t[1]},${t[2]}`;

export function parseAtomKey(key: string): { pos: number; t: Vec3 } {
  const [p, ts] = key.split("|");
  return { pos: parseInt(p, 10), t: ts.split(",").map((x) => parseInt(x, 10)) as Vec3 };
}

const signOf = (center: PolyCenter) => (center === "cation" ? 1 : -1);

/** Elements that can be polyhedron centres: species with the charge sign of `center`. */
export function polyCenterElements(cr: Crystal, ox: Record<string, number>, center: PolyCenter): string[] {
  const sg = signOf(center);
  return [...new Set(cr.sites.filter((s) => Math.sign(ox[s.label] ?? 0) === sg).map((s) => s.element))];
}

/**
 * Default polyhedron centres: cation species whose coordination number is at most 6,
 * or, for anion-centred polyhedra, every anion species (their CN is often 8–12, e.g. NLi₈ in Li₃N).
 */
export function defaultPolyElements(cr: Crystal, ox: Record<string, number>, bonds: BondTable, center: PolyCenter = "cation"): string[] {
  const sg = signOf(center);
  const out = new Set<string>();
  for (const g of cr.groups) {
    const p = cr.positions[g.positions[0]];
    const s = cr.sites[p.main];
    const cn = bonds.bonded[p.index].length;
    if (Math.sign(ox[s.label] ?? 0) === sg && cn >= 3 && (center === "anion" || cn <= 6)) out.add(s.element);
  }
  return [...out];
}

export function buildScene(
  cr: Crystal,
  bonds: BondTable,
  opts: ViewOptions,
  selectedKey: string | null,
  extras: SceneExtras = {},
): SceneSpec {
  const L = cr.lattice;
  const [na, nb, nc] = opts.supercell;
  const tol = 0.02;
  const atoms = new Map<string, SceneAtom>();
  const hidden = new Set(opts.hiddenElements);
  const polyEls = new Set(opts.polyElements);

  const mainEl = (pos: number) => cr.sites[cr.positions[pos].main].element;
  const radiusOf = (pos: number) => (ELEMENTS[mainEl(pos)]?.r ?? 1.3) * opts.atomScale;

  const addAtom = (pos: number, t: Vec3, extra: boolean) => {
    const key = atomKey(pos, t);
    if (atoms.has(key)) return atoms.get(key)!;
    const p = cr.positions[pos];
    const f: Vec3 = [p.frac[0] + t[0], p.frac[1] + t[1], p.frac[2] + t[2]];
    const sectors = atomSectors(cr, pos, extras.elementColors);
    const a: SceneAtom = { key, pos, t, xyz: toCart(L, f), color: sectors.length === 1 ? sectors[0].color : elementColor(mainEl(pos), extras.elementColors), sectors, radius: radiusOf(pos), extra };
    atoms.set(key, a);
    return a;
  };

  // 1) atoms inside the (super)cell, including boundary images
  for (const p of cr.positions) {
    if (hidden.has(mainEl(p.index))) continue;
    for (let i = -1; i <= na; i++)
      for (let j = -1; j <= nb; j++)
        for (let k = -1; k <= nc; k++) {
          const f = [p.frac[0] + i, p.frac[1] + j, p.frac[2] + k];
          if (f[0] < -tol || f[0] > na + tol || f[1] < -tol || f[1] > nb + tol || f[2] < -tol || f[2] > nc + tol) continue;
          addAtom(p.index, [i, j, k], false);
        }
  }

  const selected = selectedKey ? selectedKey : null;
  if (selected) {
    const { pos, t } = parseAtomKey(selected);
    if (pos < cr.positions.length) addAtom(pos, t, true);
  }
  // the selected hop path needs both of its end sites, even outside the displayed cells
  const cells: Vec3[] = [];
  for (let i = 0; i < na; i++) for (let j = 0; j < nb; j++) for (let k = 0; k < nc; k++) cells.push([i, j, k]);
  const selHops = extras.selHops ?? [];
  for (const h of selHops)
    for (const c of cells) {
      if (!hidden.has(mainEl(h.a))) addAtom(h.a, c, true);
      if (!hidden.has(mainEl(h.b))) addAtom(h.b, add(h.t, c), true);
    }

  const selPos = selected ? parseAtomKey(selected).pos : -1;
  const selGroup = selPos >= 0 && selPos < cr.positions.length ? cr.positions[selPos].group : null;

  // 2) polyhedra (and the ligands they need)
  const polys: ScenePoly[] = [];
  const centers = [...atoms.values()].filter((a) => !a.extra || a.key === selected);
  for (const a of centers) {
    const isSel = a.key === selected;
    const ligs = bonds.bonded[a.pos];
    let draw = false;
    if (isSel) draw = ligs.length >= 3;
    else if (opts.polyMode === "elements") draw = polyEls.has(mainEl(a.pos)) && ligs.length >= 3;
    else if (opts.polyMode === "selected") draw = cr.positions[a.pos].group === selGroup && ligs.length >= 3;
    if (!draw) continue;
    if (!isSel && hidden.has(mainEl(a.pos))) continue;
    const verts: Vec3[] = [];
    for (const nbr of ligs) {
      const lt = add(a.t, nbr.t);
      const la = addAtom(nbr.j, lt, true);
      verts.push(la.xyz);
    }
    polys.push({ centerKey: a.key, verts, color: a.color, highlight: isSel });
  }

  // 3) bonds between displayed atoms
  const bondsOut: SceneBond[] = [];
  if (opts.showBonds) {
    for (const a of atoms.values()) {
      for (const nbr of bonds.bonded[a.pos]) {
        const bk = atomKey(nbr.j, add(a.t, nbr.t));
        if (bk <= a.key) continue;
        const b = atoms.get(bk);
        if (!b) continue;
        bondsOut.push({ a: a.xyz, b: b.xyz, ca: a.color, cb: b.color });
      }
    }
  }

  // 4) labels around the selected atom
  const labels: SceneLabel[] = [];
  if (selected && opts.showLabels && selPos >= 0) {
    const s = atoms.get(selected);
    if (s) {
      labels.push({ xyz: s.xyz, text: cr.positions[s.pos].group, kind: "center" });
      for (const nbr of bonds.bonded[s.pos]) {
        const la = atoms.get(atomKey(nbr.j, add(s.t, nbr.t)));
        if (la) labels.push({ xyz: la.xyz, text: nbr.d.toFixed(3), kind: "ligand" });
      }
    }
  }

  // 5) cell edges
  const cellEdges: [Vec3, Vec3][] = [];
  if (opts.showCell) {
    const corner = (i: number, j: number, k: number) => toCart(L, [i, j, k]);
    for (let i = 0; i < na; i++)
      for (let j = 0; j < nb; j++)
        for (let k = 0; k < nc; k++) {
          const c = (x: number, y: number, z: number) => corner(i + x, j + y, k + z);
          const e: [Vec3, Vec3][] = [
            [c(0, 0, 0), c(1, 0, 0)],
            [c(0, 0, 0), c(0, 1, 0)],
            [c(0, 0, 0), c(0, 0, 1)],
            [c(1, 0, 0), c(1, 1, 0)],
            [c(1, 0, 0), c(1, 0, 1)],
            [c(0, 1, 0), c(1, 1, 0)],
            [c(0, 1, 0), c(0, 1, 1)],
            [c(0, 0, 1), c(1, 0, 1)],
            [c(0, 0, 1), c(0, 1, 1)],
            [c(1, 1, 0), c(1, 1, 1)],
            [c(1, 0, 1), c(1, 1, 1)],
            [c(0, 1, 1), c(1, 1, 1)],
          ];
          cellEdges.push(...e);
        }
  }

  // 6) migration hops between mobile sites, replicated over the displayed cells
  const hopLines: SceneSpec["hopLines"] = [];
  const rbAll = [...(extras.hops ?? []), ...selHops].map((h) => h.rb);
  const [lo, hi] = extras.hopRange ?? [Math.min(...rbAll), Math.max(...rbAll)];
  if (extras.hops && extras.hops.length) {
    for (const h of extras.hops) {
      const col = hopColor(h.rb, lo, hi);
      const fa = cr.positions[h.a].frac,
        fb = cr.positions[h.b].frac;
      for (let i = 0; i < na; i++)
        for (let j = 0; j < nb; j++)
          for (let k = 0; k < nc; k++) {
            const a = toCart(L, [fa[0] + i, fa[1] + j, fa[2] + k]);
            const b = toCart(L, [fb[0] + h.t[0] + i, fb[1] + h.t[1] + j, fb[2] + h.t[2] + k]);
            hopLines.push({ a, b, color: col });
          }
    }
  }

  let hopPath: HopPathSpec | null = null;
  if (selHops.length) {
    hopPath = { paths: [], necks: [], saddles: [], color: hopColor(selHops[0].rb, lo, hi) };
    for (const h of selHops)
      for (const c of cells) {
        const fa = cr.positions[h.a].frac,
          fb = cr.positions[h.b].frac;
        const shift = toCart(L, c);
        const A = toCart(L, add(fa, c)),
          B = toCart(L, add(add(fb, h.t), c));
        // the bend is drawn only when it leaves the straight line
        const P = h.via ? add(h.via, shift) : null;
        const off = P ? distToSegment(P, A, B) : 0;
        hopPath.paths.push(P && off > 1e-6 ? [A, P, B] : [A, B]);
        hopPath.necks.push(add(h.mid, shift));
        if (h.saddle) hopPath.saddles.push(add(h.saddle, shift));
      }
  }

  // 7) stable sites of the mobile ion, with boundary images like the atoms
  const minima: SceneSpec["minima"] = [];
  for (const m of extras.minima ?? [])
    for (let i = -1; i <= na; i++)
      for (let j = -1; j <= nb; j++)
        for (let k = -1; k <= nc; k++) {
          const f: Vec3 = [m.frac[0] + i, m.frac[1] + j, m.frac[2] + k];
          if (f[0] < -tol || f[0] > na + tol || f[1] < -tol || f[1] > nb + tol || f[2] < -tol || f[2] > nc + tol) continue;
          minima.push({ xyz: toCart(L, f), occupied: m.occupied });
        }

  const center = toCart(L, [na / 2, nb / 2, nc / 2]);
  let extent = 0;
  for (const a of atoms.values()) {
    const d = Math.hypot(a.xyz[0] - center[0], a.xyz[1] - center[1], a.xyz[2] - center[2]);
    if (d > extent) extent = d;
  }

  return {
    atoms: [...atoms.values()],
    bonds: bondsOut,
    polys,
    cellEdges,
    center,
    extent: Math.max(extent, 3),
    selectedKey: selected,
    labels,
    axes: { a: L.A, b: L.B, c: L.C },
    bondRadius: opts.bondRadius,
    polyOpacity: opts.polyOpacity,
    hopLines,
    hopPath,
    minima,
    iso: extras.iso ? { ...extras.iso, axes: [L.A, L.B, L.C], supercell: opts.supercell } : null,
  };
}
