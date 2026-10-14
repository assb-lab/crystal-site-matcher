// Unit checks of the CLI core (src/cli/extract.ts), loaded through vite like chart-fixture.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true } });
try {
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const lco = await readFile('src/samples/LiCoO2.cif', 'utf8');

  // automatic mobile ion → hops with distance and bottleneck radius
  const r = await x.extractFromText(lco, 'LiCoO2.cif', { grid: null });
  assert.deepEqual(r.errors, []);
  assert.equal(r.records.length, 1);
  const s = r.records[0];
  assert.equal(s.mobile, 'Li');
  assert.equal(s.hops.length, 9);
  for (const h of s.hops) {
    assert.ok(Math.abs(h.d - 2.8156) < 1e-6);
    assert.ok(h.rb > 0 && h.rb < 1);
    assert.equal(h.from, 'Li1');
  }
  assert.ok(Math.abs(s.values.dMM - 2.8156) < 1e-6);
  assert.ok(Math.abs(s.values.rb_min - Math.min(...s.hops.map((h) => h.rb))) < 1e-12);
  assert.equal(s.values.E_1D, null, '--no-grid leaves grid features empty');

  // feature table: one row, header = id columns + every feature key, no duplicates
  const rows = x.featureRows(r.records);
  assert.equal(new Set(rows[0]).size, rows[0].length);
  assert.equal(rows[1][rows[0].indexOf('mobile')], 'Li');
  assert.equal(rows[1][rows[0].indexOf('system')], 'trigonal');
  assert.equal(x.hopRows(r.records).length, 10);

  // no mobile ion → no hops
  const none = await x.extractFromText(lco, 'LiCoO2.cif', { grid: null, mobile: null });
  assert.equal(none.records[0].mobile, null);
  assert.equal(none.records[0].hops.length, 0);
  assert.equal(x.hopRows(none.records).length, 1);

  // the grid stage gives the same barrier as the app pipeline
  const lfp = await x.extractFromText(await readFile('src/samples/LiFePO4.cif', 'utf8'), 'LiFePO4.cif', { grid: 0.25 });
  assert.ok(Math.abs(lfp.records[0].values.E_1D - 0.44) < 0.1, `E_1D ${lfp.records[0].values.E_1D}`);

  // oxidation-state override by element and label
  const ox = await x.extractFromText(lco, 'LiCoO2.cif', { grid: null, oxOverride: { Co: 2, Li1: 2 } });
  assert.deepEqual(ox.records[0].ox, { Li1: 2, Co1: 2, O1: -2 });

  // errors are collected, not thrown
  const bad = await x.extractFromText('data_x\n_cell_length_a 3\n', 'bad.cif');
  assert.equal(bad.records.length, 0);
  assert.match(bad.errors[0].message, /_atom_site_fract_x/);

  // formatting
  assert.equal(x.num(-0), '0');
  assert.equal(x.num(1 / 3), '0.33333333');
  assert.equal(x.coord(1.2e-32), '0');
  assert.equal(x.delimited([['a', 'b,c', 'd"e']], ','), 'a,"b,c","d""e"\n');
  assert.equal(x.delimited([['a\tb', 'c']], '\t'), 'a b\tc\n');
  const json = JSON.parse(x.toJson(r, { version: 't', mobile: undefined, hopCutoff: 4, grid: null, hops: true }));
  assert.equal(json.structures[0].hops.length, 9);
  assert.equal(json.units.d_mobile, 'Å');
  const noHops = JSON.parse(x.toJson(r, { version: 't', mobile: undefined, hopCutoff: 4, grid: null, hops: false }));
  assert.equal(noHops.structures[0].hops, undefined);
} finally {
  await server.close();
}
