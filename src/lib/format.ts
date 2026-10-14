const SUP: Record<string, string> = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", ".": "·" };

export function ionLabel(el: string, ox: number | null | undefined, spin?: string): string {
  let s = el;
  if (ox !== null && ox !== undefined && ox !== 0) {
    const mag = Math.abs(ox);
    const m = mag === 1 ? "" : Number.isInteger(mag) ? String(mag) : mag.toFixed(2);
    s += [...(m + (ox > 0 ? "+" : "-"))].map((c) => SUP[c] ?? c).join("");
  }
  if (spin) s += ` ${spin}`;
  return s;
}

export const fmt = (x: number | null | undefined, d = 3) => (x === null || x === undefined || !Number.isFinite(x) ? "—" : x.toFixed(d));

export const pct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined || !Number.isFinite(x) ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.abs(x * 100).toFixed(d)}%`;

export const signed = (x: number, d = 0) => (x > 0 ? `+${x.toFixed(d)}` : x < 0 ? `−${Math.abs(x).toFixed(d)}` : "0");

export function rgbCss(c: [number, number, number]) {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
