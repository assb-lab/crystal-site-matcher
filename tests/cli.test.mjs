import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const run = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, ...opts });

test('CLI core: features, hops, overrides and formatting', () => {
  const r = run(['tests/cli-fixture.mjs']);
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

const CLI = 'dist/csm-features.mjs';
test('built CLI (dist/csm-features.mjs) writes features and hops', { skip: !existsSync(CLI) && 'run pnpm build first' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'csm-'));
  try {
    const out = join(dir, 'f.csv');
    const r = run([CLI, '-q', '--no-grid', '-j', '2', 'src/samples/LiCoO2.cif', 'src/samples/Li3N.cif', '-o', out]);
    assert.equal(r.status, 0, r.stderr);
    const rows = readFileSync(out, 'utf8').trim().split('\n');
    assert.equal(rows.length, 3);
    assert.ok(rows[0].startsWith('file,block,formula,ox_guessed,a,'));
    const hops = readFileSync(join(dir, 'f.hops.csv'), 'utf8').trim().split('\n');
    assert.equal(hops[0], 'file,block,mobile,from,to,d,rb,from_x,from_y,from_z,to_x,to_y,to_z,neck_x,neck_y,neck_z,E_saddle,barrier_fwd,barrier_rev');
    assert.equal(hops.filter((l) => l.includes('LiCoO2.cif')).length, 9);

    assert.ok(!existsSync(join(dir, 'f.sites.csv')), 'no stable sites without the grid');
    const g = join(dir, 'g.csv');
    assert.equal(run([CLI, '-q', '--grid', '0.3', 'src/samples/LiCoO2.cif', '-o', g]).status, 0);
    const sites = readFileSync(join(dir, 'g.sites.csv'), 'utf8').trim().split('\n');
    assert.equal(sites[0], 'file,block,mobile,kind,E,x,y,z,nearest,d_nearest,curv_1,curv_2,curv_3');
    assert.equal(sites.length, 4);

    const j = run([CLI, '-q', '--no-grid', '-f', 'json', '--mobile', 'none', 'src/samples/LiCoO2.cif']);
    assert.equal(j.status, 0, j.stderr);
    const doc = JSON.parse(j.stdout);
    assert.equal(doc.structures[0].hops, undefined);

    const bad = run([CLI, '-q', '--no-grid', 'tests/cli.test.mjs']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /No data block with atomic coordinates/);
    assert.equal(run([CLI, '--no-such-option']).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
