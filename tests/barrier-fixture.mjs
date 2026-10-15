// Checks of the per-hop BVSE barriers (src/lib/hopBarriers.ts) through the shared pipeline, loaded with vite.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const HB = await server.ssrLoadModule('/src/lib/hopBarriers.ts');
  const { hopClasses } = await server.ssrLoadModule('/src/lib/features.ts');
  const { blocksWithAtoms } = await server.ssrLoadModule('/src/lib/doc.ts');
  const { toCart } = await server.ssrLoadModule('/src/lib/structure.ts');
  const near = (a, b, tol, msg) => assert.ok(a !== null && Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
  const run = async (f, res = 0.25) => {
    const s = p.prepareStructure(blocksWithAtoms(await readFile(`src/samples/${f}.cif`, 'utf8'))[0]);
    const st = p.staticStage(s, p.DEFAULT_HOP_CUTOFF);
    const g = await p.gridStage(s, res, undefined, undefined, st.hops);
    return { s, st, g, v: g.values };
  };

  for (const f of ['LiFePO4', 'LiCoO2', 'Li3N', 'AgI_alpha', 'MgAl2O4']) {
    const { s, st, g, v } = await run(f);
    assert.equal(g.barriers.length, st.hops.length);
    const cr = s.crystal;
    st.hops.forEach((h, i) => {
      const b = g.barriers[i];
      assert.ok(b, `${f}: every hop has a path`);
      assert.ok(b.fwd >= 0 && b.rev >= 0);
      // both barriers rise to the same saddle
      near(b.fwd - b.rev, b.Eb - b.Ea, 1e-9, `${f}: endpoint-energy difference`);
      assert.ok(b.Esad >= b.Ea && b.Esad >= b.Eb, `${f}: path includes both exact endpoints`);
      // the saddle lies in the search tube around the straight line
      const A = cr.positions[h.a].cart;
      const B = toCart(cr.lattice, cr.positions[h.b].frac.map((x, k) => x + h.t[k]));
      const AB = [0, 1, 2].map((k) => B[k] - A[k]);
      const w = [0, 1, 2].map((k) => b.saddle[k] - A[k]);
      const t = Math.max(0, Math.min(1, (w[0] * AB[0] + w[1] * AB[1] + w[2] * AB[2]) / (AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2)));
      const dist = Math.hypot(...[0, 1, 2].map((k) => w[k] - t * AB[k]));
      assert.ok(dist <= Math.max(HB.HOP_TUBE_MIN, h.d * HB.HOP_TUBE_FRAC) + 1e-9, `${f}: saddle inside the tube`);
    });
    // Every stored saddle must be the maximum actually returned for that hop, not another class member's.
    st.hops.forEach((h, i) => {
      const b = g.barriers[i];
      const A = cr.positions[h.a].cart;
      const B = toCart(cr.lattice, cr.positions[h.b].frac.map((v, k) => v + h.t[k]));
      const same = (a, b) => Math.hypot(...a.map((v, k) => v - b[k])) < 1e-8;
      if (same(b.saddle, A) && Math.abs(b.Esad - b.Ea) < 1e-8) return;
      if (same(b.saddle, B) && Math.abs(b.Esad - b.Eb) < 1e-8) return;
      const frac = cr.lattice.inv.map((r) => r.reduce((sum, v, k) => sum + v * b.saddle[k], 0));
      const node = frac.map((v, k) => Math.round(v * g.grid.n[k]));
      const [n0, n1, n2] = g.grid.n;
      const wrap = (i, n) => ((i % n) + n) % n;
      const energy = g.grid.energy[wrap(node[0], n0) + n0 * (wrap(node[1], n1) + n1 * wrap(node[2], n2))];
      near(b.Esad, energy, 1e-8, `${f}: marker and saddle energy`);
    });
    // Connecting a subgraph of paths on the same grid cannot lower its percolation threshold.
    for (const d of ['1D', '2D', '3D']) if (v[`E_hop_${d}`] !== null && v[`E_${d}`] !== null) assert.ok(v[`E_hop_${d}`] >= v[`E_${d}`] - 1e-6, `${f}: E_hop_${d} ${v[`E_hop_${d}`]} vs E_${d} ${v[`E_${d}`]}`);
  }

  // LiFePO₄: the 1D channel along b is the hop network itself → the same barrier as the grid
  {
    const { v } = await run('LiFePO4');
    near(v.E_hop_1D, v.E_1D, 0.02, 'LiFePO4 E_hop_1D');
    near(v.hop_asymmetry, 0, 1e-3, 'one Li site');
    assert.equal(v.E_hop_3D, null);
  }
  // A coarse grid must still include the exact endpoint energies (formerly clamped one direction alone).
  {
    const { g } = await run('Li3N', 0.4);
    for (const b of g.barriers) {
      assert.ok(b.Esad >= Math.max(b.Ea, b.Eb));
      near(b.fwd - b.rev, b.Eb - b.Ea, 1e-9, 'coarse-grid detailed balance');
    }
  }

  // Geometrically identical self hops in an anisotropic periodic field have distinct barriers.
  {
    const crystal = p.prepareStructure(blocksWithAtoms(`data_anisotropic
_cell_length_a 3
_cell_length_b 3
_cell_length_c 3
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
Li1 Li+ 0 0 0
`)[0]).crystal;
    const E = (x, y, z) => 0.1 * Math.sin(Math.PI * x / 3) ** 2 + Math.sin(Math.PI * y / 3) ** 2 + 2 * Math.sin(Math.PI * z / 3) ** 2;
    const energy = new Float32Array(12 ** 3);
    for (let k = 0; k < 12; k++) for (let j = 0; j < 12; j++) for (let i = 0; i < 12; i++) energy[i + 12 * (j + 12 * k)] = E(i / 4, j / 4, k / 4);
    const field = { eval: (x, y, z) => [E(x, y, z), 0] };
    const hops = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((t) => ({ a: 0, b: 0, t, d: 3, rb: 0.5, mid: t.map((v) => 1.5 * v) }));
    assert.equal(hopClasses(crystal, hops).length, 1, 'one geometric display group');
    const bs = await HB.hopBarriers(crystal, { energy, n: [12, 12, 12], eMinAbs: 0 }, field, hops);
    const v = HB.hopBarrierFeatureValues(crystal, hops, bs);
    [0.1, 1, 2].forEach((want, i) => {
      near(bs[i].Esad, want, 1e-6, `axis ${i} saddle`);
      near(E(...bs[i].saddle), want, 1e-6, `axis ${i} marker`);
      near(v[`E_hop_${i + 1}D`], want, 1e-6, `network rank ${i + 1}`);
    });
  }
  // Li₃N: Li1 (high BVSE) → Li2 is easy, Li2 → Li1 is hard; the gap is the site-energy difference
  {
    const { s, st, g } = await run('Li3N');
    const cls = hopClasses(s.crystal, st.hops).find((c) => c.from === 'Li1' && c.to === 'Li2');
    const b = g.barriers[cls.members[0]];
    const [eLi1, eLi2] = s.crystal.positions[st.hops[cls.members[0]].a].group === 'Li1' ? [b.Ea, b.Eb] : [b.Eb, b.Ea];
    assert.ok(eLi1 - eLi2 > 0.5, 'Li1 sits higher');
    const [up, down] = s.crystal.positions[st.hops[cls.members[0]].a].group === 'Li2' ? [b.fwd, b.rev] : [b.rev, b.fwd];
    near(up - down, eLi1 - eLi2, 1e-6, 'asymmetry = site-energy difference');
  }

  // CLI core: barrier columns only with the grid
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const text = await readFile('src/samples/LiCoO2.cif', 'utf8');
  const grid = await x.extractFromText(text, 'LiCoO2.cif', { grid: 0.3 });
  const rows = x.hopRows(grid.records);
  assert.deepEqual(rows[0].slice(-3), ['E_saddle', 'barrier_fwd', 'barrier_rev']);
  assert.ok(rows.slice(1).every((r) => r.length === rows[0].length && r.slice(-3).every((c) => c !== '')));
  const json = JSON.parse(x.toJson(grid, { version: 't', mobile: undefined, hopCutoff: 4, grid: 0.3, hops: true }));
  assert.ok(json.structures[0].hops.every((h) => typeof h.Esad === 'number' && h.barrierFwd >= 0));
  const quick = await x.extractFromText(text, 'LiCoO2.cif', { grid: null });
  assert.ok(x.hopRows(quick.records).slice(1).every((r) => r.slice(-3).every((c) => c === '')));
  assert.equal(JSON.parse(x.toJson(quick, { version: 't', mobile: undefined, hopCutoff: 4, grid: null, hops: true })).structures[0].hops[0].Esad, undefined);

  // features panel: barrier column and y-axis switch once barriers exist
  {
    const { docFromText } = await server.ssrLoadModule('/src/lib/doc.ts');
    const { default: FeaturesPanel } = await server.ssrLoadModule('/src/components/FeaturesPanel.tsx');
    const { I18nProvider } = await server.ssrLoadModule('/src/i18n/index.tsx');
    const { simulateXrd } = await server.ssrLoadModule('/src/lib/xrd.ts');
    const doc = docFromText(text, 'LiCoO2.cif', 0);
    const st = p.staticStage(doc, doc.hopCutoff);
    const g = await p.gridStage(doc, 0.3, undefined, undefined, st.hops);
    const entry = { static: st, values: { ...st.values, ...g.values }, xrd: simulateXrd(doc.crystal), grid: g.grid, gridStatus: 'done', siteE: g.siteE, minima: g.minima, barriers: g.barriers, progress: 1 };
    const render = (lang, e) => renderToStaticMarkup(createElement(I18nProvider, { initial: lang }, createElement(FeaturesPanel, { doc, update: () => {}, entry: e })));
    const ja = render('ja', entry);
    assert.match(ja, /ΔE‡ \(eV\)/);
    const yButton = (html) => html.match(/<button[^>]*id="hop-y-barrier"[^>]*>/)[0];
    assert.doesNotMatch(yButton(ja), /disabled/);
    const range = (xs) => { const lo = Math.min(...xs).toFixed(2), hi = Math.max(...xs).toFixed(2); return lo === hi ? lo : `${lo}–${hi}`; };
    const bs = g.barriers;
    assert.ok(ja.includes(`<td class="num mono">${range(bs.map((b) => b.fwd))} / ${range(bs.map((b) => b.rev))}</td>`));
    const spread = { ...entry, barriers: bs.map((b, i) => ({ ...b, Esad: i ? 0.8 : 0.2, fwd: i ? 0.8 : 0.2, rev: i ? 0.9 : 0.3 })) };
    assert.ok(render('ja', spread).includes('0.20–0.80 / 0.30–0.90'), 'show the whole group spread, not the first hop');
    const pending = render('ja', { ...entry, grid: null, gridStatus: 'pending', barriers: null, minima: null });
    assert.doesNotMatch(pending, /ΔE‡/);
    assert.match(yButton(pending), /disabled/);
    assert.doesNotMatch(render('en', entry).replace(/<option[^>]*>[^<]*<\/option>/g, ''), /[぀-ヿ一-鿿]/);
  }
} finally {
  await server.close();
}
