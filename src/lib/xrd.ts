// Simulated powder X-ray diffraction (kinematic, no absorption/thermal factors).
// Atomic scattering factors: f(s) = Z − 41.78214 · s² · Σ a_i exp(−b_i s²), s = sinθ/λ (pymatgen convention).
import xsRaw from "../data/xray_scattering.json";
import { ELEMENTS } from "./data";
import type { Crystal } from "./structure";

const XS = xsRaw as unknown as Record<string, [number, number][]>;

export interface XrdPeak {
  twoTheta: number;
  intensity: number; // normalised to 100
  hkl: [number, number, number];
  d: number;
  mult: number;
}

export interface XrdPattern {
  wavelength: number;
  peaks: XrdPeak[];
  profile: { x: number; y: number }[];
}

/** Prefer the conventional representative: fewest negative indices, then lexicographically largest (h ≥ k ≥ l). */
function betterHkl(a: number[], b: number[]): boolean {
  const neg = (v: number[]) => v.filter((x) => x < 0).length;
  if (neg(a) !== neg(b)) return neg(a) < neg(b);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

export function simulateXrd(cr: Crystal, opts: { wavelength?: number; tthMin?: number; tthMax?: number; fwhm?: number } = {}): XrdPattern {
  const lam = opts.wavelength ?? 1.5406;
  const tthMin = opts.tthMin ?? 5,
    tthMax = opts.tthMax ?? 90,
    fwhm = opts.fwhm ?? 0.12;
  const inv = cr.lattice.inv; // rows = reciprocal vectors (no 2π)
  const sMax = (2 * Math.sin(((tthMax / 2) * Math.PI) / 180)) / lam; // 1/d max
  // h = G·A, so |G| ≤ sMax bounds |h| by sMax·a (likewise k, l); unlike sMax/|a*| this holds in oblique cells,
  // where large indices can still give a short G
  const L = cr.lattice;
  const hmax = [L.a, L.b, L.c].map((len) => Math.floor(sMax * len + 1e-9));
  const atoms = cr.positions.flatMap((p) => p.occupants.map((o) => ({ f: p.frac, el: cr.sites[o.site].element, occ: o.occ })));
  const fCache = new Map<string, number>();
  const fAt = (el: string, s: number) => {
    const key = `${el}|${s.toFixed(4)}`;
    const c = fCache.get(key);
    if (c !== undefined) return c;
    const Z = ELEMENTS[el]?.Z ?? 0;
    const prm = XS[el];
    const s2 = s * s;
    let sum = 0;
    if (prm) for (const [a, b] of prm) sum += a * Math.exp(-b * s2);
    const f = Z - 41.78214 * s2 * sum;
    fCache.set(key, f);
    return f;
  };
  const merged = new Map<string, XrdPeak>();
  for (let h = -hmax[0]; h <= hmax[0]; h++)
    for (let k = -hmax[1]; k <= hmax[1]; k++)
      for (let l = -hmax[2]; l <= hmax[2]; l++) {
        if (!h && !k && !l) continue;
        const g = [0, 1, 2].map((c) => h * inv[0][c] + k * inv[1][c] + l * inv[2][c]);
        const gl = Math.hypot(g[0], g[1], g[2]);
        if (gl > sMax) continue;
        const d = 1 / gl;
        const sinT = lam / (2 * d);
        if (sinT >= 1) continue;
        const theta = Math.asin(sinT);
        const tth = (2 * theta * 180) / Math.PI;
        if (tth < tthMin) continue;
        const s = sinT / lam;
        let re = 0,
          im = 0;
        for (const a of atoms) {
          const ph = 2 * Math.PI * (h * a.f[0] + k * a.f[1] + l * a.f[2]);
          const f = fAt(a.el, s) * a.occ;
          re += f * Math.cos(ph);
          im += f * Math.sin(ph);
        }
        const F2 = re * re + im * im;
        if (F2 < 1e-6) continue;
        const lp = (1 + Math.cos(2 * theta) ** 2) / (Math.sin(theta) ** 2 * Math.cos(theta));
        const key = tth.toFixed(3);
        const cur = merged.get(key);
        if (cur) {
          cur.intensity += F2 * lp;
          cur.mult++;
          if (betterHkl([h, k, l], cur.hkl)) cur.hkl = [h, k, l];
        } else merged.set(key, { twoTheta: tth, intensity: F2 * lp, hkl: [h, k, l], d, mult: 1 });
      }
  const peaks = [...merged.values()].sort((a, b) => a.twoTheta - b.twoTheta);
  const max = Math.max(1e-9, ...peaks.map((p) => p.intensity));
  for (const p of peaks) p.intensity = (p.intensity / max) * 100;
  const visible = peaks.filter((p) => p.intensity >= 0.05);

  // pseudo-Voigt profile (η = 0.5)
  const profile: { x: number; y: number }[] = [];
  const step = 0.02;
  const sig = fwhm / 2.3548,
    gam = fwhm / 2;
  const raw: number[] = [];
  for (let x = tthMin; x <= tthMax + 1e-9; x += step) {
    let y = 0;
    for (const p of visible) {
      const dx = x - p.twoTheta;
      if (Math.abs(dx) > 12 * fwhm) continue;
      y += p.intensity * (0.5 * Math.exp((-dx * dx) / (2 * sig * sig)) + 0.5 / (1 + (dx * dx) / (gam * gam)));
    }
    raw.push(y);
    profile.push({ x: +x.toFixed(3), y });
  }
  const pm = Math.max(1e-9, ...raw);
  for (const p of profile) p.y = (p.y / pm) * 100;
  return { wavelength: lam, peaks: visible, profile };
}
