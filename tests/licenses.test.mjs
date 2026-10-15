// Third-party notices in the committed builds (#60): every bundled package and data source with its
// licence text, as read from node_modules and scripts/data-licenses.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

// direct dependencies sit in node_modules; scheduler is react-dom's own dependency (next to it in the pnpm store)
const dirOf = (name) => (name === 'scheduler' ? join(realpathSync('node_modules/react-dom'), '..', 'scheduler') : join('node_modules', name));
const licenceOf = (name) => {
  const dir = dirOf(name);
  const file = readdirSync(dir).find((f) => /^licen[cs]e(\.(md|txt))?$/i.test(f));
  return { version: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).version, text: readFileSync(join(dir, file), 'utf8').trim() };
};
const data = readFileSync('scripts/sources.lock', 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().split(/\s+/)[0]);

test('dist/index.html starts with the notices of React, three.js and the data sources', () => {
  const html = readFileSync('dist/index.html', 'utf8');
  const m = html.match(/^<!doctype html>\s*<!--\n([\s\S]*?)\n-->\n/i);
  assert.ok(m, 'notice comment right after the doctype');
  const notes = m[1];
  assert.equal(readFileSync('dist/THIRD_PARTY_LICENSES.txt', 'utf8'), notes + '\n', 'THIRD_PARTY_LICENSES.txt matches the embedded notices');
  for (const name of ['react', 'react-dom', 'scheduler', 'three']) {
    const { version, text } = licenceOf(name);
    assert.ok(notes.includes(`==== ${name} ${version} (MIT) ====\n\n${text}`), `${name} ${version}`);
  }
  for (const name of data) assert.ok(notes.includes(`==== ${name} — reference data`) && notes.includes(readFileSync(`scripts/data-licenses/${name}.txt`, 'utf8').trim()), name);
});

test('dist/csm-features.mjs keeps its shebang and carries the notices of what it bundles', () => {
  const cli = readFileSync('dist/csm-features.mjs', 'utf8');
  const m = cli.match(/^#!\/usr\/bin\/env node\n\/\*!\n([\s\S]*?)\n\*\/\n/);
  assert.ok(m, 'notice comment right after the shebang');
  const { version, text } = licenceOf('three');
  assert.ok(m[1].includes(`==== three ${version} (MIT) ====\n\n${text}`));
  assert.ok(!m[1].includes('==== react '), 'no React in the CLI');
  for (const name of data) assert.ok(m[1].includes(`==== ${name} — reference data`), name);
});
