import LiFePO4 from "./samples/LiFePO4.cif?raw";
import YAG from "./samples/Y3Al5O12.cif?raw";
import Spinel from "./samples/MgAl2O4.cif?raw";
import LiCoO2 from "./samples/LiCoO2.cif?raw";
import SrTiO3 from "./samples/SrTiO3.cif?raw";
import Rutile from "./samples/TiO2_rutile.cif?raw";

export interface Sample {
  id: string;
  name: string;
  text: string;
  /** Site label to select first. */
  site: string;
}

export const SAMPLES: Sample[] = [
  { id: "LiFePO4", name: "LiFePO₄ オリビン", text: LiFePO4, site: "Fe1" },
  { id: "YAG", name: "Y₃Al₅O₁₂ ガーネット", text: YAG, site: "Y1" },
  { id: "spinel", name: "MgAl₂O₄ スピネル", text: Spinel, site: "Mg1" },
  { id: "LiCoO2", name: "LiCoO₂ 層状岩塩", text: LiCoO2, site: "Co1" },
  { id: "SrTiO3", name: "SrTiO₃ ペロブスカイト", text: SrTiO3, site: "Sr1" },
  { id: "rutile", name: "TiO₂ ルチル", text: Rutile, site: "Ti1" },
];
