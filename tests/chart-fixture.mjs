// Run outside the test runner so a stalled chart loop is killed by a timeout.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true } });
try {
  const { niceTicks, padRange } = await server.ssrLoadModule('/src/components/charts.tsx');
  if (process.argv[2] === 'ticks') {
    for (const [lo, hi] of [
      [2.8156000000000003, 2.8156000000000008],
      [0.148, 0.148], [0, 0], [-1e-17, 1e-17],
      [1e6, 1e6 + 1e-7], [5, 90], [0, 1.269], [90, 5],
    ]) {
      const ticks = niceTicks(lo, hi);
      assert.ok(ticks.length > 0 && ticks.length <= 1000);
      assert.ok(ticks.every(Number.isFinite));
      assert.equal(new Set(ticks).size, ticks.length);
      assert.ok(ticks.every((v, i) => i === 0 || v > ticks[i - 1]));
    }
    assert.deepEqual(niceTicks(0, 10), [0, 2, 4, 6, 8, 10]);
    assert.deepEqual(niceTicks(NaN, 1), []);
    assert.deepEqual(niceTicks(0, Infinity), []);
    for (const n of [0, -1, Infinity, NaN]) assert.deepEqual(niceTicks(0, 1, n), []);
    assert.ok(niceTicks(0, 1, 1e8).length <= 1000);
    for (const [lo, hi] of [[2.8156000000000003, 2.8156000000000008], [0.148, 0.148], [0, 0]]) {
      const [a, b] = padRange(lo, hi);
      assert.ok(a < lo && b > hi && b - a >= 0.1);
    }
    assert.deepEqual(padRange(0, 10), [-1.2, 11.2]);
  } else {
    const { docFromText, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
    const { computeStaticFeatures } = await server.ssrLoadModule('/src/lib/features.ts');
    const { default: FeaturesPanel } = await server.ssrLoadModule('/src/components/FeaturesPanel.tsx');
    const { simulateXrd } = await server.ssrLoadModule('/src/lib/xrd.ts');
    const doc = docFromText(await readFile('src/samples/LiCoO2.cif', 'utf8'), 'LiCoO2.cif', 0);
    const { bonds, table } = deriveBonds(doc.crystal, doc.ox, doc.bondSettings);
    const st = computeStaticFeatures(doc.crystal, doc.ox, bonds, table, { mobileEl: doc.mobile, hopCutoff: doc.hopCutoff });
    assert.equal(doc.mobile, 'Li');
    assert.equal(st.hops.length, 9);
    assert.ok(st.hops.every(h => Math.abs(h.d - 2.8156) < 1e-10));
    for (const key of ['d', 'rb']) {
      const values = st.hops.map(h => h[key]);
      const range = padRange(Math.min(...values), Math.max(...values));
      assert.ok(niceTicks(...range).length > 0);
    }
    const { I18nProvider } = await server.ssrLoadModule('/src/i18n/index.tsx');
    const props = {
      doc, update: () => {}, entry: {
        static: st, values: st.values, xrd: simulateXrd(doc.crystal),
        grid: null, gridStatus: 'pending', siteE: null, progress: 0,
      },
    };
    const render = (lang) => renderToStaticMarkup(createElement(I18nProvider, { initial: lang }, createElement(FeaturesPanel, props)));
    const html = render('ja');
    assert.match(html, /可動イオン間のホップ（9 本）/);
    assert.match(html, /ボトルネック半径 \(Å\) vs ホップ距離 \(Å\)/);
    assert.doesNotMatch(html, /(?:cx|cy|x|y)="(?:NaN|Infinity|-Infinity)"/);
    const en = render('en');
    assert.match(en, /Mobile-ion hops \(9\)/);
    assert.match(en, /Bottleneck radius \(Å\) vs Hop distance \(Å\)/);
    assert.doesNotMatch(en, /[\u3040-\u30ff\u4e00-\u9fff]/, 'untranslated Japanese text in the English features panel');
  }
} finally {
  await server.close();
}
