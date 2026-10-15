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
      near(b.fwd - b.rev, Math.max(0, b.Esad - b.Ea) - Math.max(0, b.Esad - b.Eb), 1e-9, `${f}: fwd/rev`);
      // the saddle lies in the search tube around the straight line
      const A = cr.positions[h.a].cart;
      const B = toCart(cr.lattice, cr.positions[h.b].frac.map((x, k) => x + h.t[k]));
      const AB = [0, 1, 2].map((k) => B[k] - A[k]);
      const w = [0, 1, 2].map((k) => b.saddle[k] - A[k]);
      const t = Math.max(0, Math.min(1, (w[0] * AB[0] + w[1] * AB[1] + w[2] * AB[2]) / (AB[0] ** 2 + AB[1] ** 2 + AB[2] ** 2)));
      const dist = Math.hypot(...[0, 1, 2].map((k) => w[k] - t * AB[k]));
      assert.ok(dist <= Math.max(HB.HOP_TUBE_MIN, h.d * HB.HOP_TUBE_FRAC) + 1e-9, `${f}: saddle inside the tube`);
    });
    // equivalent hops share one saddle
    for (const c of hopClasses(cr, st.hops)) assert.equal(new Set(c.members.map((i) => g.barriers[i].Esad)).size, 1, `${f}: class ${c.key}`);
    // hop paths are grid paths, so the network cannot connect clearly below the grid percolation energy;
    // equivalent hops share their lowest saddle, which may undercut it by the grid error (tens of meV)
    for (const d of ['1D', '2D', '3D']) if (v[`E_hop_${d}`] !== null && v[`E_${d}`] !== null) assert.ok(v[`E_hop_${d}`] >= v[`E_${d}`] - 0.05, `${f}: E_hop_${d} ${v[`E_hop_${d}`]} vs E_${d} ${v[`E_${d}`]}`);
  }

  // LiFePO₄: the 1D channel along b is the hop network itself → the same barrier as the grid
  {
    const { v } = await run('LiFePO4');
    near(v.E_hop_1D, v.E_1D, 0.02, 'LiFePO4 E_hop_1D');
    near(v.hop_asymmetry, 0, 1e-3, 'one Li site');
    assert.equal(v.E_hop_3D, null);
  }
  // LiCoO₂: nine equivalent hops → no spread
  {
    const { v } = await run('LiCoO2');
    near(v.hop_barrier_sd, 0, 1e-3, 'LiCoO2 spread');
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
    const b = g.barriers[0];
    assert.match(ja, new RegExp(`<td class="num mono">${b.fwd.toFixed(2)} / ${b.rev.toFixed(2)}</td>`));
    const pending = render('ja', { ...entry, grid: null, gridStatus: 'pending', barriers: null, minima: null });
    assert.doesNotMatch(pending, /ΔE‡/);
    assert.match(yButton(pending), /disabled/);
    assert.doesNotMatch(render('en', entry).replace(/<option[^>]*>[^<]*<\/option>/g, ''), /[぀-ヿ一-鿿]/);
  }
} finally {
  await server.close();
}
