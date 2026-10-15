import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Percolation along the lattice axes: union-find, BVSE, voids and hop network', () => {
  const r = spawnSync(process.execPath, ['tests/percolation-fixture.mjs'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
