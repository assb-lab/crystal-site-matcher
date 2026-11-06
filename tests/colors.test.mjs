import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('Element colours: palette storage, 3D scene and the colour pickers', () => {
  const r = spawnSync(process.execPath, ['tests/colors-fixture.mjs'], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});
