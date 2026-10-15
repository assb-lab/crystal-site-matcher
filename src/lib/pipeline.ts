// Feature pipeline shared by the app (useFeatures) and the command-line tool.
// Framework-free: no React, no DOM.
import { BondSettings, defaultBondSettings, deriveBonds } from "./bonding";
import { CifBlock } from "./cif";
import { FeatureValue, StaticFeatures, computeStaticFeatures, defaultMobile, ionicRadiusFn, mobileSiteEnergies } from "./features";
import { FrameworkField, GridResult, computeGrid } from "./bvse";
import { Crystal, crystalFromCif, formulaString, guessOxidationStates } from "./structure";
import { EnergyMinimum, findMinima, minimaFeatureValues } from "./landscape";
import { HopBarrier, hopBarrierFeatureValues, hopBarriers } from "./hopBarriers";
import type { Hop } from "./features";

export const DEFAULT_HOP_CUTOFF = 4.0; // Å
export const DEFAULT_GRID_RES = 0.2; // Å
export const GRID_MAX_POINTS = 260000;
export const GRID_E_CAP = 6; // eV

export interface Structure {
  crystal: Crystal;
  formula: string;
  ox: Record<string, number>;
  oxGuessed: boolean;
  bondSettings: BondSettings;
  mobile: string | null;
}

/**
 * Parse one CIF data block into a crystal with oxidation states, default bond cutoffs and mobile ion.
 * `oxOverride` maps a site label or an element symbol to an oxidation state (labels win).
 * `mobile`: undefined = automatic, null = none.
 */
export function prepareStructure(block: CifBlock, opts: { oxOverride?: Record<string, number>; mobile?: string | null } = {}): Structure {
  const crystal = crystalFromCif(block);
  const g = guessOxidationStates(crystal);
  const ox = { ...g.byLabel };
  let overridden = false;
  for (const s of crystal.sites) {
    const v = opts.oxOverride?.[s.label] ?? opts.oxOverride?.[s.element];
    if (v !== undefined) {
      ox[s.label] = v;
      overridden = true;
    }
  }
  const bondSettings = defaultBondSettings(crystal, ox);
  const mobile = opts.mobile === undefined ? defaultMobile(crystal, ox) : opts.mobile;
  return { crystal, formula: formulaString(crystal).formula, ox, oxGuessed: g.guessed && !overridden, bondSettings, mobile };
}

export interface GridStage {
  grid: GridResult;
  siteE: { pos: number; group: string; E: number }[] | null;
  /** Stable sites of the mobile ion on the BVSE landscape (null without energies). */
  minima: EnergyMinimum[] | null;
  /** BVSE barrier of each hop passed in (same order), null without energies */
  barriers: (HopBarrier | null)[] | null;
  values: Record<string, FeatureValue>;
}

/** Feature values derived from the BVSE / void grid. */
export function gridFeatureValues(grid: GridResult, siteE: GridStage["siteE"]): Record<string, FeatureValue> {
  const vals: Record<string, FeatureValue> = {
    E_1D: Number.isFinite(grid.E[0]) ? grid.E[0] : null,
    E_2D: Number.isFinite(grid.E[1]) ? grid.E[1] : null,
    E_3D: Number.isFinite(grid.E[2]) ? grid.E[2] : null,
    E_a: Number.isFinite(grid.Eaxis[0]) ? grid.Eaxis[0] : null,
    E_b: Number.isFinite(grid.Eaxis[1]) ? grid.Eaxis[1] : null,
    E_c: Number.isFinite(grid.Eaxis[2]) ? grid.Eaxis[2] : null,
    E_axis_range: grid.Eaxis.every(Number.isFinite) ? Math.max(...grid.Eaxis) - Math.min(...grid.Eaxis) : null,
    R_1D: Number.isNaN(grid.R[0]) ? null : grid.R[0],
    R_2D: Number.isNaN(grid.R[1]) ? null : grid.R[1],
    R_3D: Number.isNaN(grid.R[2]) ? null : grid.R[2],
    R_a: Number.isNaN(grid.Raxis[0]) ? null : grid.Raxis[0],
    R_b: Number.isNaN(grid.Raxis[1]) ? null : grid.Raxis[1],
    R_c: Number.isNaN(grid.Raxis[2]) ? null : grid.Raxis[2],
    maxVoid: grid.maxVoid,
    siteE_sd: null,
    siteE_range: null,
  };
  if (siteE && siteE.length) {
    const Es = siteE.map((s) => s.E);
    const m = Es.reduce((a, b) => a + b, 0) / Es.length;
    vals.siteE_sd = Math.sqrt(Es.reduce((a, b) => a + (b - m) ** 2, 0) / Es.length);
    vals.siteE_range = Math.max(...Es) - Math.min(...Es);
  }
  return vals;
}

export function staticStage(s: Pick<Structure, "crystal" | "ox" | "bondSettings" | "mobile">, hopCutoff: number): StaticFeatures {
  const { table, bonds } = deriveBonds(s.crystal, s.ox, s.bondSettings);
  return computeStaticFeatures(s.crystal, s.ox, bonds, table, { mobileEl: s.mobile, hopCutoff });
}

export const hasMobile = (s: Pick<Structure, "crystal" | "mobile">) => !!s.mobile && s.crystal.sites.some((x) => x.element === s.mobile);

/** BVSE energy and void grid for the mobile ion. Returns null when cancelled. */
export async function gridStage(
  s: Pick<Structure, "crystal" | "ox" | "bondSettings" | "mobile">,
  resolution: number,
  onProgress?: (f: number) => void,
  isCancelled?: () => boolean,
  hops: Hop[] = [],
): Promise<GridStage | null> {
  if (!s.mobile) throw new Error("gridStage needs a mobile ion");
  const { bonds } = deriveBonds(s.crystal, s.ox, s.bondSettings);
  const field = new FrameworkField(s.crystal, s.ox, s.mobile, ionicRadiusFn(s.crystal, s.ox, bonds), 8);
  const grid = await computeGrid(field, s.crystal, { resolution, maxPoints: GRID_MAX_POINTS, eCap: GRID_E_CAP }, onProgress, isCancelled);
  if (!grid) return null;
  const siteE = grid.energy ? mobileSiteEnergies(s.crystal, field, s.mobile, grid.eMinAbs) : null;
  const minima = grid.energy ? findMinima(s.crystal, field, grid, s.mobile) : null;
  const barriers = await hopBarriers(s.crystal, grid, field, hops, isCancelled);
  if (isCancelled?.()) return null;
  return {
    grid,
    siteE,
    minima,
    barriers,
    values: { ...gridFeatureValues(grid, siteE), ...minimaFeatureValues(s.crystal, minima), ...hopBarrierFeatureValues(hops, barriers) },
  };
}
