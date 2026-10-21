// Checks of the WebMCP tools (src/webmcp.ts, #70) against an in-memory app and a fake document.modelContext.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const W = await server.ssrLoadModule('/src/webmcp.ts');
  const { docFromText, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
  const { SAMPLES } = await server.ssrLoadModule('/src/samples.ts');
  const { analyzeSite, allCandidates, evaluateCandidate } = await server.ssrLoadModule('/src/lib/analysis.ts');
  const x = await server.ssrLoadModule('/src/cli/extract.ts');

  // the app as the tools see it
  const state = { docs: [], activeId: null, view: 'struct' };
  const app = {
    docs: () => state.docs,
    activeId: () => state.activeId,
    view: () => state.view,
    openSample(id) {
      const s = SAMPLES.find((v) => v.id === id);
      if (!s) throw new Error(`Unknown sample "${id}"`);
      const d = docFromText(s.text, `${id}.cif`, state.docs.length, s.site);
      state.docs = [...state.docs, d];
      state.activeId = d.id;
      return d;
    },
    openCif(text, fileName) {
      const d = docFromText(text, fileName, state.docs.length);
      state.docs = [...state.docs, d];
      state.activeId = d.id;
      return { opened: [d], errors: [] };
    },
    select(id, view) {
      state.activeId = id;
      if (view) state.view = view;
    },
    update(id, patch) {
      state.docs = state.docs.map((d) => (d.id === id ? { ...d, ...patch } : d));
    },
    close(id) {
      state.docs = state.docs.filter((d) => d.id !== id);
      if (state.activeId === id) state.activeId = state.docs[0]?.id ?? null;
    },
  };
  const tools = W.buildTools(app);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const call = async (name, input = {}) => {
    const r = await byName[name].execute(input);
    assert.equal(r.content[0].type, 'text');
    return r.isError ? { error: r.content[0].text } : JSON.parse(r.content[0].text);
  };

  // definitions follow the draft: valid names, non-empty descriptions, serialisable object schemas
  assert.deepEqual(tools.map((t) => t.name).sort(), ['analyze_site', 'close_structure', 'get_features', 'get_hops', 'get_structure', 'list_samples', 'list_structures', 'open_cif', 'open_sample', 'rank_substituents', 'select_structure', 'set_calculation']);
  for (const t of tools) {
    assert.match(t.name, /^[A-Za-z0-9_.-]{1,128}$/);
    assert.ok(t.description.length > 20, t.name);
    assert.equal(JSON.parse(JSON.stringify(t.inputSchema)).type, 'object');
  }
  const readOnly = tools.filter((t) => t.annotations?.readOnlyHint).map((t) => t.name).sort();
  assert.deepEqual(readOnly, ['analyze_site', 'get_features', 'get_hops', 'get_structure', 'list_samples', 'list_structures', 'rank_substituents']);

  // nothing open → a readable error, not an exception
  assert.match((await call('get_structure')).error, /No structure is open/);
  assert.equal((await call('list_samples')).length, SAMPLES.length);
  assert.ok((await call('list_samples')).every((s) => !/[぀-ヿ一-鿿]/.test(s.name)), 'English sample names');

  // open a sample; the summary and structure describe it
  const lgps = await call('open_sample', { sample: 'LGPS' });
  assert.equal(lgps.active, true);
  assert.equal(lgps.mobileIon, 'Li');
  const st = await call('get_structure');
  assert.equal(st.id, lgps.id);
  assert.ok(Math.abs(st.lattice.a - 8.719) < 1e-9);
  assert.deepEqual(st.mixedSites, ['Ge1/P1']);
  assert.equal(st.sites.find((s) => s.label === 'Li1').occupancy, 0.466);

  // features: the same numbers as the CLI (shared pipeline), filtered by key
  const cli = (await x.extractFromText(await readFile('src/samples/Li10GeP2S12.cif', 'utf8'), 'LGPS', {})).records[0].values;
  const f = await call('get_features', { keys: ['rb_min', 'E_1D', 'E_3D', 'logD', 'system'] });
  assert.deepEqual(f.features.map((v) => v.key), ['rb_min', 'E_1D', 'E_3D', 'logD', 'system']);
  for (const v of f.features.filter((v) => typeof v.value === 'number')) assert.ok(Math.abs(v.value - cli[v.key]) < 1e-12, `${v.key}: ${v.value} vs ${cli[v.key]}`);
  assert.equal(f.features.find((v) => v.key === 'system').value, 'tetragonal');
  assert.equal(f.features.find((v) => v.key === 'E_1D').unit, 'eV');
  const noGrid = await call('get_features', { grid: false, keys: ['E_1D', 'rb_min'] });
  assert.equal(noGrid.features[0].value, null);
  assert.ok(Math.abs(noGrid.features[1].value - cli.rb_min) < 1e-12);
  assert.match((await call('get_features', { keys: ['nope'] })).error, /Unknown feature keys: nope/);

  // hops: the classes of the Features tab
  const hops = await call('get_hops');
  assert.equal(hops.hops.reduce((s, h) => s + h.count, 0), 112);
  assert.ok(hops.hops.every((h) => h.bottleneckRadius > 0));

  // site analysis and substituents on LiCoO2's Co site: same numbers as analysis.ts
  const lco = await call('open_sample', { sample: 'LiCoO2' });
  const site = await call('analyze_site', { site: 'Co1' });
  assert.equal(site.id, lco.id);
  assert.equal(site.coordinationNumber, 6);
  assert.deepEqual(site.host, { label: 'Co1', element: 'Co', oxidationState: 3 });
  assert.equal(site.ligands.length, 6);
  const d = state.docs.find((v) => v.id === lco.id);
  const { bonds } = deriveBonds(d.crystal, d.ox, d.bondSettings);
  const a = analyzeSite(d.crystal, d.ox, bonds, d.crystal.groups.find((g) => g.key === 'Co1').positions[0], { kind: 'ionic' });
  const best = allCandidates(3).map((c) => evaluateCandidate(a, c, { sizeTol: 0.15, useBVS: true, useCharge: true })).filter(Boolean).filter((r) => Math.abs(r.dq) <= 1).sort((p, q) => q.score - p.score)[0];
  const ranked = await call('rank_substituents', { site: 'Co1', limit: 5 });
  assert.equal(ranked.candidates.length, 5);
  assert.ok(Math.abs(ranked.candidates[0].score - best.score) < 1e-3);
  assert.ok(ranked.candidates.every((c, i) => i === 0 || c.score <= ranked.candidates[i - 1].score));
  assert.ok((await call('rank_substituents', { site: 'Co1', charge: 'same', limit: 50 })).candidates.every((c) => c.chargeDifference === 0));
  assert.match((await call('analyze_site', { site: 'Xx9' })).error, /No site "Xx9"\. Sites: Li1, Co1, O1/);

  // CIF text, selection, settings and closing
  const li3n = await call('open_cif', { cif: await readFile('src/samples/Li3N.cif', 'utf8'), fileName: 'li3n.cif' });
  assert.equal(li3n.opened[0].formula, 'Li3N');
  assert.match((await call('open_cif', { cif: 'data_x\n_cell_length_a 1\n' })).error, /./);
  assert.deepEqual(await call('select_structure', { id: lgps.id, view: 'feat' }), { selected: lgps.id, view: 'feat' });
  assert.match((await call('select_structure', { view: 'bogus' })).error, /Unknown view/);
  assert.deepEqual((await call('set_calculation', { hopCutoff: 3.5, gridResolution: 0.25 })).settings, { mobileIon: 'Li', hopCutoff: 3.5, gridResolution: 0.25 });
  assert.match((await call('set_calculation', { mobileIon: 'Na' })).error, /Mobile ion must be null or an element/);
  assert.match((await call('set_calculation', { hopCutoff: 9 })).error, /between 1\.5 and 6/);
  assert.equal((await call('set_calculation', { mobileIon: null })).settings.mobileIon, null);
  assert.deepEqual((await call('get_hops')).hops, []);
  const closed = await call('close_structure', { id: lco.id });
  assert.deepEqual(closed.open, [lgps.id, li3n.opened[0].id]);
  assert.match((await call('close_structure', { id: lco.id })).error, /No open structure/);

  // registration: one call per tool with an abort signal; the cleanup aborts it and uses unregisterTool when present
  {
    const registered = [];
    const unregistered = [];
    const ctx = {
      registerTool(tool, opts) {
        registered.push({ tool, signal: opts.signal });
        return Promise.resolve();
      },
      unregisterTool(name) {
        unregistered.push(name);
      },
    };
    const cleanup = W.registerWebMcp(app, ctx);
    assert.equal(registered.length, tools.length);
    assert.ok(registered.every((r) => r.signal && !r.signal.aborted));
    cleanup();
    assert.ok(registered.every((r) => r.signal.aborted));
    assert.equal(unregistered.length, tools.length);
    // a rejected or throwing registration does not stop the others
    let n = 0;
    W.registerWebMcp(app, { registerTool: () => (n++ === 0 ? (() => { throw new Error('duplicate'); })() : Promise.reject(new Error('x'))) })();
    assert.equal(n, tools.length);
    // no WebMCP → nothing to do
    assert.equal(typeof W.registerWebMcp(app, null), 'function');
  }
} finally {
  await server.close();
}
