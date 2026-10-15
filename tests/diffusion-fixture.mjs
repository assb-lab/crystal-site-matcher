// Checks of the dilute-limit diffusion tensor (#37) against random walks with known answers, and on the samples.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const Dm = await server.ssrLoadModule('/src/lib/diffusion.ts');
  const { blocksWithAtoms } = await server.ssrLoadModule('/src/lib/doc.ts');
  const rel = (a, b, tol, msg) => assert.ok(Math.abs(a / b - 1) < tol, `${msg}: ${a} vs ${b}`);
  const kT = Dm.K_B * 300;
  const cell = (a, b, c, atoms) =>
    p.prepareStructure(
      blocksWithAtoms(`data_t
_cell_length_a ${a}
_cell_length_b ${b}
_cell_length_c ${c}
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma 90
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
${atoms}
`)[0],
    ).crystal;
  const bar = (Esad, Ea, Eb) => ({ Esad, Ea, Eb, fwd: Esad - Ea, rev: Esad - Eb, saddle: [0, 0, 0] });

  // one site per orthorhombic cell, jumps ±a, ±b, ±c with rate k each way: D_xx = k a² (and so on)
  {
    const cr = cell(3, 4, 5, 'Li1 Li+ 0 0 0');
    const hops = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((t, i) => ({ a: 0, b: 0, t, d: [3, 4, 5][i], rb: 0.5, mid: [0, 0, 0] }));
    const Es = [0.2, 0.3, 0.9];
    const d = Dm.diffusionTensor(cr, hops, Es.map((e) => bar(e, 0, 0)), 300);
    [3, 4, 5].forEach((L, i) => rel(d.D[i][i], Dm.NU0 * Math.exp(-Es[i] / kT) * L * L * 1e-16, 1e-9, `D_${'xyz'[i]}`));
    assert.ok(Math.abs(d.D[0][1]) < 1e-12 * d.D[0][0] && Math.abs(d.D[1][2]) < 1e-12 * d.D[0][0]);
    rel(d.axis[1], d.D[1][1], 1e-12, 'D along b');
    // the c hop is 0.7 eV above the a hop: about 1e-12 of D_x, below the 1e-6 counted as diffusion
    assert.equal(d.dim, 2);
    const v = Dm.diffusionFeatureValues(cr, hops, Es.map((e) => bar(e, 0, 0)));
    assert.equal(v.logD_c, null);
    assert.equal(v.D_dim, 2);
  }
  // two unequal sites on a chain along a, at x = 0 and 0.3: the corrector makes the jumps add in series,
  // D = L² / Σ_edges 1/w_e with w_e = π_i k_ij = ν₀ exp(−E_saddle/kT) / Z, Z = Σ_i exp(−E_i/kT)
  {
    const L = 6;
    const cr = cell(L, 20, 20, 'Li1 Li+ 0 0 0\nLi2 Li+ 0.3 0 0');
    const hops = [
      { a: 0, b: 1, t: [0, 0, 0], d: 0.3 * L, rb: 0.5, mid: [0, 0, 0] },
      { a: 1, b: 0, t: [1, 0, 0], d: 0.7 * L, rb: 0.5, mid: [0, 0, 0] },
    ];
    const [E1, E2, S1, S2] = [0, 0.08, 0.3, 0.45];
    const bs = [bar(S1, E1, E2), bar(S2, E2, E1)];
    const Z = 1 + Math.exp(-E2 / kT);
    const w = [S1, S2].map((S) => (Dm.NU0 * Math.exp(-S / kT)) / Z);
    const d = Dm.diffusionTensor(cr, hops, bs, 300);
    rel(d.D[0][0], (L * L * 1e-16) / (1 / w[0] + 1 / w[1]), 1e-9, 'series chain');
    assert.equal(d.dim, 1);
    // the naive sum Σ w Δr² (no corrector) would be larger
    assert.ok(d.D[0][0] < (w[0] * (0.3 * L) ** 2 + w[1] * (0.7 * L) ** 2) * 1e-16);
    // Arrhenius slope: the chain is limited by the higher saddle, measured from the lower site
    const v = Dm.diffusionFeatureValues(cr, hops, bs);
    assert.ok(Math.abs(v.Ea_D - S2) < 0.03, `Ea_D ${v.Ea_D}`);
  }

  const run = async (f) => {
    const s = p.prepareStructure(blocksWithAtoms(await readFile(`src/samples/${f}.cif`, 'utf8'))[0]);
    const st = p.staticStage(s, p.DEFAULT_HOP_CUTOFF);
    return (await p.gridStage(s, 0.2, undefined, undefined, st.hops)).values;
  };
  {
    // LiFePO4: one-dimensional along b, activated by the b-channel barrier
    const v = await run('LiFePO4');
    assert.equal(v.D_dim, 1);
    assert.ok(v.logD_b !== null && v.logD_a === null && v.logD_c === null);
    assert.ok(Math.abs(v.Ea_D - v.E_hop_1D) < 0.03, `LiFePO4 Ea_D ${v.Ea_D} vs ${v.E_hop_1D}`);
  }
  {
    // LiCoO2: two-dimensional in the Li layers
    const v = await run('LiCoO2');
    assert.equal(v.D_dim, 2);
    assert.equal(v.logD_c, null);
    assert.ok(Math.abs(v.logD_a - v.logD_b) < 1e-9);
  }
  {
    // LGPS: 3D, faster along c than in the ab plane
    const v = await run('Li10GeP2S12');
    assert.equal(v.D_dim, 3);
    assert.ok(v.logD_c - v.logD_a > 1, `LGPS c ${v.logD_c} vs a ${v.logD_a}`);
    assert.ok(Math.abs(v.logD_a - v.logD_b) < 1e-6);
  }
  // cubic: isotropic tensor
  for (const f of ['Li6PS5Cl', 'AgI_alpha', 'MgAl2O4']) {
    const v = await run(f);
    assert.equal(v.D_dim, 3);
    assert.equal(v.logD_aniso, 0, `${f} isotropic`);
    for (const k of ['logD_a', 'logD_b', 'logD_c']) assert.ok(Math.abs(v[k] - v.logD) < 1e-9, `${f} ${k}`);
  }
} finally {
  await server.close();
}
