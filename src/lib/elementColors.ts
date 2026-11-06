// User-chosen element colours (#74): one palette for every structure, kept in localStorage as
// {"Li": "#aabbcc", ...}. Elements without an entry use the VESTA default (ELEMENTS[el].col).
import { ELEMENTS } from "./data";
import { storage } from "./storage";

export type Rgb = [number, number, number];
export type ElementColors = Record<string, Rgb>;

export const ELEMENT_COLORS_KEY = "csm.elementColors";

/** "#rrggbb" of an RGB triple (channels rounded and clamped to 0–255). */
export function rgbHex(c: Rgb): string {
  return "#" + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** RGB of "#rrggbb" (case-insensitive), or null for anything else. */
export function hexRgb(s: string): Rgb | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

/** Palette from its stored JSON; unknown elements, bad colours and malformed text are dropped. */
export function parseElementColors(text: string | null): ElementColors {
  if (!text) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ElementColors = {};
  for (const [el, v] of Object.entries(raw)) {
    const c = typeof v === "string" ? hexRgb(v) : null;
    if (c && ELEMENTS[el]) out[el] = c;
  }
  return out;
}

export function serializeElementColors(c: ElementColors): string {
  return JSON.stringify(Object.fromEntries(Object.keys(c).sort().map((el) => [el, rgbHex(c[el])])));
}

export const loadElementColors = () => parseElementColors(storage.get(ELEMENT_COLORS_KEY));
export const saveElementColors = (c: ElementColors) => storage.set(ELEMENT_COLORS_KEY, serializeElementColors(c));

/**
 * Preset colours of the picker, one row per line: greys, saturated hues, then four lighter and three darker
 * steps of each hue (the usual document-editor grid).
 */
export const PALETTE: string[][] = [
  ["#000000", "#434343", "#666666", "#999999", "#b7b7b7", "#cccccc", "#d9d9d9", "#efefef", "#f3f3f3", "#ffffff"],
  ["#980000", "#ff0000", "#ff9900", "#ffff00", "#00ff00", "#00ffff", "#4a86e8", "#0000ff", "#9900ff", "#ff00ff"],
  ["#e6b8af", "#f4cccc", "#fce5cd", "#fff2cc", "#d9ead3", "#d0e0e3", "#c9daf8", "#cfe2f3", "#d9d2e9", "#ead1dc"],
  ["#dd7e6b", "#ea9999", "#f9cb9c", "#ffe599", "#b6d7a8", "#a2c4c9", "#a4c2f4", "#9fc5e8", "#b4a7d6", "#d5a6bd"],
  ["#cc4125", "#e06666", "#f6b26b", "#ffd966", "#93c47d", "#76a5af", "#6d9eeb", "#6fa8dc", "#8e7cc3", "#c27ba0"],
  ["#a61c00", "#cc0000", "#e69138", "#f1c232", "#6aa84f", "#45818e", "#3c78d8", "#3d85c6", "#674ea7", "#a64d79"],
  ["#85200c", "#990000", "#b45f06", "#bf9000", "#38761d", "#134f5c", "#1155cc", "#0b5394", "#351c75", "#741b47"],
  ["#5b0f00", "#660000", "#783f04", "#7f6000", "#274e13", "#0c343d", "#1c4587", "#073763", "#20124d", "#4c1130"],
];

/** Hue (0–360°), saturation and value (0–1) of an RGB colour; grey has hue 0. */
export function rgbHsv([r, g, b]: Rgb): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B),
    d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === R) h = 60 * (((G - B) / d) % 6);
    else if (max === G) h = 60 * ((B - R) / d + 2);
    else h = 60 * ((R - G) / d + 4);
  }
  return [(h + 360) % 360, max > 0 ? d / max : 0, max];
}

/** RGB of a hue (degrees, any value), saturation and value (clamped to 0–1). */
export function hsvRgb(h: number, s: number, v: number): Rgb {
  const S = Math.max(0, Math.min(1, s)),
    V = Math.max(0, Math.min(1, v));
  const f = (n: number) => {
    const k = (n + (((h % 360) + 360) % 360) / 60) % 6;
    return Math.round(255 * (V - V * S * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}
