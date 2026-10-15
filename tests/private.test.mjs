// Regression tests on the sulphide electrolytes. The bundled samples (src/samples, entered from the
// published coordinates) are always checked. The original CIFs (e.g. from ICSD) may not be redistributed,
// so they are not in the repository: put them in tests/private/ (gitignored) or point CSM_PRIVATE_CIFS at a
// folder holding them; a test is skipped when its file is missing. See tests/private-fixture.mjs for the checks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const dir = process.env.CSM_PRIVATE_CIFS || 'tests/private';
const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.cif$/i.test(f)) : [];
const find = (prefix) => files.find((f) => f.startsWith(prefix));
const check = (mode, path) => {
  const r = spawnSync(process.execPath, ['tests/private-fixture.mjs', mode, path], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
};

for (const [mode, prefix, name] of [
  ['argyrodite', 'Li6PS5Cl', 'Li6PS5Cl (argyrodite, S/Cl on 4a/4d): isolated anions, anion mixing, BVSE'],
  ['lgps', 'Li10GeP2S12', 'Li10GeP2S12 (LGPS, Ge/P on 4d): framework mixing, Li sites, BVSE'],
]) {
  test(`${name} — bundled sample`, () => check(mode, `src/samples/${prefix}.cif`));
  const file = find(prefix);
  test(`${name} — original CIF`, { skip: !file && `no ${prefix}*.cif in ${dir}` }, () => check(mode, join(dir, file)));
}
