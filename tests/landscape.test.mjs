import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('BVSE stable sites: minima, empty candidate sites and curvature', () => {
  const r = spawnSync(process.execPath, ['tests/landscape-fixture.mjs'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
