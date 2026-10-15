// Regression tests on real CIFs that may not be redistributed (e.g. from ICSD), so they are not in the
// repository. Put them in tests/private/ (gitignored) or point CSM_PRIVATE_CIFS at a folder holding them;
// a test is skipped when its file is missing. See tests/private-fixture.mjs for what each test checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dir = process.env.CSM_PRIVATE_CIFS || 'tests/private';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.cif$/i.test(f)) : [];
const find = (prefix) => files.find((f) => f.startsWith(prefix));

for (const [mode, prefix, name] of [
  ['argyrodite', 'Li6PS5Cl', 'Li6PS5Cl (argyrodite, S/Cl on 4a/4d): isolated anions, anion mixing, BVSE'],
  ['lgps', 'Li10GeP2S12', 'Li10GeP2S12 (LGPS, Ge/P on 4d): framework mixing, Li sites, BVSE'],
]) {
  const file = find(prefix);
  test(name, { skip: !file && `no ${prefix}*.cif in ${dir}` }, () => {
    const r = spawnSync(process.execPath, ['tests/private-fixture.mjs', mode, join(dir, file)], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
    assert.ifError(r.error);
    assert.equal(r.status, 0, r.stderr || r.stdout);
  });
}
