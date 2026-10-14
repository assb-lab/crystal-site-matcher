// A "document" = one opened CIF with all of its per-structure settings.
import { CifBlock, parseCif } from "./cif";
import { MsgError } from "./messages";
import { BondSettings, deriveBonds } from "./bonding";
import { RadiusKind } from "./analysis";
import { Crystal } from "./structure";
import { DEFAULT_VIEW, ViewOptions, atomKey, defaultPolyElements } from "./scene";
import { DEFAULT_GRID_RES, DEFAULT_HOP_CUTOFF, prepareStructure } from "./pipeline";

export { deriveBonds, rmaxFor } from "./bonding";

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
  if (blocks.length === 0) throw new MsgError("err.noAtomBlock");
  const idx = Math.min(blockIdx, blocks.length - 1);
  const { crystal, ox, oxGuessed, bondSettings, mobile, formula } = prepareStructure(blocks[idx]);
  const { bonds } = deriveBonds(crystal, ox, bondSettings);
  const pref = preferSite ? crystal.groups.find((x) => x.key.split("/").includes(preferSite)) : undefined;
  const cationGroup =
    crystal.groups.find((x) => {
      const p = crystal.positions[x.positions[0]];
      const cn = bonds.bonded[p.index].length;
      return (ox[crystal.sites[p.main].label] ?? 0) > 0 && cn >= 4 && cn <= 8;
    }) ?? crystal.groups[0];
  const sel = pref ?? cationGroup;
  const base = fileName.replace(/\.(cif|mcif|txt)$/i, "");
  return {
    id: `doc${++counter}`,
    fileName,
    name: blocks.length > 1 ? `${base} · ${blocks[idx].name}` : base,
    formula,
    blocks,
    blockIdx: idx,
    crystal,
    oxGuessed,
    ox,
    bondSettings,
    view: { ...DEFAULT_VIEW, polyElements: defaultPolyElements(crystal, ox, bonds) },
    selectedKey: atomKey(sel.positions[0], [0, 0, 0]),
    hostSpin: "",
    radiusKind: "ionic",
    cutScope: "pair",
    mobile,
    hopCutoff: DEFAULT_HOP_CUTOFF,
    gridRes: DEFAULT_GRID_RES,
    colorSlot,
    thumb: null,
  };
}

export function docFromText(text: string, fileName: string, colorSlot: number, preferSite?: string): Doc {
  return createDoc(blocksWithAtoms(text), fileName, 0, colorSlot, preferSite);
}

/** Signature of everything that affects computed features. */
export function featureSig(d: Doc): string {
  return [d.id, d.blockIdx, JSON.stringify(d.ox), JSON.stringify(d.bondSettings), d.mobile, d.hopCutoff, d.gridRes].join("§");
}
