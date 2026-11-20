import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Calculation regressions (#80): occupancy, mixed valence, labels, symmetry, CIF tokens, BVSE field and grid', () => {
  const r = spawnSync(process.execPath, ['tests/regressions-fixture.mjs'], { encoding: 'utf8', timeout: 180000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
