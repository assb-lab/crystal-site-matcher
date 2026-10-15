import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('CIF-only descriptors: isolated anions, site spreads, mixed sites, BVVS', () => {
  const r = spawnSync(process.execPath, ['tests/descriptors-fixture.mjs'], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
