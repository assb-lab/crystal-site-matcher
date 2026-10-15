// Checks of #41: g(r) and XRD are computed apart from the features, cached per crystal, and shown in their own tab.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const p = await server.ssrLoadModule('/src/lib/pipeline.ts');
  const P = await server.ssrLoadModule('/src/lib/patterns.ts');
  const { simulateXrd } = await server.ssrLoadModule('/src/lib/xrd.ts');
  const { docFromText } = await server.ssrLoadModule('/src/lib/doc.ts');
  const { I18nProvider } = await server.ssrLoadModule('/src/i18n/index.tsx');
  const { default: PatternsPanel } = await server.ssrLoadModule('/src/components/PatternsPanel.tsx');
  const { default: FeaturesPanel } = await server.ssrLoadModule('/src/components/FeaturesPanel.tsx');
  const x = await server.ssrLoadModule('/src/cli/extract.ts');
  const text = await readFile('src/samples/LiCoO2.cif', 'utf8');
  const doc = docFromText(text, 'LiCoO2.cif', 0);
  const cr = doc.crystal;

  // the feature stages (and the CLI, which uses them) no longer compute g(r) or XRD
  const st = p.staticStage(doc, doc.hopCutoff);
  assert.equal('prdf' in st, false);
  const g = await p.gridStage(doc, 0.3, undefined, undefined, st.hops);
  assert.ok(g.grid);
  assert.equal(P.cachedPattern(cr, 'prdf'), undefined);
  assert.equal(P.cachedPattern(cr, 'xrd'), undefined);
  const r = await x.extractFromText(text, 'LiCoO2.cif', { grid: null });
  assert.equal(r.records.length, 1);

  // nothing computed → the tab shows placeholders, without errors
  const render = (lang, d = doc) => renderToStaticMarkup(createElement(I18nProvider, { initial: lang }, createElement(PatternsPanel, { doc: d })));
  const empty = render('ja');
  assert.equal((empty.match(/計算しています/g) ?? []).length, 2);
  assert.doesNotMatch(empty, /<svg/);

  // computed once per kind and crystal, then reused
  const prdf = P.patternOf(cr, 'prdf');
  assert.equal(P.patternOf(cr, 'prdf'), prdf);
  assert.equal(P.cachedPattern(cr, 'xrd'), undefined, 'g(r) alone does not compute XRD');
  assert.deepEqual(prdf.map((q) => q.pair).sort(), ['Co–Co', 'Co–O', 'Li–Co', 'Li–Li', 'Li–O', 'O–O'].sort());
  const xrd = P.patternOf(cr, 'xrd');
  assert.deepEqual(xrd, simulateXrd(cr));
  // oxidation states, bonds or the mobile ion do not touch the crystal, so the cache still applies
  const edited = { ...doc, ox: { ...doc.ox, Li1: 0 }, mobile: null };
  assert.equal(P.cachedPattern(edited.crystal, 'xrd'), xrd);

  // with the cache filled the tab draws both charts; the default g(r) pairs involve the mobile ion or two anions
  const ja = render('ja');
  assert.match(ja, /部分動径分布関数 g\(r\)/);
  assert.match(ja, /粉末 X 線回折/);
  assert.equal((ja.match(/<svg/g) ?? []).length, 2);
  assert.match(ja, /aria-pressed="true"[^>]*>Li–Li</);
  assert.match(ja, /aria-pressed="false"[^>]*>Co–Co</);
  assert.doesNotMatch(render('en'), /[぀-ヿ一-鿿]/, 'untranslated Japanese text in the English tab');

  // the Features tab no longer carries them
  const feat = renderToStaticMarkup(createElement(I18nProvider, { initial: 'ja' }, createElement(FeaturesPanel, { doc, update: () => {}, entry: { static: st, values: { ...st.values, ...g.values }, grid: g.grid, gridStatus: 'done', siteE: g.siteE, minima: g.minima, barriers: g.barriers, progress: 1 } })));
  assert.doesNotMatch(feat, /g\(r\)|粉末 X 線回折/);
} finally {
  await server.close();
}
