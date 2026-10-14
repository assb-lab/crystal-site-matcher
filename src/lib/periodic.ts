// Periodic-table layout: 18 columns, 7 periods, plus the lanthanide / actinide rows.
import { ELEMENTS } from "./data";

export interface PtCell {
  el: string;
  Z: number;
  row: number; // 1–7 main table, 9 = lanthanides, 10 = actinides (row 8 is a spacer)
  col: number; // 1–18
}

export function ptPosition(Z: number): { row: number; col: number } | null {
  if (Z === 1) return { row: 1, col: 1 };
  if (Z === 2) return { row: 1, col: 18 };
  const block = (start: number, row: number) => {
    const i = Z - start; // 0-based within the period
    if (i < 2) return { row, col: i + 1 };
    return { row, col: i + 11 }; // p-block of short periods: 13–18
  };
  if (Z <= 10) return block(3, 2);
  if (Z <= 18) return block(11, 3);
  if (Z <= 36) return { row: 4, col: Z - 18 };
  if (Z <= 54) return { row: 5, col: Z - 36 };
  if (Z <= 56) return { row: 6, col: Z - 54 };
  if (Z <= 71) return { row: 9, col: Z - 57 + 3 };
  if (Z <= 86) return { row: 6, col: Z - 68 };
  if (Z <= 88) return { row: 7, col: Z - 86 };
  if (Z <= 103) return { row: 10, col: Z - 89 + 3 };
  if (Z <= 118) return { row: 7, col: Z - 100 };
  return null;
}

export const PT_CELLS: PtCell[] = Object.entries(ELEMENTS)
  // pymatgen also lists the isotopes D and T with Z = 1
  .filter(([el, info]) => info.Z >= 1 && info.Z <= 103 && el !== "D" && el !== "T")
  .map(([el, info]) => ({ el, Z: info.Z, ...ptPosition(info.Z)! }))
  .sort((a, b) => a.Z - b.Z);
