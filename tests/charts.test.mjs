import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

for (const [mode, name] of [
  ['ticks', 'Chart axes terminate for symmetry-equivalent and ordinary values'],
  ['lco', 'Actual LiCoO2 CIF renders the features panel and all nine hops'],
]) {
  test(name, () => {
    const result = spawnSync(process.execPath, ['tests/chart-fixture.mjs', mode], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}
