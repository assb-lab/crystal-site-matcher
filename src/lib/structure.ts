import { CifBlock, cifNumber, getItem, getLoop } from "./cif";
import { ELEMENTS } from "./data";
import { lookupSpaceGroup, parseSymOp, SymOp } from "./spacegroup";

export type Vec3 = [number, number, number];

export interface Lattice {
  a: number;
  b: number;
  c: number;
  alpha: number;
  beta: number;
  gamma: number;
  A: Vec3;
  B: Vec3;
  C: Vec3;
  inv: number[][]; // cart → frac
  volume: number;
  recip: Vec3; // |a*|, |b*|, |c*| (1/Å, no 2π)
}

export interface AsymSite {
  index: number;
  label: string;
  element: string;
  typeSymbol: string;
  cifOx: number | null;
  occ: number;
  frac: Vec3;
  multiplicity: number; // filled after expansion
}

export interface Occupant {
  site: number; // index into crystal.sites
  occ: number;
}

export interface Position {
  index: number;
  frac: Vec3; // wrapped to [0,1)
  cart: Vec3;
  occupants: Occupant[];
  main: number; // asym site index of the majority occupant
  group: string; // site-group key (labels sharing the position, joined by "/")
}

export interface SiteGroup {
  key: string;
  sites: number[];
  positions: number[];
}

export interface Crystal {
  title: string;
  lattice: Lattice;
  spaceGroup: { symbol: string; number: number | null; source: string };
  nOps: number;
  sites: AsymSite[];
  positions: Position[];
  groups: SiteGroup[];
  warnings: string[];
}

const d2r = Math.PI / 180;

export function makeLattice(a: number, b: number, c: number, alpha: number, beta: number, gamma: number): Lattice {
  const ca = Math.cos(alpha * d2r),
    cb = Math.cos(beta * d2r),
    cg = Math.cos(gamma * d2r),
    sg = Math.sin(gamma * d2r);
  const A: Vec3 = [a, 0, 0];
  const B: Vec3 = [b * cg, b * sg, 0];
  const cx = c * cb;
  const cy = (c * (ca - cb * cg)) / sg;
  const cz = Math.sqrt(Math.max(c * c - cx * cx - cy * cy, 1e-12));
  const C: Vec3 = [cx, cy, cz];
  // matrix with columns A,B,C
  const m = [
    [A[0], B[0], C[0]],
    [A[1], B[1], C[1]],
    [A[2], B[2], C[2]],
  ];
  const inv = invert3(m);
  const volume = a * b * c * Math.sqrt(1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg);
  const recip: Vec3 = [norm(inv[0] as Vec3), norm(inv[1] as Vec3), norm(inv[2] as Vec3)];
  return { a, b, c, alpha, beta, gamma, A, B, C, inv, volume, recip };
}

export function invert3(m: number[][]): number[][] {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}

export const norm = (v: Vec3) => Math.hypot(v[0], v[1], v[2]);
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function toCart(L: Lattice, f: Vec3): Vec3 {
  return [
    f[0] * L.A[0] + f[1] * L.B[0] + f[2] * L.C[0],
    f[0] * L.A[1] + f[1] * L.B[1] + f[2] * L.C[1],
    f[0] * L.A[2] + f[1] * L.B[2] + f[2] * L.C[2],
  ];
}

const wrap = (x: number) => {
  const w = x - Math.floor(x);
  return w > 1 - 1e-7 ? 0 : w;
};

/** Shortest Cartesian distance between two fractional points under PBC. */
function pbcDist(L: Lattice, f1: Vec3, f2: Vec3): number {
  const d: Vec3 = [f1[0] - f2[0], f1[1] - f2[1], f1[2] - f2[2]];
  let best = Infinity;
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (let k = -1; k <= 1; k++) {
        const r = norm(toCart(L, [d[0] - Math.round(d[0]) + i, d[1] - Math.round(d[1]) + j, d[2] - Math.round(d[2]) + k]));
        if (r < best) best = r;
      }
  return best;
}

/** "Fe2+", "O2-", "Fe+3", "Ca1", "OW", "CA" → element (+ optional charge). */
export function parseTypeSymbol(sym: string): { element: string | null; charge: number | null } {
  const m = sym.trim().match(/^([A-Za-z]{1,2})(.*)$/);
  if (!m) return { element: null, charge: null };
  let el: string | null = null;
  const two = m[1].length === 2 ? m[1][0].toUpperCase() + m[1][1].toLowerCase() : null;
  const one = m[1][0].toUpperCase();
  let rest = m[2];
  if (two && ELEMENTS[two]) el = two;
  else if (ELEMENTS[one]) {
    el = one;
    if (m[1].length === 2) rest = m[1][1] + rest;
  }
  let charge: number | null = null;
  const c1 = rest.match(/^(\d*\.?\d*)([+-])(?!\d)/); // 2+  2-  +  -
  const c2 = rest.match(/^([+-])(\d*\.?\d+)/); // +3  -2
  if (c1) charge = (c1[2] === "-" ? -1 : 1) * (c1[1] === "" ? 1 : parseFloat(c1[1]));
  else if (c2) charge = (c2[1] === "-" ? -1 : 1) * parseFloat(c2[2]);
  return { element: el, charge };
}

export function crystalFromCif(block: CifBlock): Crystal {
  const warnings: string[] = [];
  const num = (...tags: string[]) => cifNumber(getItem(block, ...tags));
  const a = num("_cell_length_a"),
    b = num("_cell_length_b"),
    c = num("_cell_length_c");
  const alpha = num("_cell_angle_alpha") || 90,
    beta = num("_cell_angle_beta") || 90,
    gamma = num("_cell_angle_gamma") || 90;
  if (!(a > 0 && b > 0 && c > 0)) throw new Error("格子定数 (_cell_length_a/b/c) が見つかりません。");
  const lattice = makeLattice(a, b, c, alpha, beta, gamma);

  // ---- symmetry ----
  let ops: SymOp[] = [];
  const hm = getItem(block, "_symmetry_space_group_name_H-M", "_space_group_name_H-M_alt", "_space_group_name_h-m_alt");
  const hall = getItem(block, "_symmetry_space_group_name_Hall", "_space_group_name_Hall");
  const itn = cifNumber(getItem(block, "_symmetry_Int_Tables_number", "_space_group_IT_number"));
  let sgSymbol = hm ?? "";
  let sgNumber: number | null = Number.isFinite(itn) ? itn : null;
  let source = "CIF 内の対称操作";
  const symLoop = getLoop(block, "_space_group_symop_operation_xyz", "_symmetry_equiv_pos_as_xyz");
  if (symLoop) {
    const col = Math.max(symLoop.col("_space_group_symop_operation_xyz"), symLoop.col("_symmetry_equiv_pos_as_xyz"));
    for (const row of symLoop.loop.rows) {
      try {
        ops.push(parseSymOp(row[col]));
      } catch (e) {
        warnings.push((e as Error).message);
      }
    }
  } else {
    const xyz = getItem(block, "_space_group_symop_operation_xyz", "_symmetry_equiv_pos_as_xyz");
    if (xyz) ops.push(parseSymOp(xyz));
  }
  if (ops.length <= 1) {
    const m = lookupSpaceGroup({ hm, hall, number: sgNumber ?? undefined });
    if (m && m.ops.length > ops.length) {
      ops = m.ops;
      sgSymbol = m.symbol;
      sgNumber = m.number;
      source = `空間群記号から生成 (${m.setting})`;
    } else if (ops.length === 0) {
      ops = [parseSymOp("x,y,z")];
      source = "対称情報なし（P1 として扱います）";
      warnings.push("対称操作も空間群記号も見つからないため P1 として展開しました。");
    }
  }
  if (!sgSymbol && sgNumber) sgSymbol = `#${sgNumber}`;

  // ---- oxidation numbers from _atom_type ----
  const typeOx = new Map<string, number>();
  const at = getLoop(block, "_atom_type_symbol");
  if (at) {
    const cs = at.col("_atom_type_symbol"),
      co = at.col("_atom_type_oxidation_number");
    if (co >= 0)
      for (const row of at.loop.rows) {
        const v = cifNumber(row[co]);
        if (Number.isFinite(v)) typeOx.set(row[cs], v);
      }
  }

  // ---- atom sites ----
  const asl = getLoop(block, "_atom_site_fract_x");
  if (!asl) throw new Error("原子座標 (_atom_site_fract_x) が見つかりません。");
  const col = asl.col;
  const cLabel = col("_atom_site_label"),
    cType = col("_atom_site_type_symbol"),
    cx = col("_atom_site_fract_x"),
    cy = col("_atom_site_fract_y"),
    cz = col("_atom_site_fract_z"),
    cOcc = col("_atom_site_occupancy"),
    cFlag = col("_atom_site_calc_flag");
  const sites: AsymSite[] = [];
  for (const row of asl.loop.rows) {
    if (cFlag >= 0 && row[cFlag]?.toLowerCase() === "dum") continue;
    const label = cLabel >= 0 ? row[cLabel] : `X${sites.length + 1}`;
    const typeSymbol = cType >= 0 && row[cType] !== "?" && row[cType] !== "." ? row[cType] : label;
    let { element, charge } = parseTypeSymbol(typeSymbol);
    if (!element) element = parseTypeSymbol(label).element;
    if (!element) {
      warnings.push(`元素を判別できないサイト ${label} を除外しました。`);
      continue;
    }
    let cifOx: number | null = typeOx.has(typeSymbol) ? typeOx.get(typeSymbol)! : null;
    if (cifOx === null && charge !== null && cType >= 0) cifOx = charge;
    const occRaw = cOcc >= 0 ? cifNumber(row[cOcc]) : 1;
    const frac: Vec3 = [cifNumber(row[cx]), cifNumber(row[cy]), cifNumber(row[cz])];
    if (frac.some((v) => !Number.isFinite(v))) {
      warnings.push(`サイト ${label} の座標が読めません。`);
      continue;
    }
    sites.push({ index: sites.length, label, element, typeSymbol, cifOx, occ: Number.isFinite(occRaw) ? occRaw : 1, frac, multiplicity: 0 });
  }
  if (sites.length === 0) throw new Error("原子サイトがありません。");

  // ---- expand by symmetry ----
  const TOL = 0.05; // Å
  type Raw = { site: number; frac: Vec3 };
  const raw: Raw[] = [];
  for (const s of sites) {
    const mine: Vec3[] = [];
    for (const op of ops) {
      const f = s.frac;
      const g: Vec3 = [
        wrap(op.R[0][0] * f[0] + op.R[0][1] * f[1] + op.R[0][2] * f[2] + op.t[0]),
        wrap(op.R[1][0] * f[0] + op.R[1][1] * f[1] + op.R[1][2] * f[2] + op.t[1]),
        wrap(op.R[2][0] * f[0] + op.R[2][1] * f[1] + op.R[2][2] * f[2] + op.t[2]),
      ];
      if (!mine.some((m) => pbcDist(lattice, m, g) < TOL)) mine.push(g);
    }
    s.multiplicity = mine.length;
    for (const g of mine) raw.push({ site: s.index, frac: g });
  }

  // ---- merge co-located sites (mixed occupancy) ----
  const positions: Position[] = [];
  for (const r of raw) {
    const p = positions.find((q) => pbcDist(lattice, q.frac, r.frac) < TOL);
    const occ = sites[r.site].occ;
    if (p) {
      if (!p.occupants.some((o) => o.site === r.site)) p.occupants.push({ site: r.site, occ });
    } else {
      positions.push({ index: positions.length, frac: r.frac, cart: toCart(lattice, r.frac), occupants: [{ site: r.site, occ }], main: r.site, group: "" });
    }
  }
  const groupMap = new Map<string, SiteGroup>();
  for (const p of positions) {
    p.occupants.sort((x, y) => y.occ - x.occ || x.site - y.site);
    p.main = p.occupants[0].site;
    p.group = [...p.occupants]
      .sort((x, y) => x.site - y.site)
      .map((o) => sites[o.site].label)
      .join("/");
    let g = groupMap.get(p.group);
    if (!g) {
      g = { key: p.group, sites: p.occupants.map((o) => o.site).sort((x, y) => x - y), positions: [] };
      groupMap.set(p.group, g);
    }
    g.positions.push(p.index);
  }
  const groups = [...groupMap.values()].sort((x, y) => x.sites[0] - y.sites[0]);
  if (positions.length > 4000) warnings.push(`単位胞内の原子数が多い (${positions.length}) ため動作が重くなる可能性があります。`);

  const title = getItem(block, "_chemical_name_mineral", "_chemical_name_common", "_chemical_name_systematic") ?? getItem(block, "_chemical_formula_sum") ?? block.name;

  return {
    title,
    lattice,
    spaceGroup: { symbol: sgSymbol.trim() || "?", number: sgNumber, source },
    nOps: ops.length,
    sites,
    positions,
    groups,
    warnings,
  };
}

/** Unit-cell contents per element (occupancy weighted). */
export function cellComposition(cr: Crystal): Record<string, number> {
  const comp: Record<string, number> = {};
  for (const p of cr.positions) for (const o of p.occupants) comp[cr.sites[o.site].element] = (comp[cr.sites[o.site].element] ?? 0) + o.occ;
  return comp;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

export function formulaString(cr: Crystal): { formula: string; Z: number } {
  const comp = cellComposition(cr);
  const els = Object.keys(comp).sort((x, y) => (ELEMENTS[x]?.X ?? 0) - (ELEMENTS[y]?.X ?? 0));
  // Z: largest divisor of the integer-valued counts that keeps every count a multiple of 0.001
  const intCounts = els.map((e) => comp[e]).filter((v) => Math.abs(v - Math.round(v)) < 1e-3 && Math.round(v) > 0).map(Math.round);
  const gInt = intCounts.reduce((acc, v) => gcd(acc, v), 0);
  let Z = 1;
  for (let d = gInt; d >= 1; d--) {
    if (gInt % d !== 0) continue;
    if (els.every((e) => Math.abs(comp[e] / d - Math.round((comp[e] / d) * 1000) / 1000) < 1e-6)) {
      Z = d;
      break;
    }
  }
  const g = Z;
  const fmt = (v: number) => {
    const r = v / g;
    if (Math.abs(r - 1) < 1e-6) return "";
    return Math.abs(r - Math.round(r)) < 1e-3 ? String(Math.round(r)) : r.toFixed(2).replace(/0+$/, "");
  };
  return { formula: els.map((e) => e + fmt(comp[e])).join(""), Z };
}

// ---------------------------------------------------------------------------
// Oxidation-state guessing (charge balance over common oxidation states)
// ---------------------------------------------------------------------------

export function guessOxidationStates(cr: Crystal): { byLabel: Record<string, number>; balance: number; guessed: boolean } {
  const byLabel: Record<string, number> = {};
  const comp: Record<string, number> = {};
  let fixedCharge = 0;
  const unknownEls = new Set<string>();
  for (const s of cr.sites) {
    const n = s.multiplicity * s.occ;
    if (s.cifOx !== null) {
      byLabel[s.label] = s.cifOx;
      fixedCharge += s.cifOx * n;
    } else {
      unknownEls.add(s.element);
      comp[s.element] = (comp[s.element] ?? 0) + n;
    }
  }
  if (unknownEls.size === 0) return { byLabel, balance: fixedCharge, guessed: false };

  const allEls = [...new Set(cr.sites.map((s) => s.element))];
  const maxX = Math.max(...allEls.map((e) => ELEMENTS[e]?.X ?? 0));
  const els = [...unknownEls];
  const cands = els.map((e) => {
    const info = ELEMENTS[e];
    const common = (info?.ox ?? []).filter((v) => v !== 0);
    const icsd = (info?.icsd ?? []).filter((v) => v !== 0 && !common.includes(v));
    const list: { ox: number; pen: number }[] = [];
    for (const v of common) list.push({ ox: v, pen: 0 });
    for (const v of icsd) list.push({ ox: v, pen: 0.3 });
    if (list.length === 0) list.push({ ox: 0, pen: 0 });
    const X = info?.X ?? 0;
    for (const c of list) {
      if (c.ox < 0 && X < maxX - 1e-6) c.pen += maxX - X < 0.35 ? 0.1 : 0.8; // only the most electronegative species should be anionic
      if (c.ox > 0 && X >= maxX - 1e-6 && allEls.length > 1) c.pen += 1.0;
    }
    return list;
  });
  // keep enumeration bounded
  let total = cands.reduce((p, l) => p * l.length, 1);
  if (total > 200000) {
    cands.forEach((l, i) => (cands[i] = l.filter((c) => c.pen < 0.3).length ? l.filter((c) => c.pen < 0.3) : l));
    total = cands.reduce((p, l) => p * l.length, 1);
  }
  const nAtoms = Object.values(comp).reduce((p, v) => p + v, 0) || 1;
  let best: { score: number; pick: number[]; bal: number } | null = null;
  const idx = new Array(els.length).fill(0);
  for (let k = 0; k < Math.min(total, 400000); k++) {
    let q = fixedCharge,
      pen = 0;
    for (let e = 0; e < els.length; e++) {
      const c = cands[e][idx[e]];
      q += c.ox * comp[els[e]];
      pen += c.pen;
    }
    const score = (Math.abs(q) / nAtoms) * 20 + pen;
    if (!best || score < best.score - 1e-9) best = { score, pick: idx.map((v, e) => cands[e][v].ox), bal: q };
    // increment mixed-radix counter
    for (let e = 0; e < els.length; e++) {
      idx[e]++;
      if (idx[e] < cands[e].length) break;
      idx[e] = 0;
    }
  }
  const pick = new Map(els.map((e, i) => [e, best!.pick[i]]));
  for (const s of cr.sites) if (s.cifOx === null) byLabel[s.label] = pick.get(s.element) ?? 0;
  return { byLabel, balance: best!.bal, guessed: true };
}

export function chargeBalance(cr: Crystal, ox: Record<string, number>): number {
  return cr.sites.reduce((p, s) => p + (ox[s.label] ?? 0) * s.multiplicity * s.occ, 0);
}

// ---------------------------------------------------------------------------
// Neighbour table
// ---------------------------------------------------------------------------

export interface Neighbor {
  j: number; // position index
  t: Vec3; // integer lattice translation of j
  d: number;
  v: Vec3; // Cartesian vector from i to the image of j
}

export function buildNeighborTable(cr: Crystal, rmax: number): Neighbor[][] {
  const L = cr.lattice;
  const n = L.recip.map((r) => Math.ceil(rmax * r) + 1) as Vec3;
  const P = cr.positions;
  const shifts: { t: Vec3; c: Vec3 }[] = [];
  for (let i = -n[0]; i <= n[0]; i++) for (let j = -n[1]; j <= n[1]; j++) for (let k = -n[2]; k <= n[2]; k++) shifts.push({ t: [i, j, k], c: toCart(L, [i, j, k]) });
  const r2 = rmax * rmax;
  return P.map((pi) => {
    const out: Neighbor[] = [];
    for (const pj of P) {
      const dx0 = pj.cart[0] - pi.cart[0],
        dy0 = pj.cart[1] - pi.cart[1],
        dz0 = pj.cart[2] - pi.cart[2];
      for (const s of shifts) {
        const dx = dx0 + s.c[0],
          dy = dy0 + s.c[1],
          dz = dz0 + s.c[2];
        const dd = dx * dx + dy * dy + dz * dz;
        if (dd > r2 || dd < 0.01) continue;
        out.push({ j: pj.index, t: s.t, d: Math.sqrt(dd), v: [dx, dy, dz] });
      }
    }
    out.sort((x, y) => x.d - y.d);
    return out;
  });
}
