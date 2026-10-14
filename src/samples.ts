import LiFePO4 from "./samples/LiFePO4.cif?raw";
import YAG from "./samples/Y3Al5O12.cif?raw";
import Spinel from "./samples/MgAl2O4.cif?raw";
import LiCoO2 from "./samples/LiCoO2.cif?raw";
import SrTiO3 from "./samples/SrTiO3.cif?raw";
import Rutile from "./samples/TiO2_rutile.cif?raw";
import AgI from "./samples/AgI_alpha.cif?raw";
import Li3N from "./samples/Li3N.cif?raw";

export interface Sample {
  id: string; // display name: i18n key sample.<id>
  text: string;
  /** Site label to select first. */
  site: string;
}

export const SAMPLES: Sample[] = [
  { id: "LiFePO4", text: LiFePO4, site: "Fe1" },
  { id: "LiCoO2", text: LiCoO2, site: "Co1" },
  { id: "Li3N", text: Li3N, site: "Li2" },
  { id: "AgI_alpha", text: AgI, site: "Ag1" },
  { id: "YAG", text: YAG, site: "Y1" },
  { id: "spinel", text: Spinel, site: "Mg1" },
  { id: "SrTiO3", text: SrTiO3, site: "Sr1" },
  { id: "rutile", text: Rutile, site: "Ti1" },
];

/** Opened at start-up so the sidebar and comparison have something to show. */
export const STARTUP_SAMPLES = ["LiFePO4", "LiCoO2", "Li3N", "AgI_alpha"];
