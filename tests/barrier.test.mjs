import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Per-hop BVSE barriers: saddles, asymmetry and network thresholds', () => {
  const r = spawnSync(process.execPath, ['tests/barrier-fixture.mjs'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
