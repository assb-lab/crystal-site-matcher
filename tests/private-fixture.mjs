// Checks on the sulphide electrolytes (see private.test.mjs): usage `node tests/private-fixture.mjs <mode> <cif>`.
// Expected values are worked out by hand from the site occupancies and Shannon radii, or are
// properties of the BVSE landscape that do not depend on the grid spacing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const [mode, path] = process.argv.slice(2);
const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const r = await x.extractFromText(await readFile(path, 'utf8'), path, { grid: 0.25 });
  assert.deepEqual(r.errors, []);
  const rec = r.records[0];
  const v = rec.values;
  const near = (key, want, tol = 1e-4) => assert.ok(v[key] !== null && Math.abs(v[key] - want) < tol, `${key}: ${v[key]} vs ${want}`);
  const H = (xs) => -xs.reduce((s, p) => s + p * Math.log(p), 0);
  assert.equal(rec.mobile, 'Li');
  assert.equal(v.hopDim, 3);

  if (mode === 'argyrodite') {
    // Li6PS5Cl, F-43m: 4a = Cl 0.385 / S 0.615, 4d = Cl 0.615 / S 0.385, 16e S of PS4, Li on 48h
    assert.equal(rec.formula, 'Li6PS5Cl');
    const a = v.a;
    // the 4a and 4d anions are bonded to Li only: 8 of the 24 anion sites, 4a–4d = a√3/4 apart, in 12-Li cages
    near('isoAnion_frac', 1 / 3);
    near('isoAnion_dXX', (a * Math.sqrt(3)) / 4);
    near('isoAnion_cn', 12);
    near('isoAnion_rho', (8 / a ** 3) * 1000);
    // S/Cl mixing on 4a and 4d, nothing on 16e: averages over 4 + 4 + 16 anion sites
    const x1 = 0.385,
      x2 = 0.615;
    near('mixEntropy_anion', (8 * H([x1, x2])) / 24);
    near('chargeDisorder_anion', (8 * Math.sqrt(x1 * x2)) / 24); // Cl⁻ vs S²⁻
    const rCl = 1.81,
      rS = 1.84; // Shannon (VI)
    const delta = (xCl) => (Math.sqrt(xCl * (1 - xCl)) * (rS - rCl)) / (xCl * rCl + (1 - xCl) * rS);
    near('radiusDisorder_anion', (4 * delta(x1) + 4 * delta(x2)) / 24, 1e-6);
    near('mixEntropy_frame', 0);
    // ionic potential |q|/r of the isolated sites: their 4a / 4d imbalance; the PS4 sulphur widens the all-anion range
    const pot = (xCl) => xCl / rCl + (1 - xCl) * (2 / rS);
    near('ionPot_isoAnion', (pot(x1) + pot(x2)) / 2);
    near('ionPot_isoAnion_range', Math.abs(pot(x1) - pot(x2)));
    near('ionPot_anion_range', 2 / rS - pot(x2));
    // Li in tetrahedra, P in PS4 tetrahedra
    assert.equal(v.mobile_tet_frac, 1);
    assert.equal(v.frame_tet_frac, 1);
    assert.equal(v.cn_mobile_sd, 0);
    // BVSE: 3D at once; the Li hop network reaches it; low-energy empty sites besides the 48h Li sites
    assert.equal(v.E_1D, v.E_3D);
    assert.ok(v.E_1D > 0.3 && v.E_1D < 0.5, `E_1D ${v.E_1D}`);
    assert.ok(Math.abs(v.E_hop_3D - v.E_3D) < 0.05, `E_hop_3D ${v.E_hop_3D}`);
    near('hop_asymmetry', 0, 1e-2);
    assert.equal(rec.sites.filter((s) => s.kind === 'site').length, 48);
    assert.ok(v.n_interstitial >= 16 && v.E_interstitial_min < 0.1, `${v.n_interstitial} empty sites, lowest ${v.E_interstitial_min} eV`);
  } else if (mode === 'lgps') {
    // Li10GeP2S12, P4₂/nmc: Ge 0.5 / P 0.5 on 4d, P on 2b, three ordered S sites, four partly occupied Li sites
    assert.match(rec.formula, /^Li10(\.\d+)?GeP2S12$/); // the Li occupancies add up to 10.03 per formula unit
    // framework mixing on 4d (Ge⁴⁺ / P⁵⁺), averaged over 4 + 2 framework sites
    near('mixEntropy_frame', (4 * Math.log(2)) / 6);
    near('chargeDisorder_frame', (4 * 0.5) / 6);
    const rGe = 0.39,
      rP = 0.17; // Shannon (IV)
    near('radiusDisorder_frame', (4 * ((0.5 * (rGe - rP)) / ((rGe + rP) / 2))) / 6, 1e-6);
    near('mixEntropy_anion', 0);
    // every S belongs to a PS4 / GeS4 tetrahedron
    near('isoAnion_frac', 0);
    assert.equal(v.ionPot_isoAnion_range, null);
    assert.equal(v.frame_tet_frac, 1);
    // tetrahedral and octahedral Li sites
    assert.equal(v.cn_mobile_min, 4);
    assert.equal(v.cn_mobile_max, 6);
    assert.ok(v.mobile_tet_frac > 0 && v.mobile_oct_frac > 0);
    // BVSE: the 1D channel along c opens before 3D, and the Li hop network follows the grid
    assert.ok(v.E_1D < v.E_3D, `E_1D ${v.E_1D} < E_3D ${v.E_3D}`);
    assert.ok(Math.abs(v.E_hop_1D - v.E_1D) < 0.05, `E_hop_1D ${v.E_hop_1D} vs E_1D ${v.E_1D}`);
    assert.ok(v.hop_asymmetry > 0.05, 'four Li sites of different energy');
    // a BVSE minimum on each of the four Li sites
    assert.deepEqual([...new Set(rec.sites.filter((s) => s.kind === 'site').map((s) => s.nearest))].sort(), ['Li1', 'Li2', 'Li3', 'Li4']);
  } else throw new Error(`unknown mode ${mode}`);
} finally {
  await server.close();
}
