// A "document" = one opened CIF with all of its per-structure settings.
import { CifBlock, parseCif } from "./cif";
import { BondSettings, BondTable, computeBonds, defaultBondSettings } from "./bonding";
import { RadiusKind } from "./analysis";
import { Crystal, Neighbor, buildNeighborTable, crystalFromCif, formulaString, guessOxidationStates } from "./structure";
import { DEFAULT_VIEW, ViewOptions, atomKey, defaultPolyElements } from "./scene";
import { defaultMobile } from "./features";

export interface Doc {
  id: string;
  fileName: string;
  name: string; // short display name
  formula: string;
  blocks: CifBlock[];
  blockIdx: number;
  crystal: Crystal;
  oxGuessed: boolean;
  ox: Record<string, number>;
  bondSettings: BondSettings;
  view: ViewOptions;
  selectedKey: string | null;
  hostSite?: number;
  hostSpin: "" | "HS" | "LS";
  radiusKind: RadiusKind;
  cutScope: "pair" | "site";
  mobile: string | null;
  hopCutoff: number;
  gridRes: number;
  colorSlot: number;
  thumb: string | null;
}

let counter = 0;

export function blocksWithAtoms(text: string): CifBlock[] {
  return parseCif(text).filter((b) => b.loops.some((l) => l.tags.includes("_atom_site_fract_x")));
}

export function createDoc(blocks: CifBlock[], fileName: string, blockIdx: number, colorSlot: number, preferSite?: string): Doc {
  if (blocks.length === 0) throw new Error("原子座標を含むデータブロックが見つかりません（_atom_site_fract_x が必要です）。");
  const idx = Math.min(blockIdx, blocks.length - 1);
  const crystal = crystalFromCif(blocks[idx]);
  const g = guessOxidationStates(crystal);
  const ox = g.byLabel;
  const bondSettings = defaultBondSettings(crystal, ox);
  const { bonds } = deriveBonds(crystal, ox, bondSettings);
  const pref = preferSite ? crystal.groups.find((x) => x.key.split("/").includes(preferSite)) : undefined;
  const cationGroup =
    crystal.groups.find((x) => {
      const p = crystal.positions[x.positions[0]];
      const cn = bonds.bonded[p.index].length;
      return (ox[crystal.sites[p.main].label] ?? 0) > 0 && cn >= 4 && cn <= 8;
    }) ?? crystal.groups[0];
  const sel = pref ?? cationGroup;
  const { formula } = formulaString(crystal);
  const base = fileName.replace(/\.(cif|mcif|txt)$/i, "");
  return {
    id: `doc${++counter}`,
    fileName,
    name: blocks.length > 1 ? `${base} · ${blocks[idx].name}` : base,
    formula,
    blocks,
    blockIdx: idx,
    crystal,
    oxGuessed: g.guessed,
    ox,
    bondSettings,
    view: { ...DEFAULT_VIEW, polyElements: defaultPolyElements(crystal, ox, bonds) },
    selectedKey: atomKey(sel.positions[0], [0, 0, 0]),
    hostSpin: "",
    radiusKind: "ionic",
    cutScope: "pair",
    mobile: defaultMobile(crystal, ox),
    hopCutoff: 4.0,
    gridRes: 0.2,
    colorSlot,
    thumb: null,
  };
}

export function docFromText(text: string, fileName: string, colorSlot: number, preferSite?: string): Doc {
  return createDoc(blocksWithAtoms(text), fileName, 0, colorSlot, preferSite);
}

// ---- memoised neighbour table / bonds (keyed on object identity) ----
const tableCache = new WeakMap<Crystal, Map<number, Neighbor[][]>>();
const bondCache = new WeakMap<Neighbor[][], WeakMap<Record<string, number>, WeakMap<BondSettings, BondTable>>>();

export function rmaxFor(bs: BondSettings) {
  const vals = [...Object.values(bs.pairs).map((p) => p.max), ...Object.values(bs.siteOverride)];
  return Math.max(6, Math.ceil(Math.max(...vals, 0) + 1.5));
}

export function deriveBonds(crystal: Crystal, ox: Record<string, number>, bs: BondSettings): { table: Neighbor[][]; bonds: BondTable; rmax: number } {
  const rmax = rmaxFor(bs);
  let byR = tableCache.get(crystal);
  if (!byR) {
    byR = new Map();
    tableCache.set(crystal, byR);
  }
  let table = byR.get(rmax);
  if (!table) {
    table = buildNeighborTable(crystal, rmax);
    byR.set(rmax, table);
  }
  let a = bondCache.get(table);
  if (!a) {
    a = new WeakMap();
    bondCache.set(table, a);
  }
  let b = a.get(ox);
  if (!b) {
    b = new WeakMap();
    a.set(ox, b);
  }
  let bonds = b.get(bs);
  if (!bonds) {
    bonds = computeBonds(crystal, ox, bs, table);
    b.set(bs, bonds);
  }
  return { table, bonds, rmax };
}

/** Signature of everything that affects computed features. */
export function featureSig(d: Doc): string {
  return [d.id, d.blockIdx, JSON.stringify(d.ox), JSON.stringify(d.bondSettings), d.mobile, d.hopCutoff, d.gridRes].join("§");
}
