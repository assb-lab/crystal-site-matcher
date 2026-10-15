import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('3D scene: cation- and anion-centred polyhedra, highlighted hop path', () => {
  const r = spawnSync(process.execPath, ['tests/scene-fixture.mjs'], { encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
