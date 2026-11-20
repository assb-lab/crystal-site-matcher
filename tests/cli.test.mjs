import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import test, { after, before } from 'node:test';
import { build } from 'vite';

const run = (args, opts = {}) => spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024, ...opts });

test('CLI core: features, hops, overrides and formatting', () => {
  const r = run(['tests/cli-fixture.mjs']);
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr || r.stdout);
});

const CLI = 'dist/csm-features.mjs';
// the shebang only works when the build leaves the file executable (#64)
test('built CLI runs directly through its shebang', { skip: (process.platform === 'win32' && 'no exec bit on Windows') || (!existsSync(CLI) && 'run pnpm build first') }, () => {
  assert.equal(statSync(CLI).mode & 0o755, 0o755, 'dist/csm-features.mjs is not executable');
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` };
  const r = spawnSync(`./${CLI}`, ['--help'], { encoding: 'utf8', timeout: 60000, env });
  assert.ifError(r.error);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^csm-features /);
});

// The checks below run the CLI built from the current source (not the committed dist/, which may lag
// behind src/cli in a branch). The build needs the app's notices file, as in pnpm build.
const NOTICES = 'dist/THIRD_PARTY_LICENSES.txt';
const noBuild = !existsSync(NOTICES) && 'run pnpm build first';
let SRC_CLI;
let buildDir;
before(async () => {
  if (noBuild) return;
  buildDir = mkdtempSync(join(tmpdir(), 'csm-build-'));
  copyFileSync(NOTICES, join(buildDir, 'THIRD_PARTY_LICENSES.txt'));
  await build({ configFile: 'vite.cli.config.ts', logLevel: 'silent', build: { outDir: buildDir } });
  SRC_CLI = join(buildDir, 'csm-features.mjs');
});
after(() => buildDir && rmSync(buildDir, { recursive: true, force: true }));

test('CLI writes features and hops', { skip: noBuild }, () => {
  const CLI = SRC_CLI;
  const dir = mkdtempSync(join(tmpdir(), 'csm-'));
  try {
    const out = join(dir, 'f.csv');
    const r = run([CLI, '-q', '--no-grid', '-j', '2', 'src/samples/LiCoO2.cif', 'src/samples/Li3N.cif', '-o', out]);
    assert.equal(r.status, 0, r.stderr);
    const rows = readFileSync(out, 'utf8').trim().split('\n');
    assert.equal(rows.length, 3);
    assert.ok(rows[0].startsWith('file,block,formula,ox_guessed,a,'));
    const hops = readFileSync(join(dir, 'f.hops.csv'), 'utf8').trim().split('\n');
    assert.equal(hops[0], 'file,block,mobile,from,to,d,rb,from_x,from_y,from_z,to_x,to_y,to_z,neck_x,neck_y,neck_z,via_x,via_y,via_z,E_saddle,barrier_fwd,barrier_rev');
    assert.equal(hops.filter((l) => l.includes('LiCoO2.cif')).length, 9);

    assert.equal(readFileSync(join(dir, 'f.sites.csv'), 'utf8'), 'file,block,mobile,kind,E,x,y,z,nearest,d_nearest,curv_1,curv_2,curv_3\n', 'no stable sites without the grid: header only');
    const g = join(dir, 'g.csv');
    assert.equal(run([CLI, '-q', '--grid', '0.3', 'src/samples/LiCoO2.cif', '-o', g]).status, 0);
    const sites = readFileSync(join(dir, 'g.sites.csv'), 'utf8').trim().split('\n');
    assert.equal(sites[0], 'file,block,mobile,kind,E,x,y,z,nearest,d_nearest,curv_1,curv_2,curv_3');
    assert.equal(sites.length, 4);
    // a later run with the same --output rewrites the side tables, even when they are empty now (#82)
    assert.equal(run([CLI, '-q', '--no-grid', '--mobile', 'none', 'src/samples/LiCoO2.cif', '-o', g]).status, 0);
    assert.deepEqual(readFileSync(join(dir, 'g.sites.csv'), 'utf8').trim().split('\n'), [sites[0]]);
    assert.equal(readFileSync(join(dir, 'g.hops.csv'), 'utf8').trim().split('\n').length, 1);

    const j = run([CLI, '-q', '--no-grid', '-f', 'json', '--mobile', 'none', 'src/samples/LiCoO2.cif']);
    assert.equal(j.status, 0, j.stderr);
    const doc = JSON.parse(j.stdout);
    assert.equal(doc.structures[0].hops, undefined);

    const bad = run([CLI, '-q', '--no-grid', 'tests/cli.test.mjs']);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /No data block with atomic coordinates/);
    assert.equal(run([CLI, '--no-such-option']).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const NO_SYMLINKS = process.platform === 'win32' && 'symbolic links need privileges on Windows';

test('CLI: unreadable entries in an input directory are errors of their own (#82)', { skip: noBuild || NO_SYMLINKS }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'csm-'));
  const cifs = join(dir, 'cifs');
  const locked = join(cifs, 'locked');
  try {
    mkdirSync(join(cifs, 'sub'), { recursive: true });
    mkdirSync(locked);
    copyFileSync('src/samples/LiCoO2.cif', join(cifs, 'LiCoO2.cif'));
    copyFileSync('src/samples/Li3N.cif', join(cifs, 'sub', 'Li3N.cif'));
    symlinkSync('missing.cif', join(cifs, 'broken.cif')); // broken link to a CIF
    symlinkSync('missing', join(cifs, 'broken')); // broken link to something else
    symlinkSync(resolve(cifs), join(cifs, 'sub', 'loop')); // loop under -r
    writeFileSync(join(locked, 'x.cif'), 'data_x\n');
    chmodSync(locked, 0o000);
    const out = join(dir, 'f.csv');
    for (const jobs of ['1', '2']) {
      const r = run([SRC_CLI, '-q', '--no-grid', '-r', '-j', jobs, cifs, '-o', out]);
      assert.ifError(r.error);
      assert.equal(r.status, 1, r.stderr);
      assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
      assert.match(r.stderr, /error: .*broken\.cif: /);
      assert.match(r.stderr, /warning: .*broken: skipped/);
      assert.match(r.stderr, /warning: .*loop: directory already visited/);
      const rows = readFileSync(out, 'utf8').trim().split('\n');
      assert.deepEqual(rows.slice(1).map((l) => l.split(',')[2]), ['LiCoO2', 'Li3N'], 'the readable files are still computed once each');
      // root can read any directory; elsewhere the locked one is reported
      if (process.getuid?.() !== 0) assert.match(r.stderr, /error: .*locked: cannot read directory/);
    }
  } finally {
    chmodSync(locked, 0o755);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI: --mobile not in the structure and unmatched --ox keys are reported (#82)', { skip: noBuild }, () => {
  const j = run([SRC_CLI, '-q', '--no-grid', '-f', 'json', '--mobile', 'Na', '--ox', 'co=2', 'src/samples/LiCoO2.cif']);
  assert.equal(j.status, 0, j.stderr);
  assert.match(j.stderr, /warning: .*LiCoO2\.cif \[LiCoO2\]: mobile ion Na is not in the structure/);
  assert.match(j.stderr, /warning: --ox: "co" matches no site label or element/);
  const doc = JSON.parse(j.stdout);
  const s = doc.structures[0];
  assert.equal(s.mobile, null);
  assert.equal(s.features.mobile, null, 'the mobile column follows the ion actually used');
  assert.equal(s.features.dMM, null);
  assert.equal(s.ox.Co1, 3, 'the unmatched key changed nothing');
  assert.equal(doc.warnings.length, 2);
  const csv = run([SRC_CLI, '-q', '--no-grid', '--mobile', 'Na', '--ox', 'Co=3', 'src/samples/LiCoO2.cif']);
  assert.equal(csv.status, 0);
  assert.doesNotMatch(csv.stderr, /--ox/, 'a matching key is not reported');
  const [head, row] = csv.stdout.trim().split('\n').map((l) => l.split(','));
  assert.equal(row[head.indexOf('mobile')], '');
});
