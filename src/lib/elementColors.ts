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
