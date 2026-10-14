// Turns a crystal + bond table into plain drawable primitives for the 3D viewer.
import { BondTable } from "./bonding";
import { elementColor, ELEMENTS } from "./data";
import { Crystal, Vec3, add, toCart } from "./structure";

export type PolyMode = "elements" | "selected" | "none";

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
  polyElements: string[]; // centre elements whose polyhedra are drawn in "elements" mode
  showHops: boolean; // migration hops between mobile-ion sites
  showIso: boolean; // BVSE isosurface of the mobile ion
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
  polyElements: [],
  showHops: false,
  showIso: false,
  isoLevel: null,
};

export interface SceneAtom {
  key: string; // "pos|tx,ty,tz"
  pos: number;
  t: Vec3;
  xyz: Vec3;
  color: [number, number, number];
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
  iso: IsoSpec | null;
}

export interface IsoSpec {
  field: Float32Array; // values on an n[0]×n[1]×n[2] fractional grid, index i + n0·(j + n1·k)
  n: Vec3;
  level: number;
  color: [number, number, number];
  axes: [Vec3, Vec3, Vec3];
  supercell: Vec3;
}

export interface SceneExtras {
  hops?: { a: number; b: number; t: Vec3; rb: number }[];
  iso?: { field: Float32Array; n: Vec3; level: number; color: [number, number, number] } | null;
}

/** Bottleneck colour scale, narrow → wide: red → amber → green (legible on light and dark backgrounds). */
const RAMP: [number, number, number][] = [
  [227, 73, 72],
  [237, 161, 0],
  [27, 175, 122],
];
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

/** Default polyhedron centres: cation species whose coordination number is at most 6. */
export function defaultPolyElements(cr: Crystal, ox: Record<string, number>, bonds: BondTable): string[] {
  const out = new Set<string>();
  for (const g of cr.groups) {
    const p = cr.positions[g.positions[0]];
    const s = cr.sites[p.main];
    const cn = bonds.bonded[p.index].length;
    if ((ox[s.label] ?? 0) > 0 && cn >= 3 && cn <= 6) out.add(s.element);
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
    const a: SceneAtom = { key, pos, t, xyz: toCart(L, f), color: elementColor(mainEl(pos)), radius: radiusOf(pos), extra };
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
  if (extras.hops && extras.hops.length) {
    const rbs = extras.hops.map((h) => h.rb);
    const lo = Math.min(...rbs),
      hi = Math.max(...rbs);
    for (const h of extras.hops) {
      const col = ramp(hi > lo ? (h.rb - lo) / (hi - lo) : 1);
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
    iso: extras.iso ? { ...extras.iso, axes: [L.A, L.B, L.C], supercell: opts.supercell } : null,
  };
}
