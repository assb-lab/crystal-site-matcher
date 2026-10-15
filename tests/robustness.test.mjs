import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Trap depth, connected low-energy volume, bypass of the limiting window, site recovery and grid convergence', () => {
  const r = spawnSync(process.execPath, ['tests/robustness-fixture.mjs'], { encoding: 'utf8', timeout: 240000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
