// Checks of the hop bottleneck radius (#62): the widest path with one bend, its symmetry mapping and the samples.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const { blocksWithAtoms, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
  const { ionicRadiusFn } = await server.ssrLoadModule('/src/lib/features.ts');
  const { FrameworkField } = await server.ssrLoadModule('/src/lib/bvse.ts');
  const { toCart } = await server.ssrLoadModule('/src/lib/structure.ts');
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
  const sub = (a, b) => [0, 1, 2].map((k) => a[k] - b[k]);
  const len = (v) => Math.hypot(v[0], v[1], v[2]);
  const segDist = (q, a, b) => {
    const ab = sub(b, a),
      aq = sub(q, a);
    const t = Math.max(0, Math.min(1, (aq[0] * ab[0] + aq[1] * ab[1] + aq[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
    return len([0, 1, 2].map((k) => aq[k] - t * ab[k]));
  };
  const prepare = (text) => p.prepareStructure(blocksWithAtoms(text)[0]);
  const fieldOf = (s) => {
    const { bonds } = deriveBonds(s.crystal, s.ox, s.bondSettings);
    return new FrameworkField(s.crystal, s.ox, s.mobile, ionicRadiusFn(s.crystal, s.ox, bonds), 6);
  };
  const ends = (cr, h) => [cr.positions[h.a].cart, toCart(cr.lattice, cr.positions[h.b].frac.map((v, k) => v + h.t[k]))];

  // A Cl⁻ 1.4 Å off the middle of a 3.8 Å Li–Li line: the straight line enters its sphere (old rb = 0); the
  // widest path bends to the far side of the sphere with diameter AB, P = M − 1.9 ŷ, where each leg passes
  // the Cl centre at 3.3/√2 Å (A = (−1.9, 0), C = (0, 1.4), leg direction (1, −1)/√2).
  {
    const a = 12;
    const cif = `data_t\n_cell_length_a ${a}\n_cell_length_b ${a}\n_cell_length_c ${a}\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_symmetry_space_group_name_H-M 'P 1'\nloop_\n_symmetry_equiv_pos_as_xyz\n'x,y,z'\nloop_\n_atom_type_symbol\n_atom_type_oxidation_number\nLi+ 1\nCl- -1\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nLi1 Li+ ${0.5 - 1.9 / a} 0.5 0.5 1\nLi2 Li+ ${0.5 + 1.9 / a} 0.5 0.5 1\nCl1 Cl- 0.5 ${0.5 + 1.4 / a} 0.5 1\n`;
    const s = prepare(cif);
    const st = p.staticStage(s, p.DEFAULT_HOP_CUTOFF);
    const r = fieldOf(s).ions.find((ion) => ion.r > 0).r;
    assert.equal(st.hops.length, 1);
    const [h] = st.hops;
    const [A, B] = ends(s.crystal, h);
    const M = [0, 1, 2].map((k) => (A[k] + B[k]) / 2);
    assert.ok(1.4 - r < 0, 'the straight line enters the Cl sphere');
    near(h.rb, 3.3 / Math.SQRT2 - r, 1e-6, 'rb of the bent path');
    near(len(sub(h.via, [M[0], M[1] - 1.9, M[2]])), 0, 1e-4, 'bend point on the far side of the sphere');
    assert.ok(Math.min(segDist(h.mid, A, h.via), segDist(h.mid, h.via, B)) < 1e-9, 'bottleneck on the path');
  }

  // bundled samples: never narrower than the straight line, no 0 Å hop, bend inside the sphere with diameter AB,
  // the same value for hops of one site pair and distance, with or without the symmetry operations
  const files = (await readdir('src/samples')).filter((f) => f.endsWith('.cif'));
  for (const f of files) {
    const text = await readFile(`src/samples/${f}`, 'utf8');
    const s = prepare(text);
    const cr = s.crystal;
    const st = p.staticStage(s, p.DEFAULT_HOP_CUTOFF);
    const field = fieldOf(s);
    assert.ok(st.hops.length > 0, f);
    const pairs = new Map();
    for (const h of st.hops) {
      const [A, B] = ends(cr, h);
      const M = [0, 1, 2].map((k) => (A[k] + B[k]) / 2);
      assert.ok(h.rb > 0, `${f}: rb = 0`);
      assert.ok(h.rb >= Math.max(0, field.segment(A, B).clearance) - 1e-12, `${f}: narrower than the straight line`);
      assert.ok(len(sub(h.via, M)) <= h.d / 2 + 1e-9, `${f}: bend outside the sphere`);
      near(Math.min(field.segment(A, h.via).clearance, field.segment(h.via, B).clearance), h.rb, 1e-6, `${f}: rb is the clearance of A→via→B`);
      assert.ok(Math.min(segDist(h.mid, A, h.via), segDist(h.mid, h.via, B)) < 1e-6, `${f}: bottleneck on the path`);
      const key = `${[cr.positions[h.a].group, cr.positions[h.b].group].sort()}|${h.d.toFixed(4)}`;
      pairs.set(key, [...(pairs.get(key) ?? []), h.rb]);
    }
    for (const [k, v] of pairs) near(Math.max(...v), Math.min(...v), 1e-6, `${f} ${k}: spread`);
    // without symmetry operations every hop is searched on its own and must land on the same values
    const s1 = prepare(text);
    s1.crystal.ops = undefined;
    const st1 = p.staticStage(s1, p.DEFAULT_HOP_CUTOFF);
    st1.hops.forEach((h, i) => near(h.rb, st.hops[i].rb, 1e-6, `${f}: with and without symmetry`));
  }

  // regression: the 0 Å hops of #62 (straight line: rb_min 0, rb_3D 0.187 / 0.207 / 0.364 / 0.489) and the
  // paths that bend around the straight-line window (LiCoO₂ via the tetrahedral site: 0.148; LiFePO₄: 0.069)
  const values = async (f) => (await x.extractFromText(await readFile(`src/samples/${f}.cif`, 'utf8'), f, { grid: null })).records[0];
  for (const [f, rbMin, rb3D] of [
    ['Li10GeP2S12', 0.368, 0.419],
    ['Li6PS5Cl', 0.321, 0.433],
    ['Li3N', 0.463, 0.51],
    ['AgI_alpha', 0.323, 0.489],
    ['LiCoO2', 0.338, null],
    ['LiFePO4', 0.496, null],
  ]) {
    const rec = await values(f);
    near(rec.values.rb_min, rbMin, 1e-3, `${f} rb_min`);
    if (rb3D === null) assert.equal(rec.values.rb_3D, null, `${f} rb_3D`);
    else near(rec.values.rb_3D, rb3D, 1e-3, `${f} rb_3D`);
    // the CLI reports the bend point
    for (const h of rec.hops) assert.equal(h.viaFrac.length, 3);
  }
  assert.ok(x.HOP_COLUMNS.includes('via_x'));

  // a sparse framework: no anion within reach of the Li–Li hop, so the end clearance is infinite; the search
  // must still end (it looped over an unbounded bin range) and give a finite radius set by the far anion
  {
    const a = 20;
    const cif = `data_t\n_cell_length_a ${a}\n_cell_length_b ${a}\n_cell_length_c ${a}\n_cell_angle_alpha 90\n_cell_angle_beta 90\n_cell_angle_gamma 90\n_symmetry_space_group_name_H-M 'P 1'\nloop_\n_symmetry_equiv_pos_as_xyz\n'x,y,z'\nloop_\n_atom_type_symbol\n_atom_type_oxidation_number\nLi+ 1\nCl- -1\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\n_atom_site_occupancy\nLi1 Li+ 0.4 0.5 0.5 1\nLi2 Li+ 0.55 0.5 0.5 1\nCl1 Cl- 0.0 0.0 0.0 1\n`;
    const s = prepare(cif);
    const field = fieldOf(s);
    const [A, B] = [s.crystal.positions[0].cart, s.crystal.positions[1].cart];
    assert.equal(field.segment(A, A).clearance, Infinity);
    const res = field.bentPath(A, B);
    assert.ok(Number.isFinite(res.clearance) && res.clearance > 5, `sparse framework clearance: ${res.clearance}`);

    // The all-ion fallback must not pass the array as function arguments: periodic images / large
    // frameworks can exceed the engine's argument limit. Repeating the same distant ion leaves the
    // analytic endpoint bound unchanged. A short hop keeps the regression inexpensive.
    const ion = field.ions[0];
    field.ions = Array(150000).fill(ion);
    const C = A.map((v, k) => v + (k === 0 ? 0.01 : 0));
    const expected = Math.min(...[A, C].map((P) => Math.hypot(ion.x - P[0], ion.y - P[1], ion.z - P[2]) - ion.r));
    const large = field.bentPath(A, C);
    near(large.clearance, expected, 1e-9, 'large sparse framework endpoint bound');
  }
} finally {
  await server.close();
}
