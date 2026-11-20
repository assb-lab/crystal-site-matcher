// Regression checks for #80: partial occupancy, mixed valence, duplicate labels, symmetry lookup, CIF tokens and the BVSE grid.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const S = await server.ssrLoadModule('/src/lib/structure.ts');
  const { parseCif } = await server.ssrLoadModule('/src/lib/cif.ts');
  const { lookupSpaceGroup, parseSymOp } = await server.ssrLoadModule('/src/lib/spacegroup.ts');
  const A = await server.ssrLoadModule('/src/lib/analysis.ts');
  const B = await server.ssrLoadModule('/src/lib/bonding.ts');
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const { gridSteps } = await server.ssrLoadModule('/src/lib/bvse.ts');
  const sample = (f) => readFile(`src/samples/${f}.cif`, 'utf8');
  const prep = (text, opts) => p.prepareStructure(parseCif(text)[0], opts);
  const near = (x, y, tol, msg) => assert.ok(Math.abs(x - y) < tol, `${msg}: ${x} vs ${y}`);
  const cell = (a, b, c, al, be, ga, sg, atoms, extra = '') => `data_t
_cell_length_a ${a}
_cell_length_b ${b}
_cell_length_c ${c}
_cell_angle_alpha ${al}
_cell_angle_beta ${be}
_cell_angle_gamma ${ga}
${sg}
${extra}
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
${atoms}
`;

  // formula and Z with occupancies written to 4 decimals (α-AgI: 0.1667 × 12 = 2.0004 Ag)
  {
    const cr = prep(await sample('AgI_alpha')).crystal;
    assert.deepEqual(S.formulaString(cr), { formula: 'AgI', Z: 2 });
    // a count just off an integer must not print as "Li1."
    const f = S.formulaString(prep(cell(4, 4, 4, 90, 90, 90, "_symmetry_space_group_name_H-M 'P 1'", 'Li1 Li+ 0 0 0 0.998\nCl1 Cl- 0.5 0.5 0.5 1')).crystal).formula;
    assert.equal(f, 'LiCl');
  }

  // duplicate labels on a mixed site: each species keeps its own oxidation state
  {
    const cr = S.crystalFromCif(parseCif(cell(4, 4, 4, 90, 90, 90, "_symmetry_space_group_name_H-M 'P m -3 m'", 'M1 Li+ 0 0 0 0.5\nM1 Fe3+ 0 0 0 0.5\nO1 O2- 0.5 0 0 1'))[0]);
    assert.deepEqual(cr.sites.map((s) => s.label), ['M1', 'M1_2', 'O1']);
    assert.ok(cr.warnings.some((w) => w.key === 'warn.dupLabel'), 'duplicate-label warning');
    const s = prep(cell(4, 4, 4, 90, 90, 90, "_symmetry_space_group_name_H-M 'P m -3 m'", 'M1 Li+ 0 0 0 0.5\nM1 Fe3+ 0 0 0 0.5\nO1 O2- 0.5 0 0 1'));
    assert.equal(s.ox.M1, 1);
    assert.equal(s.ox.M1_2, 3);
  }

  // CIF tokens: values after a closing ";" on the same line; a tag without a value right before loop_
  {
    const [b] = parseCif('data_x\n_t\nloop_\n_a\n_b\n;foo\n; 2\n3 4\n');
    assert.equal(b.items.get('_t'), '?');
    assert.deepEqual(b.loops[0].rows, [['foo', '2'], ['3', '4']]);
    assert.throws(() => parseSymOp('x,y,1/2+a'));
  }

  // symmetry lookup: rhombohedral axes, origin choice in parentheses, pre-2016 symbols
  {
    const rh = cell(5, 5, 5, 55, 55, 55, "_symmetry_space_group_name_H-M 'R -3 m'", 'Li1 Li+ 0 0 0 1\nCo1 Co3+ 0.5 0.5 0.5 1\nO1 O2- 0.26 0.26 0.26 1');
    const cr = S.crystalFromCif(parseCif(rh)[0]);
    assert.equal(cr.positions.length, 4, 'rhombohedral cell: Li + Co + 2 O');
    assert.equal(lookupSpaceGroup({ hm: 'R -3 m', axes: 'H' }).setting, 'R -3 m :H');
    assert.equal(lookupSpaceGroup({ hm: 'F d -3 m (origin choice 1)' }).setting, 'F d -3 m :1');
    assert.equal(lookupSpaceGroup({ hm: 'F d -3 m' }).setting, 'F d -3 m :2');
    assert.equal(lookupSpaceGroup({ hm: 'C m c a' }).number, 64);
    assert.equal(lookupSpaceGroup({ hm: 'A b a 2' }).number, 41);
  }

  // site-specific cutoffs: both ends of a bond see the same cutoff
  {
    const s = prep(await sample('LiCoO2'));
    const bs = { ...s.bondSettings, siteOverride: { Li1: 2.5, O1: 1.0 } };
    const { bonds } = B.deriveBonds(s.crystal, s.ox, bs);
    const li = s.crystal.positions.findIndex((x) => x.group === 'Li1');
    for (const n of bonds.bonded[li]) assert.ok(bonds.bonded[n.j].some((m) => m.j === li), 'bond seen from both ends');
    assert.equal(bonds.bonded[li].length, 6);
  }

  // Shannon radius and charge penalty for mixed valence
  {
    const r3 = A.shannonRadius('Mn', 3, 6, { kind: 'ionic' }).r,
      r4 = A.shannonRadius('Mn', 4, 6, { kind: 'ionic' }).r;
    near(A.shannonRadius('Mn', 3.5, 6, { kind: 'ionic' }).r, (r3 + r4) / 2, 1e-12, 'Mn3.5+');
    assert.equal(A.chargePenalty(0), 1);
    assert.equal(A.chargePenalty(1), 0.75);
    assert.equal(A.chargePenalty(-2), 0.5);
    assert.equal(A.chargePenalty(3), 0.3);
    near(A.chargePenalty(0.5), 0.875, 1e-12, 'Δq 0.5');
    near(A.chargePenalty(2.5), 0.4, 1e-12, 'Δq 2.5');
  }

  // anion site: the Pauling ratio is r(cation) / r(anion); no usable size reference leaves the size term out
  {
    const s = prep(await sample('SrTiO3'));
    const { bonds } = B.deriveBonds(s.crystal, s.ox, s.bondSettings);
    const pos = s.crystal.positions.findIndex((x) => x.group === 'O1');
    const site = A.analyzeSite(s.crystal, s.ox, bonds, pos, { kind: 'ionic' });
    const opts = { sizeTol: 0.15, useBVS: true, useCharge: true };
    const o = A.evaluateCandidate(site, { el: 'O', ox: -2, spin: '' }, opts);
    near(o.rho, site.rLigandMean / o.radius.r, 1e-12, 'O²⁻ on O1');
    assert.ok(o.rho < 1);
    const bad = A.evaluateCandidate({ ...site, rSite: -0.3, rHost: { ...site.rHost, r: -0.08 } }, { el: 'F', ox: -1, spin: '' }, opts);
    assert.equal(bad.dSite, null);
    assert.equal(bad.dHost, null);
    assert.equal(bad.sSize, null);
    assert.ok(Number.isFinite(bad.score));
  }

  // a framework ion sharing the mobile ion's site (2 % Co on the Li site of LiCoO2) does not block the hops
  {
    const text = (await sample('LiCoO2')).replace('Li1 Li+ 0 0 0 1', 'Li1 Li+ 0 0 0 0.98\nCo2 Co3+ 0 0 0 0.02');
    const s0 = prep(await sample('LiCoO2')),
      s1 = prep(text);
    const st0 = p.staticStage(s0, p.DEFAULT_HOP_CUTOFF),
      st1 = p.staticStage(s1, p.DEFAULT_HOP_CUTOFF);
    assert.equal(st1.hops.length, st0.hops.length);
    assert.equal(st1.values.hopDim, st0.values.hopDim);
    const g1 = await p.gridStage(s1, 0.3, undefined, undefined, st1.hops);
    for (const e of g1.siteE) assert.ok(Math.abs(e.E) < 1, `site energy ${e.E}`);
    assert.ok(g1.values.E_1D > 0.8 && g1.values.E_1D < 2, `E_1D ${g1.values.E_1D}`);
  }

  // hops longer than the neighbour table (≥ 6 Å) are found
  {
    const s = prep(await sample('LiCoO2'));
    const st = p.staticStage(s, 9);
    assert.ok(Math.max(...st.hops.map((h) => h.d)) > 6, 'hop beyond 6 Å');
  }

  // no charged framework ion in reach: finite void curve, no Infinity in the features
  {
    const s = prep(await sample('LiCoO2'), { oxOverride: { Li: 0 } });
    const st = p.staticStage(s, p.DEFAULT_HOP_CUTOFF);
    const g = await p.gridStage(s, 0.3, undefined, undefined, st.hops);
    assert.ok(g.grid.voidCurve.every((q) => Number.isFinite(q.x) && Number.isFinite(q.y)), 'void curve');
    for (const [k, v] of Object.entries({ ...st.values, ...g.values })) assert.ok(typeof v !== 'number' || Number.isFinite(v), `${k} = ${v}`);
    const pure = prep(cell(3.51, 3.51, 3.51, 90, 90, 90, "_symmetry_space_group_name_H-M 'I m -3 m'", 'Li1 Li 0 0 0 1'), { oxOverride: { Li: 1 }, mobile: 'Li' });
    const sp = p.staticStage(pure, p.DEFAULT_HOP_CUTOFF);
    const gp = await p.gridStage(pure, 0.3, undefined, undefined, sp.hops);
    assert.ok(gp.grid.voidCurve.every((q) => Number.isFinite(q.x)), 'void curve without framework');
    for (const [k, v] of Object.entries({ ...sp.values, ...gp.values })) assert.ok(typeof v !== 'number' || Number.isFinite(v), `${k} = ${v}`);
  }

  // grid steps: six face steps in an orthogonal cell, plus the short diagonals at γ = 120°
  {
    const ortho = prep(await sample('LiFePO4')).crystal.lattice;
    assert.equal(gridSteps(ortho, [52, 30, 23]).length, 6);
    const hex = prep(await sample('LiCoO2')).crystal.lattice;
    const st = gridSteps(hex, [14, 14, 70]).map((s) => s.join(','));
    assert.equal(st.length, 8);
    assert.ok(st.includes('1,1,0') && st.includes('-1,-1,0'));
  }
} finally {
  await server.close();
}
