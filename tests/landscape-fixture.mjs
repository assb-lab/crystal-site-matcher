// Checks of the BVSE stable-site search (src/lib/landscape.ts) through the shared pipeline, loaded with vite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const L = await server.ssrLoadModule('/src/lib/landscape.ts');
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const { blocksWithAtoms } = await server.ssrLoadModule('/src/lib/doc.ts');
  const near = (a, b, tol, msg) => assert.ok(a !== null && Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
  const run = async (f, res = 0.25) => {
    const s = p.prepareStructure(blocksWithAtoms(await readFile(`src/samples/${f}.cif`, 'utf8'))[0]);
    const g = await p.gridStage(s, res);
    return { ...g, minima: g.minima, v: g.values };
  };

  // eigenvalues of a symmetric 3×3 matrix
  const ev = L.symEig3([[2, 1, 0], [1, 2, 0], [0, 0, 5]]);
  [1, 3, 5].forEach((x, i) => near(ev[i], x, 1e-9, 'symEig3'));

  for (const f of ['LiFePO4', 'LiCoO2', 'MgAl2O4', 'Li3N', 'AgI_alpha']) {
    const { minima } = await run(f);
    for (const m of minima) {
      assert.ok(m.curvature[0] > 0, `${f}: every reported minimum is a true minimum`);
      assert.ok(m.occupied ? m.nearest.d <= L.SITE_MATCH : m.nearest.d > L.SITE_MATCH && m.E <= L.INTERSTITIAL_E_MAX, `${f}: classification`);
      assert.ok(m.frac.every((x) => x >= 0 && x < 1));
    }
  }

  // LiFePO₄: the four Li1 sites, plus four minima halfway along the curved b-channel path (≈0.34 eV, 1.8 Å from Li)
  {
    const { minima, v } = await run('LiFePO4');
    const occ = minima.filter((m) => m.occupied);
    assert.equal(occ.length, 4);
    for (const m of occ) {
      assert.equal(m.nearest.group, 'Li1');
      assert.ok(m.nearest.d < 0.05 && Math.abs(m.E) < 0.05);
    }
    assert.equal(v.n_interstitial, 4);
    near(v.E_interstitial_min, 0.34, 0.05, 'LiFePO4 interstitial energy');
    for (const m of minima.filter((m) => !m.occupied)) near(m.nearest.d, 1.8, 0.1, 'LiFePO4 interstitial distance');
  }
  // LiCoO₂: only the three Li sites, uniaxial (two equal in-plane curvatures)
  {
    const { minima, v } = await run('LiCoO2');
    assert.equal(minima.length, 3);
    assert.equal(v.n_interstitial, 0);
    assert.equal(v.E_interstitial_min, null);
    near(minima[0].curvature[0], minima[0].curvature[1], 1e-2, 'LiCoO2 in-plane curvatures');
    near(v.site_energy_spread, 0, 1e-6, 'equivalent sites');
  }
  // MgAl₂O₄: Mg on the tetrahedral 8a site (isotropic curvature) and the empty octahedral 16c sites
  {
    const { minima, v } = await run('MgAl2O4');
    assert.equal(minima.filter((m) => m.occupied).length, 8);
    near(v.curv_aniso, 1, 1e-2, 'Td site: isotropic');
    const empty = minima.filter((m) => !m.occupied);
    assert.equal(empty.length, 16);
    for (const m of empty) assert.ok(m.frac.every((x) => Math.abs(4 * x - Math.round(4 * x)) < 4e-3), `16c on special positions (multiples of ¼): ${m.frac}`);
  }
  // Li₃N: the Li2 minima sit 0.8 Å out of the Li₂N layer and still count as the Li2 site
  {
    const { minima, v } = await run('Li3N');
    assert.ok(minima.some((m) => m.occupied && m.nearest.group === 'Li2' && Math.abs(m.nearest.d - 0.81) < 0.1));
    assert.equal(v.n_interstitial, 0);
  }

  // Spacing includes nonzero periodic images of the same site and is invariant to supercell choice.
  {
    const cell = (a, b, c, gamma = 90) => p.prepareStructure(blocksWithAtoms(`data_cell
_cell_length_a ${a}
_cell_length_b ${b}
_cell_length_c ${c}
_cell_angle_alpha 90
_cell_angle_beta 90
_cell_angle_gamma ${gamma}
_symmetry_space_group_name_H-M 'P 1'
loop_
_atom_site_label
_atom_site_type_symbol
_atom_site_fract_x
_atom_site_fract_y
_atom_site_fract_z
Li1 Li+ 0 0 0
`)[0]).crystal;
    const site = (frac) => ({ frac, E: 0, occupied: true, curvature: [1, 1, 1] });
    near(L.minimaFeatureValues(cell(3, 3, 3), [site([0, 0, 0])], 'Li').site_spacing, 3, 1e-9, 'one site in a primitive cell');
    near(L.minimaFeatureValues(cell(6, 3, 3), [site([0, 0, 0]), site([0.5, 0, 0])], 'Li').site_spacing, 3, 1e-9, 'same crystal in a supercell');
    near(L.minimaFeatureValues(cell(1, 10, 10), [site([0, 0, 0]), site([0, 0.5, 0])], 'Li').site_spacing, 1, 1e-9, 'self image nearer than the other site');
    const gamma = Math.atan2(0.6, 9) * 180 / Math.PI;
    near(L.minimaFeatureValues(cell(3, Math.hypot(9, 0.6), 10, gamma), [site([0, 0, 0])], 'Li').site_spacing, 0.6, 1e-8, 'shortest translation is B minus 3A');
    assert.equal(L.minimaFeatureValues(cell(3, 3, 3), [], 'Li').site_spacing, null);
  }

  // minimum classes group equivalent minima
  {
    const { minima } = await run('LiFePO4');
    const cls = L.minimumClasses(minima);
    assert.deepEqual(cls.map((c) => [c.occupied, c.count]), [[true, 4], [false, 4]]);
  }

  // CLI core: sites only with the grid
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const text = await readFile('src/samples/LiCoO2.cif', 'utf8');
  const withGrid = await x.extractFromText(text, 'LiCoO2.cif', { grid: 0.25 });
  assert.equal(withGrid.records[0].sites.length, 3);
  const rows = x.siteRows(withGrid.records);
  assert.deepEqual(rows[0], x.SITE_COLUMNS);
  assert.equal(rows.length, 4);
  assert.equal(rows[1][3], 'site');
  const json = JSON.parse(x.toJson(withGrid, { version: 't', mobile: undefined, hopCutoff: 4, grid: 0.25, hops: true }));
  assert.equal(json.structures[0].sites.length, 3);
  assert.equal(JSON.parse(x.toJson(withGrid, { version: 't', mobile: undefined, hopCutoff: 4, grid: 0.25, hops: true, sites: false })).structures[0].sites, undefined);
  const noGrid = await x.extractFromText(text, 'LiCoO2.cif', { grid: null });
  assert.equal(noGrid.records[0].sites.length, 0);
  assert.equal(noGrid.records[0].values.n_interstitial, null);
} finally {
  await server.close();
}
