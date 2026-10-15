// Checks of crystal construction (src/lib/structure.ts): cell validation (#44), periodic distances (#43) and XRD (#42) in oblique cells.
import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const S = await server.ssrLoadModule('/src/lib/structure.ts');
  const { parseCif } = await server.ssrLoadModule('/src/lib/cif.ts');
  const { MsgError } = await server.ssrLoadModule('/src/lib/messages.ts');
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const cif = (a, b, c, al, be, ga) => `data_t
_cell_length_a ${a}
_cell_length_b ${b}
_cell_length_c ${c}
${al === undefined ? '' : `_cell_angle_alpha ${al}`}
${be === undefined ? '' : `_cell_angle_beta ${be}`}
${ga === undefined ? '' : `_cell_angle_gamma ${ga}`}
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Li1 Li+ 0 0 0
`;
  const build = (...p) => S.crystalFromCif(parseCif(cif(...p))[0]);
  const rejects = (key, ...p) =>
    assert.throws(() => build(...p), (e) => e instanceof MsgError && e.msg.key === key, `${key}: ${p.join(', ')}`);

  // cells that cannot exist: the angle triple of the issue, a flat cell (60/60/120 lies in a plane), angles at the bounds
  rejects('err.cell.volume', 3, 3, 3, 10, 10, 170);
  rejects('err.cell.volume', 3, 3, 3, 60, 60, 120);
  rejects('err.cell.volume', 3, 3, 3, 120, 120, 120);
  rejects('err.cell.angle', 3, 3, 3, 90, 90, 0);
  rejects('err.cell.angle', 3, 3, 3, 90, 180, 90);
  rejects('err.cell.angle', 3, 3, 3, -90, 90, 90);
  // non-finite and non-positive values
  rejects('err.cell.angle', 3, 3, 3, 90, '1e999', 90);
  rejects('err.cell.length', '1e999', 3, 3, 90, 90, 90);
  rejects('err.cell.length', 3, -3, 3, 90, 90, 90);
  rejects('err.cell.length', 3, 3, 0, 90, 90, 90);
  rejects('err.noCell', '?', 3, 3, 90, 90, 90);
  for (const token of ['bad', 'NaN', 'Infinity', '90degrees', '90(1)garbage']) rejects('err.cell.angle', 3, 3, 3, token, 90, 90);
  for (const size of ['1e200', '1e-200']) rejects('err.cell.numeric', size, size, size, 90, 90, 90);
  assert.equal(build(3, 3, 3, '9e1(2)', '90.0(1)', 90).lattice.volume, 27, 'valid uncertainty and exponent');
  assert.equal(S.cellProblem(3, 3, 3, 10, 10, 170), 'volume');
  assert.equal(S.cellProblem(3, 3, 3, 90, 90, 90), null);

  // valid cells load with the volume of the metric tensor; missing or unknown angles are 90°
  const vol = (a, b, c, al, be, ga) => {
    const [x, y, z] = [al, be, ga].map((t) => Math.cos((t * Math.PI) / 180));
    return a * b * c * Math.sqrt(1 - x * x - y * y - z * z + 2 * x * y * z);
  };
  for (const p of [[3, 4, 5, 90, 90, 90], [5, 6, 7, 90, 103.5, 90], [5, 6, 7, 71, 82, 95], [3, Math.hypot(15, 0.6), 3, 90, 90, (Math.atan2(0.6, 15) * 180) / Math.PI]]) {
    const cr = build(...p);
    assert.ok(Number.isFinite(cr.lattice.volume) && Math.abs(cr.lattice.volume - vol(...p)) < 1e-9 * vol(...p), `volume ${p}`);
    assert.ok(cr.lattice.inv.flat().every(Number.isFinite));
  }
  assert.equal(build(3, 4, 5).lattice.volume, 60);
  assert.equal(build(3, 4, 5, '?', '.', 90).lattice.gamma, 90);

  for (const params of [[3, 3, 3, 'bad', 90, 90], ['1e200', '1e200', '1e200', 90, 90, 90], ['1e-200', '1e-200', '1e-200', 90, 90, 90]]) {
    const result = await x.extractFromText(cif(...params), 'invalid.cif', { grid: null });
    assert.equal(result.records.length, 0);
    assert.equal(result.errors.length, 1);
    assert.doesNotMatch(result.errors[0].message, /[ぁ-んァ-ヶ一-龯]/);
  }
  // the CLI reports the error in English and produces no record (no NaN downstream)
  const r = await x.extractFromText(cif(3, 3, 3, 10, 10, 170), 'bad.cif', { grid: null });
  assert.equal(r.records.length, 0);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].message, /do not form a 3D cell/);

  // ---------------- periodic shortest distance (#43) ----------------
  {
    const { readFile } = await import('node:fs/promises');
    const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
    const { blocksWithAtoms } = await server.ssrLoadModule('/src/lib/doc.ts');
    const deg = (x) => (x * 180) / Math.PI;
    // the issue: A = (3,0,0), B = (15,0.6,0), C = (0,0,3); f2 − f1 = 0.4 B ≡ 0.4 B − 2A = (0, 0.24, 0)
    const L = S.makeLattice(3, Math.hypot(15, 0.6), 3, 90, 90, deg(Math.atan2(0.6, 15)));
    assert.ok(Math.abs(S.pbcDist(L, [0, 0, 0], [0, 0.4, 0]) - 0.24) < 1e-9, `0.24 Å: ${S.pbcDist(L, [0, 0, 0], [0, 0.4, 0])}`);

    // Former rectangular bounds contained ~59 billion candidates at m=500.
    for (const m of [20, 50, 100, 500]) {
      const skew = S.makeLattice(3, Math.hypot(3 * m, 3), 3, 90, 90, deg(Math.atan2(3, 3 * m)));
      const x = 0.49 * m;
      const expected = 3 * Math.hypot(x - Math.round(x), 0.49);
      for (let repeat = 0; repeat < 10; repeat++) assert.ok(Math.abs(S.pbcDist(skew, [0, 0, 0], [0, 0.49, 0]) - expected) < 1e-8);
    }
    // Very unequal orthogonal axes must not produce a large sphere scan either.
    const long = S.makeLattice(100000, 3, 3, 90, 90, 90);
    assert.ok(Math.abs(S.pbcDist(long, [0, 0, 0], [0.49, 0.49, 0.49]) - Math.hypot(49000, 1.47, 1.47)) < 1e-7);
    const huge = S.makeLattice(1e200, 3, 3, 90, 90, 90);
    assert.ok(Math.abs(S.pbcDist(huge, [0, 0, 0], [0.49, 0, 0]) / 4.9e199 - 1) < 1e-12);
    // Independent exhaustive reference on skewed 3D metrics (deterministic point pairs).
    for (const params of [[3, 4, 5, 71, 82, 95], [3, 4, 5, 90, 90, 12], [5, 4, 3, 32, 48, 28]]) {
      const lattice = S.makeLattice(...params);
      for (let point = 0; point < 25; point++) {
        const f = [(point * 0.137) % 1, (point * 0.317) % 1, (point * 0.571) % 1];
        let reference = Infinity;
        for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) for (let k = -10; k <= 10; k++) reference = Math.min(reference, S.norm(S.toCart(lattice, [f[0] + i, f[1] + j, f[2] + k])));
        assert.ok(Math.abs(S.pbcDist(lattice, [0, 0, 0], f) - reference) < 1e-9, `sphere versus reference: ${params}, ${f}`);
      }
    }
    // the same crystal written in a skewed basis A' = A, B' = B + m A, C' = C (P1, every position listed)
    const skewed = (cr, ox, m) => {
      const { A, B, C } = cr.lattice;
      const B2 = [B[0] + m * A[0], B[1] + m * A[1], B[2] + m * A[2]];
      const len = (v) => Math.hypot(...v);
      const ang = (u, v) => deg(Math.acos((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (len(u) * len(v))));
      const rows = cr.positions.flatMap((q) =>
        q.occupants.map((o) => {
          const f = [q.frac[0] - m * q.frac[1], q.frac[1], q.frac[2]]; // r = f0 A + f1 B + f2 C = (f0 − m f1) A + f1 B' + f2 C
          return `${cr.sites[o.site].label} ${cr.sites[o.site].element} ${f.join(' ')} ${o.occ}`;
        }),
      );
      const text = `data_skew
_cell_length_a ${len(A)}
_cell_length_b ${len(B2)}
_cell_length_c ${len(C)}
_cell_angle_alpha ${ang(B2, C)}
_cell_angle_beta ${ang(A, C)}
_cell_angle_gamma ${ang(A, B2)}
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
_atom_site_occupancy
${rows.join('\n')}
`;
      return p.prepareStructure(blocksWithAtoms(text)[0], { oxOverride: ox });
    };
    // XRD (#42): the same peaks (positions, intensities, multiplicities) in any basis; the hkl labels may differ
    const { simulateXrd } = await server.ssrLoadModule('/src/lib/xrd.ts');
    const samePattern = (x0, x1, msg) => {
      assert.deepEqual(x1.peaks.map((q) => q.twoTheta.toFixed(4)), x0.peaks.map((q) => q.twoTheta.toFixed(4)), `${msg}: peak positions`);
      x0.peaks.forEach((q, i) => {
        assert.ok(Math.abs(x1.peaks[i].intensity - q.intensity) < 1e-6 * Math.max(1, q.intensity), `${msg}: intensity at ${q.twoTheta}`);
        assert.equal(x1.peaks[i].mult, q.mult, `${msg}: multiplicity at ${q.twoTheta}`);
      });
    };
    {
      // the issue: Li at the origin of A = (3,0,0), B = (0,0.6,0), C = (0,0,3) and of A, B + 3A, C
      const li = (a, b, c, ga) => S.crystalFromCif(parseCif(cif(a, b, c, 90, 90, ga))[0]);
      const ortho = simulateXrd(li(3, 0.6, 3, 90));
      const skew = simulateXrd(li(3, Math.hypot(9, 0.6), 3, deg(Math.atan2(0.6, 9))));
      for (const t of [29.7566, 42.5842, 61.7989, 70.0799]) assert.ok(ortho.peaks.some((q) => Math.abs(q.twoTheta - t) < 1e-3), `orthogonal cell: ${t}°`);
      samePattern(ortho, skew, 'Li, B + 3A');
    }
    for (const [f, m] of [['LiCoO2', 4], ['Li3N', 5], ['LiFePO4', 3]]) {
      const s0 = p.prepareStructure(blocksWithAtoms(await readFile(`src/samples/${f}.cif`, 'utf8'))[0]);
      const s1 = skewed(s0.crystal, s0.ox, m);
      assert.equal(s1.crystal.positions.length, s0.crystal.positions.length, `${f}: no positions merged or lost`);
      assert.ok(s1.crystal.lattice.gamma < 20, `${f}: strongly oblique (γ ${s1.crystal.lattice.gamma})`);
      // distances between every pair of positions agree in both bases (positions keep their order)
      const P0 = s0.crystal.positions,
        P1 = s1.crystal.positions;
      for (let i = 0; i < P0.length; i++)
        for (let j = i; j < P0.length; j++) {
          const d0 = S.pbcDist(s0.crystal.lattice, P0[i].frac, P0[j].frac);
          const d1 = S.pbcDist(s1.crystal.lattice, P1[i].frac, P1[j].frac);
          assert.ok(Math.abs(d0 - d1) < 1e-6, `${f} positions ${i}-${j}: ${d0} vs ${d1}`);
        }
      // stable-site classification and spacing do not depend on the basis
      const st0 = p.staticStage(s0, p.DEFAULT_HOP_CUTOFF),
        st1 = p.staticStage(s1, p.DEFAULT_HOP_CUTOFF);
      assert.equal(st1.hops.length, st0.hops.length, `${f}: hops`);
      const g0 = await p.gridStage(s0, 0.2, undefined, undefined, st0.hops),
        g1 = await p.gridStage(s1, 0.2, undefined, undefined, st1.hops);
      const kinds = (g) => [g.minima.filter((x) => x.occupied).length, g.minima.filter((x) => !x.occupied).length];
      assert.deepEqual(kinds(g1), kinds(g0), `${f}: site / interstitial minima`);
      assert.equal(g1.values.site_recovery, g0.values.site_recovery, `${f}: site_recovery`);
      assert.ok(Math.abs(g1.values.site_spacing - g0.values.site_spacing) < 0.05, `${f}: site_spacing ${g1.values.site_spacing} vs ${g0.values.site_spacing}`);
      assert.ok(Math.abs(g1.values.E_1D - g0.values.E_1D) < 0.05, `${f}: E_1D ${g1.values.E_1D} vs ${g0.values.E_1D}`);
      samePattern(simulateXrd(s0.crystal), simulateXrd(s1.crystal), f);
    }
  }
} finally {
  await server.close();
}
