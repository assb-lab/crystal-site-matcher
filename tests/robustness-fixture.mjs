// Checks of #36: trap depth, connected low-energy volume, bypass of the limiting window, site recovery,
// and how much the BVSE features move with the grid spacing.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const { blocksWithAtoms } = await server.ssrLoadModule('/src/lib/doc.ts');
  const { makeLattice } = await server.ssrLoadModule('/src/lib/structure.ts');
  const { hopBarrierFeatureValues } = await server.ssrLoadModule('/src/lib/hopBarriers.ts');
  const { computeGrid } = await server.ssrLoadModule('/src/lib/bvse.ts');
  const cr = {
    lattice: makeLattice(6, 8, 10, 90, 90, 90),
    sites: [{ element: 'Li' }, { element: 'Li' }],
    positions: [0, 1].map((index) => ({ index, frac: [0.3 * index, 0, 0], cart: [1.8 * index, 0, 0], group: `Li${index + 1}`, occupants: [{ site: index, occ: 1 }] })),
  };
  const hop = (t, d) => ({ a: 0, b: 0, t, d, rb: 0.5, mid: [0, 0, 0] });
  const bar = (Esad, saddle) => ({ Esad, Ea: 0, Eb: 0, fwd: Esad, rev: Esad, saddle });
  const hx = hop([1, 0, 0], 6), hy = hop([0, 1, 0], 8), hy2 = hop([0, 2, 0], 16);
  const bx = bar(0.2, [3, 0, 0]), by = bar(0.2, [0, 4, 0]), by2 = bar(0.3, [0, 2, 0]);
  // Every permutation of tied limiting groups gives the same conservative bypass result.
  const one = { ...cr, positions: cr.positions.slice(0, 1) };
  const expected = hopBarrierFeatureValues(one, [hx, hy, hy2], [bx, by, by2], 'Li');
  for (const order of [[0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]) {
    assert.deepEqual(hopBarrierFeatureValues(one, order.map((i) => [hx, hy, hy2][i]), order.map((i) => [bx, by, by2][i]), 'Li'), expected);
  }
  assert.equal(expected.hop_bypass_dim, 1);
  assert.equal(expected.E_hop_bypass, null);
  // A site without geometric hops and a failed edge are distinct missing-data conditions.
  const isolated = hopBarrierFeatureValues(cr, [hx], [bx], 'Li');
  assert.equal(isolated.trap_isolated, 1);
  assert.equal(isolated.trap_unresolved, 0);
  assert.equal(isolated.trap_max, null);
  assert.equal(isolated.trap_mean, null);
  const failed = hopBarrierFeatureValues(cr, [{ ...hx, b: 1 }], [null], 'Li');
  assert.equal(failed.trap_unresolved, 2);
  assert.equal(failed.trap_isolated, 0);
  assert.equal(failed.trap_max, null);
  assert.equal(hopBarrierFeatureValues(cr, [], [], 'Li').trap_isolated, 2);
  assert.equal(hopBarrierFeatureValues(cr, [], null, 'Li').trap_isolated, null);
  // E_1D=5.9 eV, with the rest of the connected region at 6.05 eV. Measure to 6.1, beyond the 6 eV cap.
  {
    const field = { setup: { hasEnergy: true }, eval: (x, y, z) => {
      let e = 6.05;
      if (Math.round(y) === 0 && Math.round(z) === 0) e = 5.9;
      if (Math.round(x) === 3 && Math.round(y) === 3 && Math.round(z) === 3) e = 0;
      return [e, 1];
    } };
    const grid = await computeGrid(field, { lattice: makeLattice(6, 6, 6, 90, 90, 90) }, { resolution: 1, maxPoints: 1000, eCap: 6 });
    assert.deepEqual(grid.conn, { low: 1, connected: 1 });
    assert.ok(Math.abs(grid.E[0] - 5.9) < 1e-6);
    assert.equal(grid.E[1], Infinity, 'threshold search itself remains capped');
    assert.equal(grid.E[2], Infinity);
  }
  const run = async (f, res = 0.2) => {
    const s = p.prepareStructure(blocksWithAtoms(await readFile(`src/samples/${f}.cif`, 'utf8'))[0]);
    const st = p.staticStage(s, p.DEFAULT_HOP_CUTOFF);
    const g = await p.gridStage(s, res, undefined, undefined, st.hops);
    const v = g.values;
    // dimension the barrier network reaches
    v.barrierDim = [v.E_hop_1D, v.E_hop_2D, v.E_hop_3D].filter((e) => e !== null).length;
    return { s, st, g, v };
  };

  for (const f of ['LiFePO4', 'Li10GeP2S12', 'Li6PS5Cl', 'Li3N', 'LiCoO2']) {
    const { st, g, v } = await run(f);
    // trap depth: for each position the lowest barrier out of it (forward from a, reverse from b)
    const esc = new Map();
    st.hops.forEach((h, i) => {
      const b = g.barriers[i];
      esc.set(h.a, Math.min(esc.get(h.a) ?? Infinity, b.fwd));
      esc.set(h.b, Math.min(esc.get(h.b) ?? Infinity, b.rev));
    });
    const traps = [...esc.values()];
    assert.ok(Math.abs(v.trap_max - Math.max(...traps)) < 1e-9, `${f} trap_max`);
    assert.ok(Math.abs(v.trap_mean - traps.reduce((a, b) => a + b, 0) / traps.length) < 1e-9, `${f} trap_mean`);
    assert.ok(v.trap_max >= v.trap_mean && v.trap_mean >= 0);
    // connected volume: part of the volume below E_1D + CONN_DE, measured in the same flood as E_1D
    assert.ok(v.vol_conn > 0 && v.vol_conn_ratio > 0 && v.vol_conn_ratio <= 1, `${f} vol_conn ${v.vol_conn} ${v.vol_conn_ratio}`);
    const below = g.grid.energy.filter((e) => e <= v.E_1D + 0.2).length / g.grid.energy.length;
    assert.ok(Math.abs(g.grid.conn.low - below) < 1e-9, `${f}: low-energy volume`);
    // the bypass never lowers the threshold and never raises the dimension
    assert.ok(v.hop_bypass_dim <= v.barrierDim, `${f} bypass dim`);
    if (v.dE_hop_bypass !== null) assert.ok(v.dE_hop_bypass >= 0);
    assert.ok(v.site_recovery >= 0 && v.site_recovery <= 1);
  }

  {
    const { v } = await run('Li10GeP2S12');
    // blocking the window that completes 3D leaves a costlier 3D route
    assert.equal(v.hop_bypass_dim, 3);
    assert.ok(v.dE_hop_bypass > 0.1, `LGPS dE_hop_bypass ${v.dE_hop_bypass}`);
    assert.ok(Math.abs(v.E_hop_bypass - v.E_hop_3D - v.dE_hop_bypass) < 1e-9);
    // about a tenth of the low-energy volume sits in pockets off the network
    assert.ok(v.vol_conn_ratio < 0.95, `LGPS vol_conn_ratio ${v.vol_conn_ratio}`);
  }
  {
    // argyrodite: every route out of the Li cages crosses the same kind of window; blocking it isolates the cages
    const { v } = await run('Li6PS5Cl');
    assert.equal(v.barrierDim, 3);
    assert.equal(v.hop_bypass_dim, 0);
    assert.equal(v.E_hop_bypass, null);
    assert.equal(v.dE_hop_bypass, null);
  }
  {
    // LiFePO4: one b-axis chain, nothing to bypass it
    const { v } = await run('LiFePO4');
    assert.equal(v.barrierDim, 1);
    assert.equal(v.hop_bypass_dim, 0);
    assert.ok(v.vol_conn_ratio > 0.95);
  }
  {
    // Li₃N: the BVSE minima are displaced from the CIF Li sites by more than 0.5 Å (Li2 split off the Li₂N layer)
    const { v } = await run('Li3N');
    assert.ok(v.site_recovery < 1, `Li3N site_recovery ${v.site_recovery}`);
  }

  // grid convergence: 0.15 / 0.20 / 0.25 Å (the 0.15 Å grid is coarsened to GRID_MAX_POINTS for the larger cells)
  for (const f of ['LiFePO4', 'Li10GeP2S12', 'Li6PS5Cl']) {
    const vs = [];
    for (const res of [0.15, 0.2, 0.25]) vs.push((await run(f, res)).v);
    const spread = (k) => Math.max(...vs.map((v) => v[k])) - Math.min(...vs.map((v) => v[k]));
    const same = (k) => assert.ok(vs.every((v) => (v[k] === null) === (vs[0][k] === null)), `${f} ${k}: defined at every spacing or none`);
    for (const k of ['E_1D', 'E_2D', 'E_3D', 'E_hop_1D', 'E_hop_2D', 'E_hop_3D', 'hop_bypass_dim', 'E_hop_bypass']) same(k);
    for (const k of ['E_1D', 'E_hop_1D', 'trap_max', 'hop_barrier_mean']) assert.ok(spread(k) < 0.06, `${f} ${k} spread ${spread(k)}`);
    for (const k of ['E_3D', 'E_hop_3D']) if (vs[0][k] !== null && vs[0][k] < 1) assert.ok(spread(k) < 0.06, `${f} ${k} spread ${spread(k)}`);
    assert.ok(spread('vol_conn_ratio') < 0.02, `${f} vol_conn_ratio spread ${spread('vol_conn_ratio')}`);
    assert.ok(spread('vol_conn') < 0.015, `${f} vol_conn spread ${spread('vol_conn')}`);
    assert.ok(vs.every((v) => v.barrierDim === vs[0].barrierDim));
    // site recovery: every Li site found in LiFePO4 and the argyrodite; at least 3 of the 4 LGPS sites
    assert.ok(vs.every((v) => v.site_recovery >= (f === 'Li10GeP2S12' ? 0.75 : 1)), `${f} site_recovery ${vs.map((v) => v.site_recovery)}`);
  }
} finally {
  await server.close();
}
