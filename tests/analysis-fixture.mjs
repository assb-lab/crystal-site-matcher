// Checks of the per-site polyhedron analysis (src/lib/analysis.ts), loaded through vite like chart-fixture.mjs.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, logLevel: 'silent' });
try {
  const { docFromText, deriveBonds } = await server.ssrLoadModule('/src/lib/doc.ts');
  const { analyzeSite } = await server.ssrLoadModule('/src/lib/analysis.ts');
  const { toCart } = await server.ssrLoadModule('/src/lib/structure.ts');
  const sites = async (f) => {
    const doc = docFromText(await readFile(`src/samples/${f}.cif`, 'utf8'), `${f}.cif`, 0);
    const { bonds } = deriveBonds(doc.crystal, doc.ox, doc.bondSettings);
    const by = {};
    for (const g of doc.crystal.groups) by[g.key] = analyzeSite(doc.crystal, doc.ox, bonds, g.positions[0], { kind: 'ionic' });
    return { doc, bonds, by };
  };
  const near = (x, y, tol, msg) => assert.ok(Math.abs(x - y) < tol, `${msg}: ${x} vs ${y}`);

  // centroid offset (#20): zero on centrosymmetric sites, whatever the bond lengths
  {
    const { by } = await sites('SrTiO3');
    for (const k of ['Sr1', 'Ti1', 'O1']) near(by[k].centroidOffset, 0, 1e-9, `SrTiO3 ${k}`);
    // O: 2 Ti at 1.9525 + 4 Sr at 2.7613 → mean / min / max
    near(by.O1.dMean, (2 * 1.9525 + 4 * 2.7613) / 6, 1e-3, 'SrTiO3 O1 ⟨d⟩');
    near(by.O1.dMin, 1.9525, 1e-3, 'SrTiO3 O1 d_min');
    near(by.O1.dMax, 2.7613, 1e-3, 'SrTiO3 O1 d_max');
  }
  {
    const { by } = await sites('LiCoO2');
    near(by.Co1.centroidOffset, 0, 1e-9, 'LiCoO2 Co1');
    near(by.Li1.centroidOffset, 0, 1e-9, 'LiCoO2 Li1');
    // O on the 3-fold axis between 3 Co and 3 Li: off-centre along c
    near(by.O1.centroidOffset, 0.1462, 1e-3, 'LiCoO2 O1');
  }
  // LiFePO4: Fe on a mirror plane is off-centre; check against centroids built from Cartesian ligand positions
  {
    const { doc, bonds, by } = await sites('LiFePO4');
    near(by.Fe1.centroidOffset, 0.3045, 1e-3, 'LiFePO4 Fe1');
    near(by.Li1.centroidOffset, 0, 1e-9, 'LiFePO4 Li1 (inversion centre)');
    const L = doc.crystal.lattice;
    for (const a of Object.values(by)) {
      const P = doc.crystal.positions[a.pos];
      const nbs = bonds.bonded[a.pos];
      const c = [0, 1, 2].map((i) => nbs.reduce((s, n) => s + toCart(L, doc.crystal.positions[n.j].frac.map((f, k) => f + n.t[k]))[i], 0) / nbs.length);
      near(a.centroidOffset, Math.hypot(c[0] - P.cart[0], c[1] - P.cart[1], c[2] - P.cart[2]), 1e-9, `LiFePO4 ${a.group} vs Cartesian`);
      assert.ok(a.dMin <= a.dMean && a.dMean <= a.dMax);
      assert.ok(a.centroidOffset < a.dMin, `${a.group}: offset inside the polyhedron`);
    }
  }
  // CN 2 (linear Li1 in Li3N) is centred; below CN 2 there is no centroid
  {
    const { by } = await sites('Li3N');
    near(by.Li1.centroidOffset, 0, 1e-9, 'Li3N Li1');
  }

  // the site panel shows the new rows in both languages
  {
    const { doc, bonds, by } = await sites('LiFePO4');
    const { default: SitePanel } = await server.ssrLoadModule('/src/components/SitePanel.tsx');
    const { I18nProvider } = await server.ssrLoadModule('/src/i18n/index.tsx');
    const noop = () => {};
    const props = {
      crystal: doc.crystal, ox: doc.ox, bonds, bondSettings: doc.bondSettings, analysis: by.Fe1, hostSite: undefined, setHostSite: noop,
      hostSpin: '', setHostSpin: noop, radiusKind: 'ionic', setRadiusKind: noop, cutScope: 'pair', setCutScope: noop,
      onCutoff: noop, onClearOverride: noop, onSelectGroup: noop, rmax: 6, goSubst: noop,
    };
    const render = (lang) => renderToStaticMarkup(createElement(I18nProvider, { initial: lang }, createElement(SitePanel, props)));
    const ja = render('ja');
    assert.match(ja, /重心のずれ/);
    assert.match(ja, /0\.304 Å/);
    assert.match(ja, /2\.250 Å/);
    const en = render('en');
    assert.match(en, /Centroid offset/);
    assert.match(en, /Longest bond/);
    assert.doesNotMatch(en.replace(/<option[^>]*>[^<]*<\/option>/g, ''), /[\u3040-\u30ff\u4e00-\u9fff]/, 'untranslated Japanese text in the English site panel');
  }
} finally {
  await server.close();
}
