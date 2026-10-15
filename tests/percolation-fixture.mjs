// Checks of percolation along a / b / c (#35): the periodic union-find and the axis features of the samples.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const { PeriodicUnionFind } = await server.ssrLoadModule('/src/lib/percolation.ts');
  const x = await server.ssrLoadModule('/src/cli/extract.ts');

  // union-find: a chain along [110] is 1D but opens no axis; adding a 2D layer opens a and b; 3D opens all
  {
    const uf = new PeriodicUnionFind(1);
    uf.make(0);
    uf.union(0, 0, [1, 1, 0]);
    assert.equal(uf.maxRank, 1);
    assert.deepEqual(uf.axes, [false, false, false]);
    uf.union(0, 0, [1, -1, 0]); // span of [110] and [1-10] contains a = ([110] + [1-10]) / 2
    assert.equal(uf.maxRank, 2);
    assert.deepEqual(uf.axes, [true, true, false]);
    uf.union(0, 0, [0, 1, 1]);
    assert.deepEqual(uf.axes, [true, true, true]);
  }
  // merging two clusters carries their winding vectors: the c axis opens through the merged basis
  {
    const uf = new PeriodicUnionFind(2);
    uf.make(0);
    uf.make(1);
    uf.union(0, 0, [0, 0, 2]);
    assert.deepEqual(uf.axes, [false, false, true], 'a multiple of c is enough');
    uf.union(1, 1, [3, 0, 0]);
    assert.deepEqual(uf.axes, [true, false, true]);
    uf.union(0, 1, [0, 0, 0]);
    assert.equal(uf.maxRank, 2);
    assert.deepEqual(uf.axes, [true, false, true]);
  }

  const values = async (f) => {
    const r = await x.extractFromText(await readFile(`src/samples/${f}.cif`, 'utf8'), f, { grid: 0.25 });
    assert.deepEqual(r.errors, []);
    return r.records[0].values;
  };
  const eq = (a, b, msg) => assert.ok(a !== null && b !== null && Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);
  const axisChecks = (v, f) => {
    // each axis opens no earlier than 1D and no later than 3D
    for (const [ax, d1, d3, lower] of [['E', 'E_1D', 'E_3D', true], ['R', 'R_1D', 'R_3D', false], ['rb', 'rb_1D', 'rb_3D', false], ['E_hop', 'E_hop_1D', 'E_hop_3D', true]])
      for (const k of 'abc') {
        const a = v[`${ax}_${k}`];
        if (a === null) continue;
        assert.ok(lower ? a >= v[d1] - 1e-12 : a <= v[d1] + 1e-12, `${f} ${ax}_${k} vs ${d1}`);
        if (v[d3] !== null) assert.ok(lower ? a <= v[d3] + 1e-12 : a >= v[d3] - 1e-12, `${f} ${ax}_${k} vs ${d3}`);
      }
  };

  // LGPS: the 1D channel runs along c; a and b open with 3D
  {
    const v = await values('Li10GeP2S12');
    axisChecks(v, 'LGPS');
    eq(v.E_c, v.E_1D, 'LGPS E_c');
    eq(v.E_a, v.E_3D, 'LGPS E_a');
    eq(v.E_b, v.E_a, 'LGPS E_b');
    assert.ok(v.E_a - v.E_c > 0.05, `LGPS: c channel opens first (${v.E_c} < ${v.E_a})`);
    eq(v.E_axis_range, v.E_a - v.E_c, 'LGPS E_axis_range');
    eq(v.E_hop_c, v.E_hop_1D, 'LGPS E_hop_c');
    assert.ok(v.E_hop_a > v.E_hop_c);
    eq(v.rb_c, v.rb_1D, 'LGPS rb_c');
  }
  // LiFePO4: the b channel
  {
    const v = await values('LiFePO4');
    axisChecks(v, 'LiFePO4');
    eq(v.E_b, v.E_1D, 'LiFePO4 E_b');
    assert.ok(v.E_a > 2 && v.E_c > 2, `LiFePO4 a/c ${v.E_a} ${v.E_c}`);
    eq(v.E_hop_b, v.E_hop_1D, 'LiFePO4 E_hop_b');
    assert.equal(v.E_hop_a, null);
    assert.equal(v.E_hop_c, null);
    eq(v.R_b, v.R_1D, 'LiFePO4 R_b');
  }
  // LiCoO2: Li layers in ab, nothing along c
  {
    const v = await values('LiCoO2');
    axisChecks(v, 'LiCoO2');
    eq(v.E_a, v.E_1D, 'LiCoO2 E_a');
    eq(v.E_b, v.E_1D, 'LiCoO2 E_b');
    assert.equal(v.E_c, null);
    assert.equal(v.E_axis_range, null, 'an axis that never opens leaves the range empty');
    assert.equal(v.E_hop_c, null);
    assert.equal(v.rb_c, null);
  }
  // Li3N: wider voids within the Li2N layer (a, b) than along c, as in CAVD (R_Ta = R_Tb > R_Tc)
  {
    const v = await values('Li3N');
    axisChecks(v, 'Li3N');
    eq(v.R_a, v.R_b, 'Li3N R_a = R_b');
    assert.ok(v.R_a > v.R_c + 0.2, `Li3N R_a ${v.R_a} > R_c ${v.R_c}`);
  }
  // cubic: the three axes are equal and open with 3D
  for (const f of ['Li6PS5Cl', 'AgI_alpha', 'MgAl2O4']) {
    const v = await values(f);
    axisChecks(v, f);
    for (const k of ['E', 'R', 'rb', 'E_hop']) {
      eq(v[`${k}_a`], v[`${k}_b`], `${f} ${k}_a = ${k}_b`);
      eq(v[`${k}_a`], v[`${k}_c`], `${f} ${k}_a = ${k}_c`);
    }
    assert.equal(v.E_axis_range, 0);
  }
} finally {
  await server.close();
}
